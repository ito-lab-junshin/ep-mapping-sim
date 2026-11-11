import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES, PV_SLEEVE, REGION_ID, REGIONS, type PvName } from '../geometry/regions';
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

