import type { CaseOptions, Catheter, EcgLead, EgmChannel, Lesion, SurfaceMesh, Vec3 } from '../types';
import { CellularAutomaton } from '../propagation/CellularAutomaton';
import { applyPreferentialPathways } from '../propagation/preferentialPathways';
import { EgmGenerator } from '../egm/EgmGenerator';
import { RingBuffer } from '../egm/RingBuffer';
import { farFieldV, hisSpike, localV } from '../egm/templates';
import { ConductionSystem } from '../conduction/ConductionSystem';
import { RhythmMonitor } from '../rhythm/RhythmMonitor';
import { AblationController } from '../ablation/AblationController';
import { seededRandom, Stimulator, type StimTarget } from '../pacing/Stimulator';
import { SurfaceEcg } from '../ecg/SurfaceEcg';
import type { BiatrialModel } from '../geometry/parametric/atria';
import { MeshQuery } from '../geometry/MeshQuery';
import { buildGuidedPaths, nearestS, type GuidedPath, type GuidedPathId } from '../catheter/guidedPaths';
import { placeFree, placeOnPath, type Placement } from '../catheter/placement';
import { catheterGroup, defaultCatheters, type CatheterSpec } from '../catheter/catalog';
import { EGM_HISTORY_MS, MAP_DEFAULTS, PACING_ARTIFACT_MV, SAMPLE_MS, SINUS_CYCLE_MS, TEMPLATE_AMPLITUDE_MV } from '../params';
import { add, norm, scale } from '../geometry/parametric/sdf';

export interface EngineOptions {
  sinusCycleMs?: number;
  historyMs?: number;
}

