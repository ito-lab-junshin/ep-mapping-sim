/** 刺激の対象：心房メッシュの頂点、または心室（1 コンパートメント） */
export type StimTarget = { kind: 'atrium'; vertex: number } | { kind: 'ventricle' };

export interface Stimulus { time: number; target: StimTarget; label?: string }

/**
 * 刺激装置（docs/DESIGN.md §5.6）。刺激を時刻順に予約し、エンジンが時刻になったら取り出して届ける。
 * 届けた刺激の時刻は EGM の刺激アーチファクトに使う。
 */
export class Stimulator {
  private queue: Stimulus[] = [];
  /** 直近に届けた刺激の時刻 */
  delivered: number[] = [];

  schedule(stims: Stimulus[]) {
    this.queue.push(...stims);
    this.queue.sort((a, b) => a.time - b.time);
  }

  /** 予約をすべて取り消す */
  cancel() { this.queue = []; }

  get pending(): number { return this.queue.length; }

  /** 最後に予約されている刺激の時刻（なければ null） */
  get lastScheduled(): number | null { return this.queue.length ? this.queue[this.queue.length - 1].time : null; }

  take(until: number): Stimulus[] {
    let i = 0;
    while (i < this.queue.length && this.queue[i].time <= until) i++;
    const out = this.queue.splice(0, i);
    for (const s of out) {
      this.delivered.push(s.time);
      if (this.delivered.length > 32) this.delivered.shift();
    }
    return out;
  }

  reset() { this.queue = []; this.delivered = []; }
}

/** 再現できる乱数（mulberry32）。シナリオの PV トリガーなどで使う */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
