import type { SimulationEngine } from '../sim/SimulationEngine';
import type { Vec3 } from '../types';
import { MinHeap } from '../util/MinHeap';

/**
 * 隙間のヒント（教育用の補助。実機の機能ではない）の共通部分：生きた頂点だけを通る最短の通り道と、
 * その道が病変のそばを抜ける所（隙間）。PV（pvGaps）と CTI の線（ctiGapHint）で使う
 */

/** 最短の通り道とみなす余裕 mm、病変のそばとみなす距離 mm（表示用の目安。教育用近似） */
export const GAP_SLACK_MM = 2;
export const GAP_LESION_MM = 4;
/** 隙間を示し始める、病変が覆っている割合（PV は一周の半分、CTI は線の長さの半分。教育用近似） */
export const GAP_MIN_COVERAGE = 0.5;

/** 生きた（viability > 0）頂点のうち allowed[v] が 1 のものだけをたどる、seeds からの表面距離 mm（Dijkstra） */
export function liveDistance(engine: SimulationEngine, seeds: Iterable<number>, allowed: Uint8Array): Float64Array {
  const via = engine.ca.tissue.viability, nb = engine.mesh.neighbors, P = engine.mesh.positions;
  const dist = new Float64Array(via.length).fill(Infinity);
  const heap = new MinHeap();
  for (const s of seeds) if (via[s] > 0 && allowed[s]) { dist[s] = 0; heap.push(0, s); }
  while (heap.size > 0) {
    const { time: d, v } = heap.pop();
    if (d > dist[v]) continue;
    for (const u of nb[v]) {
      if (via[u] <= 0 || !allowed[u]) continue;
      const nd = d + Math.hypot(P[3 * u] - P[3 * v], P[3 * u + 1] - P[3 * v + 1], P[3 * u + 2] - P[3 * v + 2]);
      if (nd < dist[u]) { dist[u] = nd; heap.push(nd, u); }
    }
  }
  return dist;
}

export interface GapCorridor {
  /** from と to が生きた頂点でつながっている */
  connected: boolean;
  /** 最短の通り道のうち、病変（dead）から GAP_LESION_MM 以内の頂点 */
  vertices: number[];
  /** その頂点のつながったかたまり（隙間）ごとの中心と頂点数 */
  clusters: { center: Vec3; size: number }[];
}

/**
 * from から to へ、allowed の中の生きた頂点だけを通る最短の通り道（長さ L + GAP_SLACK_MM 以内の頂点の帯）を求め、
 * その帯のうち病変 dead のそばを抜ける所を隙間とする。最も短い通り道だけを示すので、隙間が複数あるときは 1 つ塞ぐと次が出る
 */
export function gapCorridor(engine: SimulationEngine, from: number[], to: number[], allowed: Uint8Array, dead: number[]): GapCorridor {
  const df = liveDistance(engine, from, allowed);
  const dt = liveDistance(engine, to, allowed);
  let L = Infinity;
  for (const v of to) if (df[v] < L) L = df[v];
  if (!Number.isFinite(L)) return { connected: false, vertices: [], clusters: [] };
  if (!dead.length) return { connected: true, vertices: [], clusters: [] };
  const P = engine.mesh.positions;
  const near = (v: number) => dead.some((w) => Math.hypot(P[3 * v] - P[3 * w], P[3 * v + 1] - P[3 * w + 1], P[3 * v + 2] - P[3 * w + 2]) <= GAP_LESION_MM);
  const vertices: number[] = [];
  for (let v = 0; v < allowed.length; v++) if (allowed[v] && df[v] + dt[v] <= L + GAP_SLACK_MM && near(v)) vertices.push(v);
  const isIn = new Set(vertices), done = new Set<number>();
  const clusters: GapCorridor['clusters'] = [];
  for (const s of vertices) {
    if (done.has(s)) continue;
    const comp = [s]; done.add(s);
    for (let i = 0; i < comp.length; i++) for (const u of engine.mesh.neighbors[comp[i]]) if (isIn.has(u) && !done.has(u)) { done.add(u); comp.push(u); }
    const c = comp.reduce((a, v) => ({ x: a.x + P[3 * v] / comp.length, y: a.y + P[3 * v + 1] / comp.length, z: a.z + P[3 * v + 2] / comp.length }), { x: 0, y: 0, z: 0 });
    clusters.push({ center: engine.query.closestPoint(c, comp).point, size: comp.length });
  }
  return { connected: true, vertices, clusters };
}
