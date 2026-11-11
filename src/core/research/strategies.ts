import type { ArrhythmiaId, Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES } from '../geometry/regions';
import { REGION_ID } from '../geometry/regions';
import type { PfaShape } from '../ablation/pfa';

/** 一括実行の通電の条件（症例ごとの標準の通電の仕方で行う） */
export interface AblationPlan {
  energy: 'rf' | 'cryo' | 'pfa';
  /** RF：出力 W・時間 s・先端の壁からの距離 mm（接触圧はここから。既定 1 mm）・点の間隔 mm */
  powerW?: number;
  durationS?: number;
  heightMm?: number;
  spacingMm?: number;
  /** クライオ：押し付け 0〜1・軸のずれ deg・時間 s */
  push01?: number;
  misalignDeg?: number;
  /** PFA：形と、PV ごとの回数 */
  shape?: PfaShape;
  applications?: number;
}

const finish = (e: SimulationEngine) => { e.ablation.speed = 1000; while (e.ablation.active) e.ablation.step(e.sampleMs); };

function rfAt(e: SimulationEngine, point: Vec3, p: AblationPlan) {
  e.setPlacement('abl', { kind: 'free', point, heightMm: p.heightMm ?? 1, rotationDeg: 0 });
  e.ablation.rf = { powerW: p.powerW ?? 30, durationS: p.durationS ?? 30 };
  if (e.ablation.start('rf') === null) finish(e);
}

/** PV 口の前庭部を一周する点（口から LA 側 2 mm、口の半径 + 3 mm） */
export function pvRingPoints(e: SimulationEngine, pv: (typeof PV_NAMES)[number], spacingMm = 5): Vec3[] {
  const info = e.model.anatomy.la.pvs.find((x) => x.name === pv)!, f = info.frame, R = info.radius + 3;
  const n = Math.ceil((2 * Math.PI * R) / spacingMm);
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n, c = Math.cos(a) * R, s = Math.sin(a) * R;
    return e.query.closestPoint({
      x: info.ostium.x + f.u.x * c + f.v.x * s - f.axis.x * 2,
      y: info.ostium.y + f.u.y * c + f.v.y * s - f.axis.y * 2,
      z: info.ostium.z + f.u.z * c + f.v.z * s - f.axis.z * 2,
    }).point;
  });
}

/** CTI の線の点（三尖弁輪 → IVC の口、その先 IVC の中まで） */
export function ctiLinePoints(e: SimulationEngine, spacingMm = 4): Vec3[] {
  const a = e.model.anatomy.anchors, p = a.ctiTv.point, q = a.ctiIvc.point;
  const cti: number[] = [];
  e.mesh.regionOfVertex.forEach((r, v) => { if (r === REGION_ID.cti) cti.push(v); });
  const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / spacingMm);
  const out: Vec3[] = [];
  for (let k = 0; k <= n + 2; k++) {
    const t = k / n, chord = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
    out.push((t <= 1 ? e.query.closestPoint(chord, cti) : e.query.closestPoint(chord)).point);
  }
  return out;
}

/**
 * 症例ごとの標準の通電：AF = 4 本の PVI（RF は前庭部を一周、クライオ・PFA は PV ごと）、
 * AFL = CTI の線、AVNRT = 遅伝導路の部位、WPW = 副伝導路の部位。クライオ・PFA は AF だけ
 */
export function applyStandardAblation(e: SimulationEngine, scenario: ArrhythmiaId, plan: AblationPlan) {
  if (plan.energy !== 'rf' && scenario !== 'af') throw new Error(`${plan.energy} は AF の症例だけで使えます`);
  if (plan.energy === 'cryo') {
    for (const pv of PV_NAMES) {
      e.ablation.cryo = { ...e.ablation.cryo, pv, push01: plan.push01 ?? 1, misalignDeg: plan.misalignDeg ?? 0, durationS: plan.durationS ?? e.ablation.cryo.durationS };
      e.ablation.start('cryo');
      finish(e);
    }
    return;
  }
  if (plan.energy === 'pfa') {
    for (const pv of PV_NAMES) {
      e.ablation.pfa = { pv, shape: plan.shape ?? 'basket' };
      for (let k = 0; k < (plan.applications ?? 2); k++) e.ablation.applyPfa();
    }
    return;
  }
  const anchors = e.model.anatomy.anchors;
  switch (scenario) {
    case 'af': for (const pv of PV_NAMES) for (const p of pvRingPoints(e, pv, plan.spacingMm ?? 5)) rfAt(e, p, plan); break;
    case 'afl_cti': case 'afl_cti_cw': for (const p of ctiLinePoints(e, plan.spacingMm ?? 4)) rfAt(e, p, plan); break;
    case 'avnrt': rfAt(e, anchors.slowPathway.point, plan); break;
    case 'wpw': {
      const ap = e.conduction.ap!.vertices;
      rfAt(e, e.query.position(ap[Math.floor(ap.length / 2)]), plan);
      break;
    }
  }
}
