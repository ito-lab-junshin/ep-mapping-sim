import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES, PV_SLEEVE, REGION_ID, REGIONS, type PvName } from '../geometry/regions';
import type { Vec3 } from '../types';
import { MinHeap } from '../util/MinHeap';
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


/** PV の隙間の候補（教育用の補助、チュートリアル中だけ表示。実機の機能ではない） */
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

/** 最短の通り道とみなす余裕 mm、病変のそばとみなす距離 mm（表示用の目安。教育用近似） */
const GAP_SLACK_MM = 2;
const GAP_LESION_MM = 4;
/** この PV のまわりの病変とみなす、口の中心からの距離（PV の半径 + この値 mm 以内で、ほかの PV より近い）。教育用近似 */
const GAP_AROUND_MM = 12;
/** 囲んでいる割合を数える区画の数と、隙間を示し始める割合（教育用近似） */
const GAP_SECTORS = 24;
const GAP_MIN_ENCIRCLED = 0.5;

/** 生きた（viability > 0）LA の頂点だけをたどる、seeds からの表面距離 mm（Dijkstra） */
function liveDistance(engine: SimulationEngine, seeds: number[]): Float64Array {
  const via = engine.ca.tissue.viability, nb = engine.mesh.neighbors, P = engine.mesh.positions;
  const dist = new Float64Array(via.length).fill(Infinity);
  const heap = new MinHeap();
  for (const s of seeds) if (via[s] > 0) { dist[s] = 0; heap.push(0, s); }
  while (heap.size > 0) {
    const { time: d, v } = heap.pop();
    if (d > dist[v]) continue;
    for (const u of nb[v]) {
      if (via[u] <= 0) continue;
      const nd = d + Math.hypot(P[3 * u] - P[3 * v], P[3 * u + 1] - P[3 * v + 1], P[3 * u + 2] - P[3 * v + 2]);
      if (nd < dist[u]) { dist[u] = nd; heap.push(nd, u); }
    }
  }
  return dist;
}

/**
 * PV の隙間の候補（QA の所見 6〜8）：スリーブから LA 本体へ、生きた頂点だけを通る最短の通り道を求め（isolatedPvs と同じ基準。浮腫を含む急性の状態）、
 * その道のうち病変のそばを抜ける所を隙間とする。最も短い通り道だけを示すので、隙間が複数あるときは 1 つ塞ぐと次が出る
 */
export function pvGaps(engine: SimulationEngine, pv: PvName): PvGaps {
  const body = laBody(engine);
  const ds = liveDistance(engine, sleeveVertices(engine, pv));
  const db = liveDistance(engine, body);
  let L = Infinity;
  for (const v of body) if (ds[v] < L) L = ds[v];
  if (!Number.isFinite(L)) return { pv, isolated: true, encircled: 1, touchesLesion: false, vertices: [], clusters: [] };
  const la = engine.mesh.parts![0], via = engine.ca.tissue.viability, P = engine.mesh.positions;
  const corridor: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) if (ds[v] + db[v] <= L + GAP_SLACK_MM) corridor.push(v);
  // この PV のまわりの死んだ頂点（病変）。隣の PV のまわりの病変は数えない（隣の PV の通り道が近くを通っても隙間にしない）
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
  const near = (v: number) => dead.some((w) => Math.hypot(P[3 * v] - P[3 * w], P[3 * v + 1] - P[3 * w + 1], P[3 * v + 2] - P[3 * w + 2]) <= GAP_LESION_MM);
  // 口の軸のまわりの区画ごとに、病変があるか
  const f = self.frame, sectors = new Set<number>();
  for (const v of dead) {
    const dx = P[3 * v] - self.ostium.x, dy = P[3 * v + 1] - self.ostium.y, dz = P[3 * v + 2] - self.ostium.z;
    const a = Math.atan2(dx * f.v.x + dy * f.v.y + dz * f.v.z, dx * f.u.x + dy * f.u.y + dz * f.u.z);
    sectors.add(Math.min(GAP_SECTORS - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * GAP_SECTORS)));
  }
  const encircled = sectors.size / GAP_SECTORS;
  const vertices = encircled >= GAP_MIN_ENCIRCLED ? corridor.filter(near) : [];
  const isIn = new Set(vertices), done = new Set<number>();
  const clusters: PvGaps['clusters'] = [];
  for (const s of vertices) {
    if (done.has(s)) continue;
    const comp = [s]; done.add(s);
    for (let i = 0; i < comp.length; i++) for (const u of engine.mesh.neighbors[comp[i]]) if (isIn.has(u) && !done.has(u)) { done.add(u); comp.push(u); }
    const c = comp.reduce((a, v) => ({ x: a.x + P[3 * v] / comp.length, y: a.y + P[3 * v + 1] / comp.length, z: a.z + P[3 * v + 2] / comp.length }), { x: 0, y: 0, z: 0 });
    clusters.push({ center: engine.query.closestPoint(c, comp).point, size: comp.length });
  }
  return { pv, isolated: false, encircled, touchesLesion: vertices.length > 0, vertices, clusters };
}
