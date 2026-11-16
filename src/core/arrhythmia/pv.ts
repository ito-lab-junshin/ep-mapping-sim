import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES, PV_SLEEVE, REGION_ID, REGIONS, type PvName } from '../geometry/regions';
import type { GapHint, Vec3 } from '../types';
import { GAP_MIN_COVERAGE, gapCorridor } from './gaps';
import { separated } from './common';

/** PV の頂点の集合（AF の根治判定・学習ゴールで共有する） */

/** PV のスリーブの頂点 */
export function sleeveVertices(engine: SimulationEngine, pv: PvName): number[] {
  const id = REGION_ID[PV_SLEEVE[pv]];
  const out: number[] = [];
  engine.mesh.regionOfVertex.forEach((r, v) => { if (r === id) out.push(v); });
  return out;
}

/** スリーブの先端（PV 口から最も遠い）の頂点：トリガーの位置 */
export function sleeveTip(engine: SimulationEngine, pv: PvName): number {
  const info = engine.model.anatomy.la.pvs.find((p) => p.name === pv)!;
  const p = engine.mesh.positions;
  let best = -1, bestA = -Infinity;
  for (const v of sleeveVertices(engine, pv)) {
    const a = (p[3 * v] - info.ostium.x) * info.frame.axis.x + (p[3 * v + 1] - info.ostium.y) * info.frame.axis.y + (p[3 * v + 2] - info.ostium.z) * info.frame.axis.z;
    if (a > bestA) { bestA = a; best = v; }
  }
  return best;
}

/** entrance block が成立している（LA 本体からスリーブに届かない）PV */
export function isolatedPvs(engine: SimulationEngine): PvName[] {
  const body = laBody(engine);
  return PV_NAMES.filter((pv) => separated(engine.mesh, engine.ca.tissue.viability, body, new Set(sleeveVertices(engine, pv))));
}

/** LA 本体（PV のスリーブ・口以外）の頂点 */
export function laBody(engine: SimulationEngine): number[] {
  const la = engine.mesh.parts![0];
  const out: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    const r = REGIONS[engine.mesh.regionOfVertex[v]];
    if (!r.endsWith('_sleeve') && !r.endsWith('_ostium')) out.push(v);
  }
  return out;
}


/** PV の隙間の候補（教育用の補助。実機の機能ではない） */
export interface PvGaps {
  pv: PvName;
  isolated: boolean;
  /** この PV のまわりを病変が囲んでいる割合 0〜1（口の軸のまわりを GAP_SECTORS に分け、病変のある区画の割合） */
  encircled: number;
  /** 隙間を示せる（隔離されておらず、半周以上を囲み、通り道が病変のそばを抜けている）。半周未満では隙間の位置を示さない */
  touchesLesion: boolean;
  /** 隙間の候補：スリーブから LA 本体への最短の通り道（生きた頂点）のうち、病変から GAP_LESION_MM 以内の頂点 */
  vertices: number[];
  /** 候補のつながったかたまり（隙間）ごとの中心と頂点数 */
  clusters: { center: Vec3; size: number }[];
}

/** この PV のまわりの病変とみなす、口の中心からの距離（PV の半径 + この値 mm 以内で、ほかの PV より近い）。教育用近似 */
const GAP_AROUND_MM = 12;
/** 囲んでいる割合を数える区画の数（教育用近似） */
const GAP_SECTORS = 24;

/**
 * PV の隙間の候補（QA の所見 6〜8）：スリーブから LA 本体へ、生きた頂点だけを通る最短の通り道を求め（isolatedPvs と同じ基準。浮腫を含む急性の状態）、
 * その道のうち病変のそばを抜ける所を隙間とする（gapCorridor）
 */
export function pvGaps(engine: SimulationEngine, pv: PvName): PvGaps {
  const la = engine.mesh.parts![0], via = engine.ca.tissue.viability, P = engine.mesh.positions;
  const allowed = new Uint8Array(via.length);
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) allowed[v] = 1;
  // この PV のまわりの死んだ頂点（病変）。隣の PV のまわりの病変は数えない
  const pvs = engine.model.anatomy.la.pvs;
  const rel = (q: { ostium: Vec3; radius: number }, v: number) =>
    Math.hypot(P[3 * v] - q.ostium.x, P[3 * v + 1] - q.ostium.y, P[3 * v + 2] - q.ostium.z) - q.radius;
  const self = pvs.find((q) => q.name === pv)!;
  const dead: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    if (via[v] > 0) continue;
    const r = rel(self, v);
    if (r <= GAP_AROUND_MM && pvs.every((q) => q === self || rel(q, v) >= r)) dead.push(v);
  }
  // 口の軸のまわりの区画ごとに、病変があるか
  const f = self.frame, sectors = new Set<number>();
  for (const v of dead) {
    const dx = P[3 * v] - self.ostium.x, dy = P[3 * v + 1] - self.ostium.y, dz = P[3 * v + 2] - self.ostium.z;
    const a = Math.atan2(dx * f.v.x + dy * f.v.y + dz * f.v.z, dx * f.u.x + dy * f.u.y + dz * f.u.z);
    sectors.add(Math.min(GAP_SECTORS - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * GAP_SECTORS)));
  }
  const encircled = sectors.size / GAP_SECTORS;
  const g = gapCorridor(engine, sleeveVertices(engine, pv), laBody(engine), allowed, encircled >= GAP_MIN_COVERAGE ? dead : []);
  if (!g.connected) return { pv, isolated: true, encircled: 1, touchesLesion: false, vertices: [], clusters: [] };
  return { pv, isolated: false, encircled, touchesLesion: g.vertices.length > 0, vertices: g.vertices, clusters: g.clusters };
}

/** 隙間のヒントの一覧（AF：PV 4 本） */
export function pvGapHints(engine: SimulationEngine): GapHint[] {
  return PV_NAMES.map((pv) => {
    const g = pvGaps(engine, pv);
    return { name: pv, complete: g.isolated, completeLabel: '隔離', incompleteLabel: '未隔離', coverageLabel: '一周', coverage: g.encircled, showGaps: g.touchesLesion, clusters: g.clusters };
  });
}
