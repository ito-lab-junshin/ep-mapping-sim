import type { SimulationEngine } from '../sim/SimulationEngine';
import type { ArrhythmiaId } from '../types';

/**
 * 頻拍中の心室刺激（エントレインメント、4-B、docs/DESIGN.md §5.6）：頻拍中に RV から「頻拍周期 − offsetMs」で beats 拍刺激し、
 * 止めた後の反応を測る。判定は学習者に任せ、測った値と目安（ENTRAINMENT_CRITERIA）を並べて見せる。
 * 刺激伝導系の出来事の記録（exitLog・vBeats）は最近の分しか残らないので、セッションが毎刻み自分で集める。
 */
export interface EntrainmentResult {
  /** 頻拍周期（刺激前の心室の間隔の平均） */
  tclMs: number;
  /** 刺激周期 */
  pclMs: number;
  /** 刺激の最後の 4 間隔で、心房が刺激の周期に追従した（± 10 ms） */
  entrained: boolean;
  /** 止めた後の反応：最後の刺激の後、次の心室の前に心房が 1 回なら VAV、2 回なら VAAV。頻拍が止まれば terminated */
  response: 'VAV' | 'VAAV' | 'terminated';
  /** 刺激後の回復周期（最後の刺激 → 刺激によらない最初の心室）と PPI − TCL */
  ppiMs: number | null;
  ppiMinusTclMs: number | null;
  /** 最後の刺激 → 最後に追従した心房（SA）、頻拍中の心室 → 心房（VA）、SA − VA */
  saMs: number | null;
  vaMs: number | null;
  saMinusVaMs: number | null;
}

/**
 * 目安（Michaud GF ら、J Am Coll Cardiol 2001;38:1163-7。非典型 AVNRT と中隔副伝導路の順行性 AVRT の比較で、
 * SA−VA > 85 ms かつ PPI−TCL > 115 ms は非典型 AVNRT の全例、AVRT の 0 例。抄録で確認、原文は未確認。先生と決定）
 */
export const ENTRAINMENT_CRITERIA = {
  saMinusVaMs: 85,
  ppiMinusTclMs: 115,
  source: 'Michaud GF ら、J Am Coll Cardiol 2001;38:1163-7。非典型 AVNRT と中隔副伝導路の AVRT の比較。抄録で確認、原文は未確認',
};

/**
 * 既定：頻拍周期より 20 ms 短く 20 拍（仮定値）。AVNRT では心室の刺激が His の不応期を外れて回路に入るまで数拍かかり、
 * 12 拍（20 ms × 12 = 240 ms のずれ。頻拍周期 約 286 ms に届かない）では始める位相によって追従しなかった
 */
export const ENTRAINMENT_DEFAULTS = { offsetMs: 20, beats: 20, observeMs: 1500 };

/** 心房の出口の時刻を、同じ拍の複数の出口（副伝導路の 2 頂点・同時の結節）をまとめて 1 つにする（30 ms 以内） */
function cluster(times: number[]): number[] {
  const s = [...times].sort((a, b) => a - b);
  return s.filter((t, i) => i === 0 || t - s[i - 1] > 30);
}

export class EntrainmentSession {
  readonly tclMs: number;
  readonly pclMs: number;
  readonly times: number[];
  readonly vaMs: number | null;
  private exits: number[] = [];
  private beats: { t: number; paced: boolean }[] = [];
  private seenExit = new Set<string>();
  private seenBeat = new Set<number>();
  result: EntrainmentResult | null = null;

  /** 頻拍中に呼ぶ（頻拍周期は直近 4 拍の心室の間隔から） */
  constructor(readonly engine: SimulationEngine, offsetMs = ENTRAINMENT_DEFAULTS.offsetMs, beats = ENTRAINMENT_DEFAULTS.beats) {
    const v = engine.conduction.vBeats.filter((b) => b.source !== 'pace').slice(-4).map((b) => b.time);
    this.tclMs = v.length >= 2 ? (v[v.length - 1] - v[0]) / (v.length - 1) : NaN;
    // 頻拍中の VA：最後から 2 番目の心室 → その後の最初の心房の出口（最後の心室の直後の心房は、まだ記録されていないことがある）
    const vPrev = v[v.length - 2], vLast = v[v.length - 1];
    const a = engine.conduction.exitLog.filter((x) => x.time > vPrev && x.time < vLast).map((x) => x.time).sort((p, q) => p - q)[0];
    this.vaMs = vPrev !== undefined && a !== undefined ? Math.round(a - vPrev) : null;
    this.pclMs = Math.round(this.tclMs) - offsetMs;
    const t0 = engine.time + 20;
    this.times = Array.from({ length: beats }, (_, i) => t0 + i * this.pclMs);
    engine.pace('RV', this.times, 'エントレインメント');
  }