const ECG_LEADS: EcgLead[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

/** 刺激部位（docs/DESIGN.md §5.6） */
export type PacingSite = 'HRA' | 'CS_PROX' | 'CS_DIST' | 'CS_OS' | 'LOW_LATERAL_RA' | 'HALO_DIST' | 'ABL' | 'CIRC' | 'RV' | 'PARA_HIS_HIGH' | 'PARA_HIS_LOW';

export const PACING_SITE_LABEL: Record<PacingSite, string> = {
  HRA: 'HRA', CS_PROX: 'CS 近位（9-10）', CS_DIST: 'CS 遠位（1-2）', CS_OS: 'CS 口',
  LOW_LATERAL_RA: '低位外側 RA', HALO_DIST: 'ハロー遠位（1-2）', ABL: 'ABL 先端', CIRC: '環状（1-2）', RV: 'RV（心室）',
  PARA_HIS_HIGH: 'His 近傍・高出力（His＋心室を捕捉）', PARA_HIS_LOW: 'His 近傍・低出力（心室だけを捕捉）',
};

/** 異所性興奮の焦点（AF の PV トリガーなど）：周期 minCl〜maxCl ms でランダムに発火 */
export interface Focus {
  vertex: number; minClMs: number; maxClMs: number; next: number; rng: () => number;
  /**
   * 巣状 AT の巣（AT_SUBSTRATE）：外からの興奮で巣の頂点が興奮したら、そこから周期を数え直す（リセット）。
   * triggerCouplingMs があれば、はじめは休んでいて、巣の頂点が連結期 triggerCouplingMs 以下で 2 回続けて興奮すると発火を始める
   * （triggered activity。焼けて興奮しなくなると休みに戻り、浮腫が引いて生き返っても、もう一度誘発するまで発火しない）。
   * 未設定の巣（AF の PV トリガー）は決まった予定で発火し、リセットされない
   */
  resetOnCapture?: boolean;
  triggerCouplingMs?: number;
  /** 発火中か（triggerCouplingMs のある巣だけ使う） */
  active?: boolean;
  /** 最後に見た巣の頂点の興奮 */
  lastSeen?: number;
}

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
  /** 刺激伝導系（房室結節の経路・His・心室・副伝導路） */
  readonly conduction: ConductionSystem;
  readonly stimulator = new Stimulator();
  foci: Focus[] = [];
  sinusEnabled = true;
  /** 作った病変（通電ごとの記録。病変タグ） */
  lesions: Lesion[] = [];
  private _ablation: AblationController | null = null;
  /** 通電の状態機械（基質を設定したあと、最初に使うときに作る：病変の場は基質の電位を基準にする） */
  get ablation(): AblationController {
    if (!this._ablation) this._ablation = new AblationController(this);
    return this._ablation;
  }
  /** 調律の判定（見張り頂点 = CS 口付近の心房と、心室の拍） */
  readonly rhythm = new RhythmMonitor();
  readonly monitorVertex: number;
  readonly ecg = new SurfaceEcg();
  /** 症例の選択肢（シナリオの setupSubstrate が書く。複製・CaseState で引き継ぐ） */
  caseOptions: CaseOptions = {};
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
  /** 経路の入口頂点・副伝導路の心房付着部で最後に見た興奮時刻 */
  private lastEntry: number[] = [];
  private lastApSeen = -1;
  private lastArtifact = -Infinity;
  private lastMonitorSeen = -1;
  private lastVSeen = -Infinity;
  private sampler: (() => number)[] = [];
  /** 現在のサンプルでの、電極ごとの単極電位 mV（メッシュ上に置かれたカテーテル） */
  private uni = new Map<string, Float32Array>();
  /** マッピングに使うカテーテル（環状・多極・ABL）の、電極ごとの単極電位の履歴 */
  private uniHistory = new Map<string, RingBuffer[]>();
  /** カテーテルごとの「最後に動かした」ときの電極の位置と時刻（点の取得は、この時刻より後の拍だけを使う） */
  private settled = new Map<string, { positions: Vec3[]; time: number }>();

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
    this.conduction = new ConductionSystem(this.avNodeVertex);
    this.monitorVertex = model.anatomy.anchors.csOs.vertex;
    const capacity = Math.ceil((opts.historyMs ?? EGM_HISTORY_MS) / SAMPLE_MS);

    for (const lead of ECG_LEADS) {
      this.channels.push({ id: lead, catheterId: 'ecg', group: 'ecg', mode: 'surface', buffer: new RingBuffer(capacity), gain: 1 });
      this.sampler.push(() => this.ecg.sample(this.time, lead, this.conduction.vBeats));
    }

    this.specs = defaultCatheters(model);
    const uniCap = Math.ceil(MAP_DEFAULTS.unipolarHistoryMs / SAMPLE_MS);
    for (const spec of this.specs) {
      if (spec.catheter.source === 'mesh') this.uni.set(spec.catheter.id, new Float32Array(spec.catheter.electrodes.length));
      if (catheterGroup(spec.catheter.kind) === 'map' || spec.catheter.kind === 'ablation_tip') {
        this.uniHistory.set(spec.catheter.id, spec.catheter.electrodes.map(() => new RingBuffer(uniCap)));
      }
    }
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
    this.markMoved(spec.catheter);
    this.placementVersion++;
  }

  /** 電極が前の「動かした」位置から MAP_DEFAULTS.moveResetMm 以上動いたら、動かした時刻を今にする */
  private markMoved(c: Catheter) {
    if (!c.placed) { this.settled.delete(c.id); return; }
    const now = c.electrodes.map((e) => ({ ...e.position }));
    const prev = this.settled.get(c.id);
    const moved = !prev || prev.positions.length !== now.length
      || now.some((p, i) => Math.hypot(p.x - prev.positions[i].x, p.y - prev.positions[i].y, p.z - prev.positions[i].z) >= MAP_DEFAULTS.moveResetMm);
    if (moved) this.settled.set(c.id, { positions: now, time: this.time });
  }

  /** カテーテルを最後に動かした時刻 ms（点の取得はこれより後に記録された拍だけを使う）。置いていなければ +∞ */
  settledSince(catheterId: string): number {
    return this.settled.get(catheterId)?.time ?? Infinity;
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
    const until = ca.time + this.sampleMs;
    // 洞結節：最後に洞結節の部位が興奮してから（ペーシング・頻拍の興奮でもリセットされる）周期が経ったら発火
    if (this.sinusEnabled) {
      const la = t.lastActivation[this.sinusVertex];
      const last = Math.max(this.lastSinus, la >= 0 ? la : -Infinity); // -1 は未興奮
      if (ca.time - last >= this.sinusCycleMs) {
        ca.stimulate(this.sinusVertex);
        this.lastSinus = ca.time;
      }
    }
    // 異所性興奮の焦点（PV トリガーなど）
    for (const f of this.foci) {
      if (f.resetOnCapture && !this.updateResettableFocus(f)) continue;
      while (f.next <= until) {
        ca.excite(f.vertex, f.next);
        f.next += f.minClMs + f.rng() * (f.maxClMs - f.minClMs);
      }
    }
    // 予約された刺激
    for (const st of this.stimulator.take(until)) {
      if (st.target.kind === 'atrium') ca.excite(st.target.vertex, st.time);
      else if (st.target.kind === 'ventricle') this.conduction.paceVentricle(st.time);
      else if (st.target.kind === 'paraHis') this.conduction.paceParaHis(st.time, st.target.output);
      this.lastArtifact = st.time;
    }
    // 通電（通電の時計で病変を育てる。接合部調律を出すこともある）
    this._ablation?.step(this.sampleMs);
    // 刺激伝導系（His・心室・逆行伝導）
    this.conduction.advance(until);
    for (const ex of this.conduction.takeExits(until)) ca.excite(ex.vertex, ex.time);

    const prev = ca.time;
    ca.step(this.sampleMs);

    // 房室結節の経路の入口頂点・副伝導路の心房付着部に興奮が届いたか
    this.conduction.pathways.forEach((p, k) => {
      let la = t.lastActivation[p.vertex];
      if (p.region) {
        // 遅伝導路の領域：焼けた割合を更新し、入口頂点が焼けていれば領域の生きている頂点のうち最も早く興奮したものを入口にする
        let dead = 0, first = Infinity;
        for (const v of p.region) {
          if (t.viability[v] <= 0) { dead++; continue; }
          const x = t.lastActivation[v];
          if (x > (this.lastEntry[k] ?? -1) && x < first) first = x;
        }
        p.ablatedFraction = dead / p.region.length;
        if (t.viability[p.vertex] <= 0) la = first < Infinity ? first : -1;
      }
      if (la > (this.lastEntry[k] ?? -1)) {
        this.lastEntry[k] = la;
        this.conduction.atrialArrival(k, la);
      }
    });
    const ap = this.conduction.ap;
    if (ap) {
      // 副伝導路は 1 本の束：心房側の付着部のどれか 1 点が焼ければ、順行・逆行とも途絶える
      ap.interrupted = ap.vertices.some((v) => t.viability[v] <= 0);
      let first = Infinity;
      for (const v of ap.vertices) if (t.lastActivation[v] > this.lastApSeen) first = Math.min(first, t.lastActivation[v]);
      if (first < Infinity) {
        this.lastApSeen = Math.max(...ap.vertices.map((v) => t.lastActivation[v]));
        this.conduction.apAtrialArrival(first);
      }
    }

    // 調律の判定
    const m = t.lastActivation[this.monitorVertex];
    if (m > this.lastMonitorSeen) { this.lastMonitorSeen = m; this.rhythm.recordAtrial(m); }
    for (const b of this.conduction.vBeats) if (b.time > this.lastVSeen) { this.lastVSeen = b.time; this.rhythm.recordVentricular(b.time); }
    this.rhythm.update(ca.time, this.lastStimulusTime, this.stimulator.pending > 0);

    // 体表 ECG の心房成分（電気ベクトル）
    this.ecg.setAtrialDipole(this.egm.dipole(ca.time));


    // 電極ごとの単極電位を 1 回だけ計算し、双極チャンネルはその差で作る
    for (const spec of this.specs) {
      const c = spec.catheter;
      const u = this.uni.get(c.id);
      if (!u) continue;
      const hist = this.uniHistory.get(c.id);
      for (let e = 0; e < c.electrodes.length; e++) {
        u[e] = c.placed ? this.egm.unipolarAt(c.electrodes[e].position, ca.time) : 0;
        hist?.[e].push(u[e]);
      }
    }
    // 刺激アーチファクト（この刻みで刺激が入ったら全チャンネルに 1 サンプル）
    const art = this.lastArtifact > prev && this.lastArtifact <= ca.time ? PACING_ARTIFACT_MV : 0;
    for (let i = 0; i < this.channels.length; i++) this.channels[i].buffer.push(this.sampler[i]() + art);
  }

  /** 最後に届けた刺激の時刻（なければ −∞） */
  get lastStimulusTime(): number {
    const d = this.stimulator.delivered;
    return d.length ? d[d.length - 1] : -Infinity;
  }

  /** 刺激部位 → 刺激の対象（心房の頂点か心室） */
  /** カテーテルの電極からの刺激の対象：置かれて接触していればその頂点、そうでなければ捕捉しない */
  private electrodeTarget(cathId: string, electrode: number): StimTarget {
    const c = this.catheter(cathId);
    const v = c?.placed ? c.electrodes[electrode].contactVertex : -1;
    return v >= 0 ? { kind: 'atrium', vertex: v } : { kind: 'none' };
  }

  siteTarget(site: PacingSite): StimTarget {
    if (site === 'RV') return { kind: 'ventricle' };
    // His 近傍（para-Hisian）：His カテーテルの位置から。高出力は His と心室、低出力は心室だけを捕捉する（PARA_HISIAN）
    if (site === 'PARA_HIS_HIGH') return { kind: 'paraHis', output: 'high' };
    if (site === 'PARA_HIS_LOW') return { kind: 'paraHis', output: 'low' };
    const a = this.model.anatomy;
    const nearest = (cathId: string, electrode: number, fallback: number) => {
      const c = this.catheter(cathId);
      return c?.placed ? this.query.closestPoint(c.electrodes[electrode].position).vertex : fallback;
    };
    switch (site) {
      case 'HRA': return { kind: 'atrium', vertex: nearest('hra', 0, a.anchors.sinusNode.vertex) };
      case 'CS_PROX': return { kind: 'atrium', vertex: nearest('cs', 9, a.anchors.csOs.vertex) };
      case 'CS_DIST': return { kind: 'atrium', vertex: nearest('cs', 0, a.anchors.csOs.vertex) };
      case 'CS_OS': return { kind: 'atrium', vertex: a.anchors.csOs.vertex };
      case 'ABL': return { kind: 'atrium', vertex: nearest('abl', 0, a.anchors.sinusNode.vertex) };
      // 環状・ハローの電極からの刺激：電極が壁に接触していなければ捕捉しない（刺激アーチファクトだけ）
      case 'CIRC': return this.electrodeTarget('circ', 0);
      case 'HALO_DIST': return this.electrodeTarget('halo', 0);
      case 'LOW_LATERAL_RA': {
        // RA 側壁の下部（分界稜より前方、IVC より上）
        const p = add(a.ra.center, scale(norm({ x: -1, y: -0.55, z: 0.35 }), 60));
        return { kind: 'atrium', vertex: this.query.closestPoint(p).vertex };
      }
    }
    return { kind: 'ventricle' };
  }

  /** 部位 site を、時刻 times（シミュレーション時刻 ms）に刺激する予約 */
  pace(site: PacingSite, times: number[], label?: string) {
    const target = this.siteTarget(site);
    this.stimulator.schedule(times.map((time) => ({ time, target, label })));
  }

  /** リセットのある巣の状態を進める。発火しない（休み・焼けた）なら false */
  private updateResettableFocus(f: Focus): boolean {
    const t = this.ca.tissue, v = f.vertex;
    if (t.viability[v] <= 0) { f.active = f.triggerCouplingMs === undefined; f.next = Infinity; f.lastSeen = undefined; return false; }
    const la = t.lastActivation[v];
    if (la >= 0 && (f.lastSeen === undefined || la > f.lastSeen + 0.5)) {
      const prev = f.lastSeen;
      f.lastSeen = la;
      if (f.triggerCouplingMs !== undefined && !f.active) {
        if (prev !== undefined && la - prev <= f.triggerCouplingMs) f.active = true;
      }
      if (f.active !== false) f.next = la + f.minClMs + f.rng() * (f.maxClMs - f.minClMs);
    }
    if (f.active === false) return false;
    if (!Number.isFinite(f.next)) f.next = this.ca.time + f.minClMs;
    return true;
  }

  /** 巣状 AT の巣を加える（AT_SUBSTRATE。外からの興奮でリセット、triggerCouplingMs があれば誘発で始まる） */
  addResettableFocus(vertex: number, minClMs: number, maxClMs: number, triggerCouplingMs?: number, seed = 1) {
    const rng = seededRandom(seed);
    this.foci.push({ vertex, minClMs, maxClMs, rng, next: Infinity, resetOnCapture: true, triggerCouplingMs, active: triggerCouplingMs === undefined });
  }

  /** 異所性興奮の焦点を加える（seed で乱数を固定） */
  addFocus(vertex: number, minClMs: number, maxClMs: number, seed = 1) {
    const rng = seededRandom(seed);
    this.foci.push({ vertex, minClMs, maxClMs, rng, next: this.time + minClMs + rng() * (maxClMs - minClMs) });
  }

  /** 電極の単極電位の履歴（環状・多極・ABL のみ。サンプル間隔 sampleMs、最後が現在） */
  unipolarHistory(catheterId: string, electrode: number): RingBuffer | undefined {
    return this.uniHistory.get(catheterId)?.[electrode];
  }

  private recentV(windowMs = 200) { return ConductionSystem.recent(this.conduction.vTimes, this.time, windowMs); }

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
        const u = this.uni.get(cath.id)!;
        let s = u[pair[0]] - u[pair[1]];
        for (const h of ConductionSystem.recent(this.conduction.hTimes, now, 50)) s += hv.h * hisSpike(now - h);
        for (const v of this.recentV()) s += hv.v * farFieldV(now - v);
        return s;
      };
    }

    const group = catheterGroup(cath.kind);
    const ffv = group === 'hra' ? amp.farFieldV.hra : group === 'cs' ? amp.farFieldV.cs : group === 'map' ? amp.farFieldV.map : amp.farFieldV.abl;
    const u = this.uni.get(cath.id)!;
    return () => {
      if (!cath.placed) return 0;
      const now = this.time;
      let s = u[pair[0]] - u[pair[1]];
      for (const v of this.recentV()) s += ffv * farFieldV(now - v);
      return s;
    };
  }

  reset() {
    this.ca.reset();
    this.conduction.reset();
    this.stimulator.reset();
    this.lastEntry = [];
    this.lastApSeen = -1;
    this.lastArtifact = -Infinity;
    this.lastMonitorSeen = -1;
    this.lastVSeen = -Infinity;
    this.rhythm.reset();
    for (const f of this.foci) {
      if (f.resetOnCapture) { f.next = Infinity; f.lastSeen = undefined; f.active = f.triggerCouplingMs === undefined; }
      else f.next = f.minClMs + f.rng() * (f.maxClMs - f.minClMs);
    }
    this.ecg.reset();
    this.acc = 0;
    this.lastSinus = -Infinity;
    for (const ch of this.channels) ch.buffer.clear();
    for (const h of this.uniHistory.values()) for (const b of h) b.clear();
    // 時計が 0 に戻るので、動かした時刻も 0 にする（記録は消えている）
    for (const s of this.settled.values()) s.time = this.time;
  }
}
