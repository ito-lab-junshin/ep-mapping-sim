import type { Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { REGION_ID, REGIONS } from '../geometry/regions';
import { separated } from './common';

/**
 * SVC の心筋スリーブ（AF-2：非 PV トリガー）。docs/DESIGN.md §5.1。
 * SVC の管（RA から先）を、PV のスリーブと同じ扱いの心筋スリーブとみなす。
 */

/** SVC のスリーブの頂点（領域 svc） */
export function svcVertices(engine: SimulationEngine): number[] {
  const id = REGION_ID.svc;
  const out: number[] = [];
  engine.mesh.regionOfVertex.forEach((r, v) => { if (r === id) out.push(v); });
  return out;
}

/** SVC の軸方向の位置（開口＝管の先端が 0、RA 側が負） */
function axial(engine: SimulationEngine, p: Vec3): number {
  const o = engine.model.anatomy.ra.svc;
  return (p.x - o.center.x) * o.axis.x + (p.y - o.center.y) * o.axis.y + (p.z - o.center.z) * o.axis.z;
}

/** SVC のスリーブの先端（RA から最も遠い）の頂点：SVC トリガーの位置 */
export function svcTip(engine: SimulationEngine): number {
  let best = -1, bestA = -Infinity;
  for (const v of svcVertices(engine)) {
    const a = axial(engine, engine.query.position(v));
    if (a > bestA) { bestA = a; best = v; }
  }
  return best;
}

/** RA 本体（SVC のスリーブ以外の RA の頂点。exit block の判定に使う） */
export function raBody(engine: SimulationEngine): number[] {
  const ra = engine.mesh.parts![1];
  const out: number[] = [];
  for (let v = ra.vertexStart; v < ra.vertexStart + ra.vertexCount; v++) if (REGIONS[engine.mesh.regionOfVertex[v]] !== 'svc') out.push(v);
  return out;
}

/**
 * 隔離の判定に使う SVC の遠位側：SVC–RA 接合部から SVC_ISOLATION_LEVEL_MM 以上上のスリーブ（トリガーのある側）。
 * 接合部のすぐ上で一周すれば隔離になる（洞結節を避けて接合部より少し上で焼く）。仮定値
 */
export const SVC_ISOLATION_LEVEL_MM = 6;
export function svcDistalVertices(engine: SimulationEngine): number[] {
  const len = engine.model.dimensions.vein.svcLength ?? engine.model.dimensions.vein.length;
  return svcVertices(engine).filter((v) => axial(engine, engine.query.position(v)) >= -(len - SVC_ISOLATION_LEVEL_MM));
}

/** SVC の entrance block：病変で RA 本体から SVC の遠位側（svcDistalVertices）に届かない */
export function svcIsolated(engine: SimulationEngine): boolean {
  return separated(engine.mesh, engine.ca.tissue.viability, raBody(engine), new Set(svcDistalVertices(engine)));
}

/**
 * 右横隔神経の走行（模式・仮定値）：SVC の後外側の壁に沿って、SVC の先端から SVC–RA 接合部の 10 mm 下まで下る線。
 * 実際の走行には個人差が大きい。教育用の注意表示だけに使う（横隔神経麻痺は再現しない）
 */
export function phrenicNerveLine(engine: SimulationEngine): [Vec3, Vec3] {
  const o = engine.model.anatomy.ra.svc;
  const len = engine.model.dimensions.vein.svcLength ?? engine.model.dimensions.vein.length;
  const a = o.axis;
  // 後外側（右 = −x、後 = −z）を軸に垂直な成分にする
  const d = { x: -1, y: 0, z: -0.6 };
  const k = d.x * a.x + d.y * a.y + d.z * a.z;
  const q = { x: d.x - k * a.x, y: d.y - k * a.y, z: d.z - k * a.z };
  const l = Math.hypot(q.x, q.y, q.z);
  const side = { x: (q.x / l) * o.radius, y: (q.y / l) * o.radius, z: (q.z / l) * o.radius };
  const top = { x: o.center.x + side.x, y: o.center.y + side.y, z: o.center.z + side.z };
  const down = len + 10;
  const bottom = { x: top.x - a.x * down, y: top.y - a.y * down, z: top.z - a.z * down };
  return [top, bottom];
}

/** 点 p から線分 ab までの距離 mm */
export function segmentDistanceMm(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / (ab.x ** 2 + ab.y ** 2 + ab.z ** 2)));
  return Math.hypot(p.x - (a.x + t * ab.x), p.y - (a.y + t * ab.y), p.z - (a.z + t * ab.z));
}

/** SVC–RA 接合部の少し上（SVC 側）を一周する点列：SVC 隔離の標準の通電（研究用・テスト用） */
export function svcRingPoints(engine: SimulationEngine, spacingMm = 4, aboveJunctionMm = 4): Vec3[] {
  const o = engine.model.anatomy.ra.svc;
  const len = engine.model.dimensions.vein.svcLength ?? engine.model.dimensions.vein.length;
  const a = o.axis;
  const ref = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let u = { x: a.y * ref.z - a.z * ref.y, y: a.z * ref.x - a.x * ref.z, z: a.x * ref.y - a.y * ref.x };
  const ul = Math.hypot(u.x, u.y, u.z); u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const w = { x: a.y * u.z - a.z * u.y, y: a.z * u.x - a.x * u.z, z: a.x * u.y - a.y * u.x };
  const h = -(len - aboveJunctionMm);
  const c = { x: o.center.x + a.x * h, y: o.center.y + a.y * h, z: o.center.z + a.z * h };
  const n = Math.max(8, Math.ceil((2 * Math.PI * o.radius) / spacingMm));
  const svc = svcVertices(engine);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const q = { x: c.x + o.radius * (Math.cos(th) * u.x + Math.sin(th) * w.x), y: c.y + o.radius * (Math.cos(th) * u.y + Math.sin(th) * w.y), z: c.z + o.radius * (Math.cos(th) * u.z + Math.sin(th) * w.z) };
    out.push(engine.query.closestPoint(q, svc).point);
  }
  return out;
}
