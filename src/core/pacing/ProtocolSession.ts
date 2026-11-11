import type { SimulationEngine, PacingSite } from '../sim/SimulationEngine';
import { PROTOCOL } from '../params';

export type ProtocolKind = 'extrastimulus' | 'burst';

export interface ProtocolConfig {
  kind: ProtocolKind;
  site: PacingSite;
  s1Ms: number;
  s1Beats: number;
  s2StartMs: number;
  s2StepMs: number;
  s2MinMs: number;
  /** S3（S2 からの連結期）。null なら S3 なし */
  s3Ms: number | null;
  burstFromMs: number;
  burstToMs: number;
  burstStepMs: number;
  burstBeats: number;
  observeMs: number;
}

export function defaultProtocol(kind: ProtocolKind, site: PacingSite): ProtocolConfig {
  return {
    kind, site,
    s1Ms: PROTOCOL.s1Ms, s1Beats: PROTOCOL.s1Beats,
    s2StartMs: PROTOCOL.s1Ms - PROTOCOL.s2StartOffsetMs, s2StepMs: PROTOCOL.s2StepMs, s2MinMs: PROTOCOL.s2MinMs,
    s3Ms: null,
    burstFromMs: PROTOCOL.burstFromMs, burstToMs: PROTOCOL.burstToMs, burstStepMs: PROTOCOL.burstStepMs, burstBeats: PROTOCOL.burstBeats,
    observeMs: PROTOCOL.observeMs,
  };
}

/** 1 列の刺激の結果 */
export interface TrainResult {
  /** 例："S2 450"、"バースト 250" */
  label: string;
  /** 最後の期外刺激の連結期（バーストは周期） */
  couplingMs: number;
  /** 最後の刺激が捕捉されたか（されなければ有効不応期） */
  captured: boolean;
  /** 最後の刺激後の A–H（His カテーテル部位の心房興奮 → His）。房室ブロックなら null */
  ahMs: number | null;
  /** 房室結節の速伝導路の逆行（エコー）または副伝導路の逆行が起きたか */
  echo: boolean;
  induced: boolean;
}

export type ProtocolStatus = 'running' | 'waiting' | 'induced' | 'noninducible' | 'stopped';

/**
 * 刺激プロトコル（docs/DESIGN.md §5.6）。エンジンの時刻で進む状態機械で、UI とテストの両方で使う。
 *  - 期外刺激：S1 × n → S2（→ S3）。S2 を S1 − 100 ms から 10 ms 刻みで短くする
 *  - バースト：周期 300 → 200 ms を 10 ms 刻み、各 10 拍
 * 列ごとに観察時間を置き、速い興奮が続いていれば持続（RHYTHM.sustainMs）を待って誘発と判定する。
 * 下限まで、または捕捉されなくなるまで誘発されなければ非誘発。
 */
export class ProtocolSession {
  status: ProtocolStatus = 'running';
  results: TrainResult[] = [];
  private coupling: number;
  private lastStim = 0;
  private captureCheckAt = 0;
  private captured = false;
  private targetVertex: number | null = null;

  constructor(readonly engine: SimulationEngine, readonly config: ProtocolConfig) {
    this.coupling = config.kind === 'extrastimulus' ? config.s2StartMs : config.burstFromMs;
    const target = engine.siteTarget(config.site);
    this.targetVertex = target.kind === 'atrium' ? target.vertex : null;
    engine.rhythm.startStimulation();
    this.scheduleTrain();
  }

  get done() { return this.status === 'induced' || this.status === 'noninducible' || this.status === 'stopped'; }

  stop() {
    this.engine.stimulator.cancel();
    this.status = 'stopped';
  }

  private scheduleTrain() {
    const c = this.config, e = this.engine;
    const t0 = e.time + 50;
    const times: number[] = [];
    if (c.kind === 'extrastimulus') {
      for (let i = 0; i < c.s1Beats; i++) times.push(t0 + i * c.s1Ms);
      times.push(times[times.length - 1] + this.coupling);
      if (c.s3Ms !== null) times.push(times[times.length - 1] + c.s3Ms);
    } else {
      for (let i = 0; i < c.burstBeats; i++) times.push(t0 + i * this.coupling);
    }
    e.pace(c.site, times, this.trainLabel());
    this.lastStim = times[times.length - 1];
    this.captureCheckAt = this.lastStim + 30;
    this.captured = false;
    this.status = 'running';
  }

  private trainLabel() {
    return this.config.kind === 'extrastimulus' ? `S2 ${this.coupling}` : `バースト ${this.coupling}`;
  }

  /** 毎フレーム（またはエンジンを進めるたび）に呼ぶ */
  update() {
    if (this.done) return;
    const e = this.engine, c = this.config, now = e.time;
    // 最後の刺激が捕捉されたか（刺激の直後に見る）
    if (now >= this.captureCheckAt && this.captureCheckAt > 0) {
      if (this.targetVertex === null) this.captured = e.conduction.vBeats.some((b) => b.source === 'pace' && Math.abs(b.time - this.lastStim) < 5);
      else {
        const la = e.ca.tissue.lastActivation[this.targetVertex];
        this.captured = la >= this.lastStim - 1 && la <= this.lastStim + 25;
      }
      this.captureCheckAt = -1;
    }
    if (now < this.lastStim + c.observeMs) return;

    const cl = e.rhythm.currentCycleLength(now);
    if (this.status === 'running') {
      this.results.push(this.evaluate());
      if (cl !== null) { this.status = 'waiting'; return; }
      this.next();
      return;
    }
    // 速い興奮が続いている：持続すれば誘発
    if (cl === null) { this.next(); return; }
    if (now - this.lastStim >= e.rhythm.params.sustainMs) {
      this.results[this.results.length - 1].induced = true;
      this.status = 'induced';
    }
  }

  private evaluate(): TrainResult {
    const e = this.engine, ts = this.lastStim;
    const c = e.conduction;
    const a = c.aTimes.find((t) => t >= ts && t <= ts + 150);
    const h = a === undefined ? undefined : c.hTimes.find((t) => t > a && t < a + 600);
    const echo = c.exitLog.some((x) => x.time > ts && x.time <= ts + this.config.observeMs);
    return { label: this.trainLabel(), couplingMs: this.coupling, captured: this.captured, ahMs: a !== undefined && h !== undefined ? h - a : null, echo, induced: false };
  }

  private next() {
    const c = this.config;
    const last = this.results[this.results.length - 1];
    if (c.kind === 'extrastimulus') {
      this.coupling -= c.s2StepMs;
      if (this.coupling < c.s2MinMs || (last && !last.captured)) return this.finishNoninducible();
    } else {
      this.coupling -= c.burstStepMs;
      if (this.coupling < c.burstToMs) return this.finishNoninducible();
    }
    this.scheduleTrain();
  }

  private finishNoninducible() {
    this.status = 'noninducible';
    this.engine.rhythm.state = 'noninducible';
  }
}

/** テスト用：プロトコルを最後まで実行する（エンジンを stepMs ずつ進める） */
export function runProtocol(engine: SimulationEngine, config: ProtocolConfig, stepMs = 20, maxMs = 600_000): ProtocolSession {
  const s = new ProtocolSession(engine, config);
  const end = engine.time + maxMs;
  while (!s.done && engine.time < end) { engine.tick(stepMs); s.update(); }
  return s;
}