  get lastStimulus() { return this.times[this.times.length - 1]; }
  get done() { return this.result !== null; }

  /** 毎刻み（エンジンを進めた後）に呼ぶ：出来事を集め、観察が終わったら結果を出す */
  step() {
    if (this.result) return;
    const c = this.engine.conduction;
    for (const x of c.exitLog) { const k = `${x.time.toFixed(3)}:${x.via}:${x.vertex}`; if (!this.seenExit.has(k)) { this.seenExit.add(k); this.exits.push(x.time); } }
    for (const b of c.vBeats) if (!this.seenBeat.has(b.time)) { this.seenBeat.add(b.time); this.beats.push({ t: b.time, paced: b.source === 'pace' }); }
    if (this.engine.time >= this.lastStimulus + ENTRAINMENT_DEFAULTS.observeMs) this.result = this.evaluate();
  }

  private evaluate(): EntrainmentResult {
    const last = this.lastStimulus;
    const atria = cluster(this.exits);
    // 最後の刺激の心房（SA の分）までを含めた、刺激中の最後の 5 回の心房
    const during = atria.filter((t) => t > this.times[0] && t <= last + this.pclMs * 0.9).slice(-5);
    const iv = during.slice(1).map((t, i) => t - during[i]);
    const entrained = iv.length >= 4 && iv.every((d) => Math.abs(d - this.pclMs) <= 10);
    const firstV = this.beats.filter((b) => !b.paced && b.t > last + 5).sort((p, q) => p.t - q.t)[0];
    const afterA = atria.filter((t) => t > last);
    const sa = afterA[0] !== undefined && (!firstV || afterA[0] < firstV.t) ? Math.round(afterA[0] - last) : null;
    const nA = firstV ? afterA.filter((t) => t < firstV.t).length : afterA.length;
    // 頻拍が続いたか：刺激を止めた後に、刺激によらない心室が頻拍周期の 1.5 倍以内の間隔で 2 拍以上続く
    const vAfter = this.beats.filter((b) => !b.paced && b.t > last + 5).map((b) => b.t).sort((p, q) => p - q);
    const continued = vAfter.length >= 2 && vAfter[1] - vAfter[0] < this.tclMs * 1.5 && vAfter[0] - last < this.tclMs * 2.5;
    const response: EntrainmentResult['response'] = !continued ? 'terminated' : nA >= 2 ? 'VAAV' : 'VAV';
    const ppi = continued && firstV ? Math.round(firstV.t - last) : null;
    return {
      tclMs: Math.round(this.tclMs), pclMs: this.pclMs, entrained, response,
      ppiMs: ppi, ppiMinusTclMs: ppi !== null ? Math.round(ppi - this.tclMs) : null,
      saMs: sa, vaMs: this.vaMs, saMinusVaMs: sa !== null && this.vaMs !== null ? sa - this.vaMs : null,
    };
  }
}

/** テスト・研究用：頻拍中のエンジンで、セッションを最後まで進めて結果を返す */
export function runEntrainment(engine: SimulationEngine, offsetMs = ENTRAINMENT_DEFAULTS.offsetMs): EntrainmentResult {
  const s = new EntrainmentSession(engine, offsetMs);
  while (!s.done) { engine.tick(20); s.step(); }
  return s.result!;
}

/** 設問の正解：AVNRT の症例は AVNRT、WPW（副伝導路を逆行する AVRT）は AVRT */
export function tachycardiaMechanism(id: ArrhythmiaId): 'avnrt' | 'avrt' | null {
  return id === 'avnrt' ? 'avnrt' : id === 'wpw' ? 'avrt' : null;
}

export { ENTRAINMENT_QUESTION, entrainmentGoal } from './entrainmentGoal';
