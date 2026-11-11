import type { TachycardiaState } from '../types';
import { RHYTHM } from '../params';

/**
 * 調律の判定（docs/DESIGN.md §5）。
 * 心房の見張り頂点（CS 口付近）の興奮と心室の興奮から周期長を求め、
 *  - 刺激中、または刺激の直後で速い興奮が続いている（まだ持続とはいえない）：pacing
 *  - 刺激をやめてから sustainMs 以上、周期 tachycardiaClMs 未満の興奮が続く（刺激をしていない場合も含む）：tachycardia
 *  - 頻拍が止まった：terminated（次に刺激するまで保つ）
 *  - それ以外：sinus
 * 非誘発（noninducible）はプロトコルの結果として外から設定する。
 */
export class RhythmMonitor {
  atrial: number[] = [];
  ventricular: number[] = [];
  state: TachycardiaState = 'sinus';
  private wasTachy = false;

  constructor(readonly params = RHYTHM) {}

  recordAtrial(t: number) { push(this.atrial, t); }
  recordVentricular(t: number) { push(this.ventricular, t); }

  /** 直近の周期長の中央値（拍が少なければ null） */
  static cycleLength(times: number[], beats = 6): number | null {
    if (times.length < 3) return null;
    const a = times.slice(-beats - 1);
    const d: number[] = [];
    for (let i = 1; i < a.length; i++) d.push(a[i] - a[i - 1]);
    d.sort((x, y) => x - y);
    return d[d.length >> 1];
  }

  /** 速い興奮が今も続いているか（最後の興奮が周期の 2 倍以内） */
  private rapid(times: number[], now: number): number | null {
    const cl = RhythmMonitor.cycleLength(times);
    if (cl === null || cl >= this.params.tachycardiaClMs) return null;
    return now - times[times.length - 1] <= 2 * cl ? cl : null;
  }

  /** 心房と心室のうち速いほうの周期長 */
  currentCycleLength(now: number): number | null {
    const a = this.rapid(this.atrial, now), v = this.rapid(this.ventricular, now);
    if (a === null) return v;
    if (v === null) return a;
    return Math.min(a, v);
  }

  update(now: number, lastStimulus: number, stimulating: boolean): TachycardiaState {
    const cl = this.currentCycleLength(now);
    if (stimulating) this.state = 'pacing';
    else if (cl !== null) {
      if (now - lastStimulus >= this.params.sustainMs) { this.state = 'tachycardia'; this.wasTachy = true; }
      else this.state = 'pacing';
    } else if (this.wasTachy) this.state = 'terminated';
    else if (this.state !== 'noninducible' && this.state !== 'terminated') this.state = 'sinus';
    return this.state;
  }

  /** 刺激を始めるときに呼ぶ（terminated / noninducible を解除） */
  startStimulation() { this.wasTachy = false; this.state = 'pacing'; }

  reset() { this.atrial = []; this.ventricular = []; this.state = 'sinus'; this.wasTachy = false; }
}

function push(a: number[], x: number) {
  a.push(x);
  if (a.length > 32) a.shift();
}
