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


export class EntrainmentSession {
  readonly tclMs: number;
  readonly pclMs: number;
  /** 刺激の時刻（観察の後に、頻拍の心室に合わせて決める。それまでは空） */
  times: number[] = [];
  private readonly beatCount: number;
  /** 刺激を始める前の観察の始まり（頻拍中の VA を測る） */
  readonly startedAt: number;
  /** 心房の時刻を測る頂点：His 部位の心房（房室結節・副伝導路・心房頻拍のどれの心房興奮も同じ所で測る） */
  readonly atrialVertex: number;
  private atria: number[] = [];
  private lastAtrial: number;
  private beats: { t: number; paced: boolean }[] = [];
  private seenBeat = new Set<number>();
  result: EntrainmentResult | null = null;

  /** 頻拍中に呼ぶ（頻拍周期は直近 4 拍の心室の間隔から） */
  constructor(readonly engine: SimulationEngine, offsetMs = ENTRAINMENT_DEFAULTS.offsetMs, beats = ENTRAINMENT_DEFAULTS.beats) {
    const v = engine.conduction.vBeats.filter((b) => b.source !== 'pace').slice(-4).map((b) => b.time);
    this.tclMs = v.length >= 2 ? (v[v.length - 1] - v[0]) / (v.length - 1) : NaN;
    this.pclMs = Math.round(this.tclMs) - offsetMs;
    this.atrialVertex = engine.model.anatomy.anchors.his.vertex;
    this.lastAtrial = engine.ca.tissue.lastActivation[this.atrialVertex];
    // 刺激の前に頻拍を 1 周期あまり観察して、頻拍中の VA（心室 → 次の心房）を測る。刺激は観察の後の最初の心室から刺激周期で始める
    // （頻拍の心室の直後に刺激が当たると不応期で捕捉せず、始める位相によって追従するまでの拍数が変わったため）
    this.startedAt = engine.time;
    this.beatCount = beats;
  }

  get lastStimulus() { return this.times.length ? this.times[this.times.length - 1] : Infinity; }
  get done() { return this.result !== null; }
  /** 刺激を始めたか（観察中は false） */
  get pacing() { return this.times.length > 0; }

  /** 観察が終わったら、その後の最初の（刺激によらない）心室から刺激周期で刺激を予約する */
  private schedule() {
    const now = this.engine.time;
    if (now < this.startedAt + this.tclMs * 1.3) return;
    const v = this.beats.filter((b) => !b.paced && b.t >= this.startedAt + this.tclMs * 1.3).map((b) => b.t)[0];
    // 頻拍が止まっていて心室が来なければ、すぐ始める
    const t0 = v !== undefined ? v + this.pclMs : now > this.startedAt + this.tclMs * 3.5 ? now + 20 : null;
    if (t0 === null || t0 <= now) return;
    this.times = Array.from({ length: this.beatCount }, (_, i) => t0 + i * this.pclMs);
    this.engine.pace('RV', this.times, 'エントレインメント');
  }

  /** 毎刻み（エンジンを進めた後）に呼ぶ：出来事を集め、観察が終わったら結果を出す */
  step() {
    if (this.result) return;
    const c = this.engine.conduction;
    const la = this.engine.ca.tissue.lastActivation[this.atrialVertex];
    if (la > this.lastAtrial + 0.5) { this.lastAtrial = la; this.atria.push(la); }
    for (const b of c.vBeats) if (!this.seenBeat.has(b.time)) { this.seenBeat.add(b.time); this.beats.push({ t: b.time, paced: b.source === 'pace' }); }
    if (!this.pacing) this.schedule();
    if (this.pacing && this.engine.time >= this.lastStimulus + ENTRAINMENT_DEFAULTS.observeMs) this.result = this.evaluate();
  }

  private evaluate(): EntrainmentResult {
    const last = this.lastStimulus;
    const atria = this.atria;
    // 頻拍中の VA：刺激の前の観察で、刺激によらない心室 → その後の最初の心房（次の心室より前）
    const pre = this.beats.filter((b) => !b.paced && b.t > this.startedAt && b.t < this.times[0]).map((b) => b.t).sort((p, q) => p - q);
    let vaMs: number | null = null;
    for (let i = 0; i < pre.length && vaMs === null; i++) {
      const a = atria.find((t) => t > pre[i] && t < (pre[i + 1] ?? this.times[0]));
      if (a !== undefined) vaMs = Math.round(a - pre[i]);
    }
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
      saMs: continued ? sa : null, vaMs, saMinusVaMs: continued && sa !== null && vaMs !== null ? sa - vaMs : null,
    };
  }
}

/** テスト・研究用：頻拍中のエンジンで、セッションを最後まで進めて結果を返す */
export function runEntrainment(engine: SimulationEngine, offsetMs = ENTRAINMENT_DEFAULTS.offsetMs): EntrainmentResult {
  const s = new EntrainmentSession(engine, offsetMs);
  while (!s.done) { engine.tick(20); s.step(); }
  return s.result!;
}

/** 設問の正解：AVNRT の症例は AVNRT、WPW（副伝導路を逆行する AVRT）は AVRT、心房頻拍の症例は AT */
export function tachycardiaMechanism(id: ArrhythmiaId): 'avnrt' | 'avrt' | 'at' | null {
  return id === 'avnrt' ? 'avnrt' : id === 'wpw' ? 'avrt' : id === 'at' ? 'at' : null;
}

export { ENTRAINMENT_QUESTION, entrainmentGoal } from './entrainmentGoal';
