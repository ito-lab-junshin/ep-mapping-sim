import type { Catheter, EcgLead, EgmChannel, SurfaceMesh } from '../types';
import { CellularAutomaton } from '../propagation/CellularAutomaton';
import { applyPreferentialPathways } from '../propagation/preferentialPathways';
import { EgmGenerator } from '../egm/EgmGenerator';
import { RingBuffer } from '../egm/RingBuffer';
import { farFieldV, hisSpike, localV } from '../egm/templates';
import { AvConduction } from '../conduction/AvConduction';
import { SurfaceEcg } from '../ecg/SurfaceEcg';
import type { BiatrialModel } from '../geometry/parametric/atria';
import { MeshQuery } from '../geometry/MeshQuery';
import { buildGuidedPaths, nearestS, type GuidedPath, type GuidedPathId } from '../catheter/guidedPaths';
import { placeFree, placeOnPath, type Placement } from '../catheter/placement';
import { catheterGroup, defaultCatheters, type CatheterSpec } from '../catheter/catalog';
import { EGM_HISTORY_MS, SAMPLE_MS, SINUS_CYCLE_MS, TEMPLATE_AMPLITUDE_MV } from '../params';
import { scale } from '../geometry/parametric/sdf';

export interface EngineOptions {
  sinusCycleMs?: number;
  historyMs?: number;
}

const ECG_LEADS: EcgLead[] = ['I', 'II', 'V1'];

/**
 * 1 症例ぶんのシミュレーション（UI 非依存）。
 * 両心房メッシュ上のセルオートマトン・洞結節タイマー・房室伝導・EGM／体表 ECG のサンプリングを進める。
 * 描画側は tick() で進め、channels のバッファを直接読む。
 */
export class SimulationEngine {
  readonly sampleMs = SAMPLE_MS;
  readonly mesh: SurfaceMesh;
  readonly ca: CellularAutomaton;
  readonly egm: EgmGenerator;
  readonly av = new AvConduction();
  readonly ecg = new SurfaceEcg();
  readonly query: MeshQuery;
  readonly paths: Record<GuidedPathId, GuidedPath>;
  readonly sinusVertex: number;
  readonly avNodeVertex: number;
  readonly specs: CatheterSpec[];
  readonly channels: EgmChannel[] = [];
  /** 配置が変わるたびに増える（3D・UI の更新用） */
  placementVersion = 0;
  sinusCycleMs: number;

  private acc = 0;
  private lastSinus = -Infinity;
  private lastNodeActivation = -1;
  private sampler: (() => number)[] = [];

  constructor(readonly model: BiatrialModel, opts: EngineOptions = {}) {
    this.mesh = model.mesh;
    this.ca = new CellularAutomaton(this.mesh);
    applyPreferentialPathways(this.mesh, this.ca.tissue);
    this.egm = new EgmGenerator(this.mesh, this.ca.tissue);
    this.query = new MeshQuery(this.mesh);
    this.paths = buildGuidedPaths(model, this.query);
    this.sinusVertex = model.anatomy.anchors.sinusNode.vertex;
    this.avNodeVertex = model.anatomy.anchors.avNode.vertex;
    this.sinusCycleMs = opts.sinusCycleMs ?? SINUS_CYCLE_MS;
    const capacity = Math.ceil((opts.historyMs ?? EGM_HISTORY_MS) / SAMPLE_MS);

    for (const lead of ECG_LEADS) {
      this.channels.push({ id: lead, catheterId: 'ecg', group: 'ecg', mode: 'surface', buffer: new RingBuffer(capacity), gain: 1 });
      this.sampler.push(() => this.ecg.sample(this.time, lead, this.av.vTimes));
    }

    this.specs = defaultCatheters(model);
    for (const spec of this.specs) {
      if (spec.placement?.kind === 'path' && spec.pathId && Number.isNaN(spec.placement.s)) {
        spec.placement = { ...spec.placement, s: this.paths[spec.pathId].defaultS };
      }
      this.applyPlacement(spec);
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

  spec(id: string): CatheterSpec | undefined { return this.specs.find((s) => s.catheter.id === id); }

  catheter(id: string): Catheter | undefined { return this.spec(id)?.catheter; }

  /** カテーテルを置く（null で取り外す）。RV（合成）には何もしない */
  setPlacement(catheterId: string, placement: Placement | null) {
    const spec = this.spec(catheterId);
    if (!spec || spec.mode === 'synthetic') return;
    if (placement && (placement.kind === 'path') !== (spec.mode === 'path')) throw new Error(`placement kind mismatch for ${catheterId}`);
    spec.placement = placement;
    this.applyPlacement(spec);
    this.placementVersion++;
  }

  /** 経路カテーテルを、3D 上の点に最も近い経路位置へ動かす（ドラッグ操作用） */
  dragOnPath(catheterId: string, point: { x: number; y: number; z: number }) {
    const spec = this.spec(catheterId);
    if (!spec?.pathId || spec.placement?.kind !== 'path') return;
    this.setPlacement(catheterId, { ...spec.placement, s: nearestS(this.paths[spec.pathId], point) });
  }

  private applyPlacement(spec: CatheterSpec) {
    const c = spec.catheter;
    const p = spec.placement;
    if (spec.mode === 'synthetic') return;
    if (!p) { c.placed = false; return; }
    if (p.kind === 'path' && spec.pathId) {
      const path = this.paths[spec.pathId];
      // His：遠位電極を三尖弁輪の縁に置き、近位電極は弁輪から心房側（中隔）へ並べる
      const away = spec.pathId === 'his' ? scale(this.model.anatomy.ra.tricuspid.axis, -1) : undefined;
      c.electrodes = placeOnPath(this.query, path, spec.layoutMm ?? [], p, away);
    } else if (p.kind === 'free') {
      c.electrodes = placeFree(this.query, this.model, c.kind, p, spec.layoutMm ?? []);
    }
    c.placed = true;
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

    if (cath.kind === 'rv_quadripolar') {
      return () => {
        const now = this.time;
        let s = 0;
        for (const v of this.recentV()) s += amp.rv.v * localV(now - v - amp.rv.delayMs);
        return s;
      };
    }

    if (cath.kind === 'his_quadripolar') {
      // A：Koch 三角のメッシュから φ モデル、H・V：房室伝導のタイミングから合成
      const hv = pair[0] === 0 ? amp.his.d : amp.his.p;
      return () => {
        if (!cath.placed) return 0;
        const now = this.time;
        let s = this.egm.bipolar(cath, pair, now);
        for (const h of AvConduction.recent(this.av.hTimes, now, 50)) s += hv.h * hisSpike(now - h);
        for (const v of this.recentV()) s += hv.v * farFieldV(now - v);
        return s;
      };
    }

    const group = catheterGroup(cath.kind);
    const ffv = group === 'hra' ? amp.farFieldV.hra : group === 'cs' ? amp.farFieldV.cs : amp.farFieldV.abl;
    return () => {
      if (!cath.placed) return 0;
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
