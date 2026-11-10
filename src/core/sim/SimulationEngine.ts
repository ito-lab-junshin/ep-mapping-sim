import type { Catheter, EcgLead, EgmChannel, SurfaceMesh } from '../types';
import { CellularAutomaton } from '../propagation/CellularAutomaton';
import { EgmGenerator } from '../egm/EgmGenerator';
import { RingBuffer } from '../egm/RingBuffer';
import { farFieldV, hisSpike, localV, syntheticA } from '../egm/templates';
import { AvConduction } from '../conduction/AvConduction';
import { SurfaceEcg } from '../ecg/SurfaceEcg';
import { landmarksFor, type ChamberLandmarks } from '../geometry/landmarks';
import { vertexTowards } from '../geometry/meshUtils';
import { placeElectrodes, type Placement } from '../catheter/placement';
import { catheterGroup, defaultCatheters, type CatheterSpec } from '../catheter/catalog';
import { EGM_HISTORY_MS, SAMPLE_MS, SINUS_CYCLE_MS, TEMPLATE_AMPLITUDE_MV } from '../params';

export interface EngineOptions {
  sinusCycleMs?: number;
  historyMs?: number;
}

const ECG_LEADS: EcgLead[] = ['I', 'II', 'V1'];

/**
 * 1 症例ぶんのシミュレーション（UI 非依存）。
 * セルオートマトン・洞結節タイマー・房室伝導・EGM／体表 ECG のサンプリングをまとめて進める。
 * 描画側は tick() で進め、channels のバッファを直接読む。
 */
export class SimulationEngine {
  readonly sampleMs = SAMPLE_MS;
  readonly ca: CellularAutomaton;
  readonly egm: EgmGenerator;
  readonly av = new AvConduction();
  readonly ecg = new SurfaceEcg();
  readonly landmarks: ChamberLandmarks;
  readonly sinusVertex: number;
  readonly avNodeVertex: number;
  readonly specs: CatheterSpec[];
  readonly channels: EgmChannel[] = [];
  /** 配置が変わるたびに増える（3D 表示の更新用） */
  placementVersion = 0;
  sinusCycleMs: number;

  private acc = 0;
  private lastSinus = -Infinity;
  private lastNodeActivation = -1;
  private sampler: (() => number)[] = [];

  constructor(readonly mesh: SurfaceMesh, opts: EngineOptions = {}) {
    this.ca = new CellularAutomaton(mesh);
    this.egm = new EgmGenerator(mesh, this.ca.tissue);
    this.landmarks = landmarksFor(mesh.chamber);
    this.sinusVertex = vertexTowards(mesh, this.landmarks.sinusEntry);
    this.avNodeVertex = vertexTowards(mesh, this.landmarks.avNode);
    this.sinusCycleMs = opts.sinusCycleMs ?? SINUS_CYCLE_MS;
    const capacity = Math.ceil((opts.historyMs ?? EGM_HISTORY_MS) / SAMPLE_MS);

    for (const lead of ECG_LEADS) {
      this.channels.push({ id: lead, catheterId: 'ecg', group: 'ecg', mode: 'surface', buffer: new RingBuffer(capacity), gain: 1 });
      this.sampler.push(() => this.ecg.sample(this.time, lead, this.av.vTimes));
    }

    this.specs = defaultCatheters(this.landmarks);
    for (const spec of this.specs) {
      if (spec.placement && spec.layoutMm) spec.catheter.electrodes = placeElectrodes(mesh, spec.placement, spec.layoutMm);
      for (const ch of spec.channels) {
        this.channels.push({
          id: ch.id, catheterId: spec.catheter.id, group: catheterGroup(spec.catheter.kind),
          mode: 'bipolar', buffer: new RingBuffer(capacity), gain: 1,
        });
        this.sampler.push(this.makeSampler(spec, ch.pair));
      }
    }
  }

  get time() { return this.ca.time; }

  get catheters(): Catheter[] { return this.specs.map((s) => s.catheter); }

  catheter(id: string): Catheter | undefined { return this.specs.find((s) => s.catheter.id === id)?.catheter; }

  /** mesh 上のカテーテルを置き直す */
  setPlacement(catheterId: string, placement: Placement) {
    const spec = this.specs.find((s) => s.catheter.id === catheterId);
    if (!spec || spec.catheter.source !== 'mesh' || !spec.layoutMm) return;
    spec.placement = placement;
    spec.catheter.electrodes = placeElectrodes(this.mesh, placement, spec.layoutMm);
    this.placementVersion++;
  }

  /** 実時間 dtMs ぶん進める（内部は sampleMs 刻み） */
  tick(dtMs: number) {
    this.acc += dtMs;
    while (this.acc >= this.sampleMs) {
      this.acc -= this.sampleMs;
      this.stepOnce();
    }
  }

  /** sampleMs だけ進め、全チャンネルを 1 サンプル記録する */
  stepOnce() {
    const ca = this.ca, t = ca.tissue;
    if (ca.time - this.lastSinus >= this.sinusCycleMs) {
      ca.stimulate(this.sinusVertex);
      this.lastSinus = ca.time;
    }
    const prev = ca.time;
    ca.step(this.sampleMs);

    let newActs = 0, viable = 0;
    for (let v = 0; v < t.phase.length; v++) {
      if (t.viability[v] > 0) viable++;
      if (t.lastActivation[v] >= prev) newActs++;
    }
    this.ecg.update(ca.time, newActs, viable);

    const node = t.lastActivation[this.avNodeVertex];
    if (node > this.lastNodeActivation) {
      this.lastNodeActivation = node;
      this.av.atrialArrival(node);
    }

    for (let i = 0; i < this.channels.length; i++) this.channels[i].buffer.push(this.sampler[i]());
  }

  private recentV(windowMs = 200) { return AvConduction.recent(this.av.vTimes, this.time, windowMs); }

  private makeSampler(spec: CatheterSpec, pair: [number, number]): () => number {
    const cath = spec.catheter;
    const amp = TEMPLATE_AMPLITUDE_MV;
    if (cath.source === 'outside') return () => 0;

    if (cath.kind === 'his_quadripolar') {
      // Phase 2 で RA 連結後に置き換える仮実装：房室結節部位のタイミングから A・H・V を合成
      const a = pair[0] === 0 ? amp.his.d : amp.his.p;
      return () => {
        const now = this.time;
        let s = 0;
        for (const tA of AvConduction.recent(this.av.aTimes, now, 100)) s += a.a * syntheticA(now - tA);
        for (const h of AvConduction.recent(this.av.hTimes, now, 50)) s += a.h * hisSpike(now - h);
        for (const v of this.recentV()) s += a.v * farFieldV(now - v);
        return s;
      };
    }

    if (cath.kind === 'rv_quadripolar') {
      return () => {
        const now = this.time;
        let s = 0;
        for (const v of this.recentV()) s += amp.rv.v * localV(now - v - amp.rv.delayMs);
        return s;
      };
    }

    const group = catheterGroup(cath.kind);
    const ffv = group === 'hra' ? amp.farFieldV.hra : group === 'cs' ? amp.farFieldV.cs : amp.farFieldV.abl;
    return () => {
      const now = this.time;
      let s = this.egm.bipolar(cath, pair, now);
      for (const v of this.recentV()) s += ffv * farFieldV(now - v);
      return s;
    };
  }

  reset() {
    this.ca.reset();
    this.av.reset();
    this.ecg.reset();
    this.acc = 0;
    this.lastSinus = -Infinity;
    this.lastNodeActivation = -1;
    for (const ch of this.channels) ch.buffer.clear();
  }
}
