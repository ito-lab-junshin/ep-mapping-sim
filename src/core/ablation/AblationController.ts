import type { EnergyId, Lesion, Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import type { PvName } from '../geometry/regions';
import { ABLATION } from '../params';
import { LesionField } from './LesionModel';
import { contactForceG, depositRf, lesionIndexPct, localImpedanceOhm, rfDepthFromDose, rfDoseRate, rfRadiusFromDepth } from './rf';
import { ablationSites, type AblationSites, type RfTarget } from './sites';
import { cryoDepthMm, cryoMinTempC, cryoOcclusion, depositCryo } from './cryo';
import { depositPfa, type PfaShape } from './pfa';
import { seededRandom } from '../pacing/Stimulator';
import { separated } from '../arrhythmia/common';
import { laBody, sleeveVertices } from '../arrhythmia/af';

/** 通電中・直近の通電の指標（UI に出す。テーマの機能フラグで出し分ける） */
export interface AblationMetrics {
  energy: EnergyId;
  active: boolean;
  /** 通電の経過時間 s（通電の時計） */
  elapsedS: number;
  powerW?: number;
  contactForceG?: number;
  localImpedanceOhm?: number;
  liDropOhm?: number;
  /** 独自の病変指標（その部位の目標量 = 100 %） */
  lesionIndexPct?: number;
  /** 病変指標の目標の区分（後壁／前壁） */
  rfTarget?: RfTarget;
  /** 通電点の壁厚 mm と、その点の貫壁性 %（病変の深さ / 壁厚、最大 100） */
  wallMm?: number;
  transmuralityPct?: number;
  radiusMm?: number;
  depthMm?: number;
  occlusion?: number;
  tempC?: number;
  /** クライオ：PV が隔離された時刻（通電の時計） */
  timeToIsolationS?: number | null;
  /** RF：接合部調律が出ているか */
  junctional?: boolean;
  /** RF：His 部位までの距離 mm（近いと注意） */
  hisDistanceMm?: number;
  message?: string;
}

interface Active {
  energy: 'rf' | 'cryo';
  elapsedS: number;
  targetS: number;
  /** RF：基準条件の秒数に換算した通電量 */
  dose: number;
  pv?: PvName;
  startedAt: number;
  isolatedAtS: number | null;
  nextIsolationCheckS: number;
  nextJunctional: number;
  junctional: boolean;
  last: AblationMetrics;
}

/**
 * 通電の状態機械（docs/DESIGN.md §7）。通電の時計（倍速）で病変を育て、EGM・伝播はエンジンの実時間で進む。
 *  - RF：ABL の先端の接触点に、§7 の式の半径・深さの病変。接触圧・局所インピーダンス・独自の病変指標
 *  - クライオ：選んだ PV の前庭部の帯。閉塞度・最低温度・time-to-isolation
 *  - PFA：選んだ PV に 1 回ずつ瞬時に病変（applyPfa）
 */
export class AblationController {
  readonly field: LesionField;
  readonly sites: AblationSites;
  speed: number = ABLATION.defaultClockSpeed;
  rf = { powerW: ABLATION.rf.defaultPowerW, durationS: ABLATION.rf.defaultDurationS };
  cryo = { pv: 'LSPV' as PvName, push01: 1, misalignDeg: 0, leakAngleDeg: 270, durationS: ABLATION.cryo.defaultDurationS };
  pfa = { pv: 'LSPV' as PvName, shape: 'basket' as PfaShape };
  active: Active | null = null;
  last: AblationMetrics | null = null;
  private rng = seededRandom(5);

  constructor(readonly engine: SimulationEngine) {
    this.sites = ablationSites(engine.mesh, engine.model.anatomy);
    this.field = new LesionField(engine.mesh, engine.ca.tissue, this.sites.wallMm);
  }

  private pvInfo(name: PvName) { return this.engine.model.anatomy.la.pvs.find((p) => p.name === name)!; }

  /** RF の先端：位置と接触圧（置かれて接触していなければ null） */
  private tip(): { pos: Vec3; vertex: number; cf: number } | null {
    const abl = this.engine.catheter('abl');
    if (!abl?.placed) return null;
    const e = abl.electrodes[0];
    return { pos: e.position, vertex: e.contactVertex, cf: contactForceG(e.heightMm) };
  }

  /** 通電を始める。始められなければ理由を返す */
  start(energy: 'rf' | 'cryo'): string | null {
    if (this.active) return 'すでに通電中です';
    if (energy === 'rf') {
      const t = this.tip();
      if (!t || t.vertex < 0) return 'ABL の先端が接触していません';
    }
    this.active = {
      energy, elapsedS: 0, dose: 0, targetS: energy === 'rf' ? this.rf.durationS : this.cryo.durationS,
      pv: energy === 'cryo' ? this.cryo.pv : undefined, startedAt: this.engine.time,
      isolatedAtS: null, nextIsolationCheckS: 0, nextJunctional: this.engine.time, junctional: false,
      last: { energy, active: true, elapsedS: 0 },
    };
    return null;
  }

  /** 通電を止め、病変タグを残す */
  stop() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const m = { ...a.last, active: false };
    this.last = m;
    const center = a.energy === 'rf'
      ? this.engine.query.closestPoint(this.tip()?.pos ?? this.engine.model.anatomy.anchors.sinusNode.point).vertex
      : this.engine.query.closestPoint(this.pvInfo(a.pv!).ostium).vertex;
    this.pushLesion(a.energy, center, m, a.pv ? { pv: pvIndex(a.pv) } : {});
  }

  /** PFA を 1 回通電する（瞬時） */
  applyPfa(): AblationMetrics {
    const pv = this.pvInfo(this.pfa.pv);
    depositPfa(this.field, this.engine.mesh, pv, this.pfa.shape);
    const count = this.engine.lesions.filter((l) => l.energy === 'pfa' && l.tags.pv === pvIndex(this.pfa.pv)).length + 1;
    const m: AblationMetrics = { energy: 'pfa', active: false, elapsedS: 0, message: `${this.pfa.pv} に ${count} 回目` };
    this.last = m;
    this.pushLesion('pfa', this.engine.query.closestPoint(pv.ostium).vertex, m, { pv: pvIndex(this.pfa.pv), applications: count });
    return m;
  }

  private pushLesion(energy: EnergyId, centerVertex: number, m: AblationMetrics, extra: Record<string, number> = {}) {
    const tags: Record<string, number> = { ...extra };
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number') tags[k] = v;
    this.engine.lesions.push({
      id: `L${this.engine.lesions.length + 1}`, energy, centerVertex,
      radiusMm: m.radiusMm ?? 0, transmurality: this.field.transmurality[centerVertex],
      createdAt: this.engine.time, tags,
    } as Lesion);
  }

  /** エンジンの 1 刻み（simDtMs）ごとに呼ぶ */
  step(simDtMs: number) {
    const a = this.active;
    if (!a) return;
    const dtS = (simDtMs / 1000) * this.speed;
    a.elapsedS += dtS;
    a.last = a.energy === 'rf' ? this.stepRf(a, dtS) : this.stepCryo(a);
    if (a.elapsedS >= a.targetS) this.stop();
  }

  private stepRf(a: Active, dtS: number): AblationMetrics {
    const t = this.tip();
    const e = this.engine;
    if (!t || t.vertex < 0) return { ...a.last, energy: 'rf', active: true, elapsedS: a.elapsedS, contactForceG: 0, message: '先端が離れています（病変は育ちません）' };
    // 通電量を積算し（接触圧が変われば増え方も変わる）、深さは量に対して飽和する
    a.dose += rfDoseRate(this.rf.powerW, t.cf) * dtS;
    const depth = rfDepthFromDose(a.dose);
    const r = rfRadiusFromDepth(depth);
    depositRf(this.field, e.mesh, t.pos, r, depth);
    const wall = this.sites.wallMm[t.vertex], target = this.sites.target[t.vertex];
    const index = lesionIndexPct(a.dose, target);
    const transmural = Math.min(1, depth / wall);
    const li = localImpedanceOhm(t.cf, transmural);
    // 接合部調律：遅伝導路部位の近くで通電しているあいだ、周期 500〜700 ms で接合部の興奮
    const sp = e.model.anatomy.anchors.slowPathway.point;
    const near = Math.hypot(t.pos.x - sp.x, t.pos.y - sp.y, t.pos.z - sp.z) <= ABLATION.junctionalRadiusMm + 1;
    if (near && e.time >= a.nextJunctional) {
      e.conduction.junctionalBeat(e.time);
      const [lo, hi] = ABLATION.junctionalClMs;
      a.nextJunctional = e.time + lo + this.rng() * (hi - lo);
      a.junctional = true;
    }
    const his = e.model.anatomy.anchors.his.point;
    const hisD = Math.hypot(t.pos.x - his.x, t.pos.y - his.y, t.pos.z - his.z);
    return {
      energy: 'rf', active: true, elapsedS: a.elapsedS, powerW: this.rf.powerW, contactForceG: t.cf,
      localImpedanceOhm: li.value, liDropOhm: li.drop, lesionIndexPct: index, rfTarget: target, radiusMm: r, depthMm: depth,
      wallMm: wall, transmuralityPct: transmural * 100,
      junctional: a.junctional, hisDistanceMm: hisD,
      message: hisD < ABLATION.hisWarningMm ? `注意：His 部位に近い（${hisD.toFixed(1)} mm）` : undefined,
    };
  }

  private stepCryo(a: Active): AblationMetrics {
    const e = this.engine;
    const pv = this.pvInfo(a.pv!);
    const occ = cryoOcclusion(this.cryo.push01, this.cryo.misalignDeg);
    const temp = cryoMinTempC(occ) * Math.min(1, a.elapsedS / 30); // 30 秒で最低温度に達する
    const depth = cryoDepthMm(a.elapsedS, cryoMinTempC(occ));
    depositCryo(this.field, e.mesh, pv, occ, this.cryo.leakAngleDeg, depth);
    if (a.isolatedAtS === null && a.elapsedS >= a.nextIsolationCheckS) {
      a.nextIsolationCheckS = a.elapsedS + 1;
      if (separated(e.mesh, e.ca.tissue.viability, laBody(e), new Set(sleeveVertices(e, a.pv!)))) a.isolatedAtS = a.elapsedS;
    }
    return {
      energy: 'cryo', active: true, elapsedS: a.elapsedS, occlusion: occ, tempC: temp, depthMm: depth,
      timeToIsolationS: a.isolatedAtS,
      message: occ < ABLATION.cryo.fullRingOcclusion ? '閉塞が不十分：漏れのある側に隙間が残ります' : undefined,
    };
  }

  /** 表示用の指標（通電中はその値、止まっていれば直近の通電） */
  metrics(): AblationMetrics | null { return this.active?.last ?? this.last; }
}

const PVS: PvName[] = ['LSPV', 'LIPV', 'RSPV', 'RIPV'];
export function pvIndex(name: PvName): number { return PVS.indexOf(name); }
