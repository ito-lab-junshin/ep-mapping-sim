import type { Vec3 } from '../types';
import type { BiatrialModel } from '../geometry/parametric/atria';
import { MeshQuery, tangent } from '../geometry/MeshQuery';
import { add, dist, dot, norm, scale, sub, v3, cross } from '../geometry/parametric/sdf';
import { CS_PATH } from '../params';

/**
 * 経路に沿って動かすカテーテル（CS・His・HRA）の経路（docs/DESIGN.md §10）。
 * 経路は折れ線で、長さ s mm の位置で電極を置く。
 */
export type GuidedPathId = 'cs' | 'his' | 'hra';

export interface GuidedPath {
  id: GuidedPathId;
  points: Vec3[];
  /** 各点までの累積長 mm */
  cum: number[];
  length: number;
  /** true：表面上の経路（電極は表面から heightMm 内側）、false：心外膜側（CS 内腔） */
  onSurface: boolean;
  /** 経路上の既定位置 mm（遠位電極） */
  defaultS: number;
  /** 遠位電極から近位電極へ進む向き（+1 = 経路の先へ、-1 = 経路の始点へ） */
  proximalDirection: 1 | -1;
}

function polyline(id: GuidedPathId, points: Vec3[], onSurface: boolean, defaultS: number, proximalDirection: 1 | -1): GuidedPath {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  return { id, points, cum, length: cum[cum.length - 1], onSurface, defaultS: Math.min(defaultS, cum[cum.length - 1]), proximalDirection };
}

/** 経路上の長さ s の点（範囲外は端に丸める） */
export function pointAt(path: GuidedPath, s: number): Vec3 {
  const t = Math.max(0, Math.min(path.length, s));
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < t) i++;
  const seg = path.cum[i] - path.cum[i - 1] || 1;
  const u = (t - path.cum[i - 1]) / seg;
  const a = path.points[i - 1], b = path.points[i];
  return add(a, scale(sub(b, a), u));
}

/** 点 q に最も近い経路上の長さ s（ドラッグ操作用） */
export function nearestS(path: GuidedPath, q: Vec3): number {
  let best = 0, bestD = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    const ab = sub(b, a);
    const u = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
    const d = dist(q, add(a, scale(ab, u)));
    if (d < bestD) { bestD = d; best = path.cum[i - 1] + u * (path.cum[i] - path.cum[i - 1]); }
  }
  return best;
}

/** 縁の頂点を開口の軸まわりの角度で並べる */
function sortAround(q: MeshQuery, verts: number[], center: Vec3, axis: Vec3, ref: Vec3): { v: number; angle: number }[] {
  const u = tangent(ref, axis);
  const w = cross(axis, u);
  return verts.map((v) => {
    const d = sub(q.position(v), center);
    return { v, angle: Math.atan2(dot(d, w), dot(d, u)) };
  }).sort((a, b) => a.angle - b.angle);
}

/** 表面を歩いて作る経路 */
function surfaceWalk(q: MeshQuery, start: Vec3, dir: Vec3, lengthMm: number): Vec3[] {
  const pts: Vec3[] = [];
  let hit = q.closestPoint(start);
  let d = dir;
  pts.push(hit.point);
  for (let s = 0; s < lengthMm; s += 2) {
    const next = q.walk(hit.point, tangent(d, hit.normal), 2);
    if (dist(next.point, hit.point) < 0.5) break;
    d = norm(sub(next.point, hit.point));
    hit = next;
    pts.push(hit.point);
  }
  return pts;
}

export function buildGuidedPaths(model: BiatrialModel, q: MeshQuery): Record<GuidedPathId, GuidedPath> {
  const { anatomy } = model;
  const la = anatomy.la, ra = anatomy.ra;

  // ── CS：RA 内の CS 口の手前 → CS 口 → 僧帽弁輪の後方に沿って側壁へ（心外膜側）
  const mv = la.mitral;
  const rim = sortAround(q, anatomy.rims.mitral, mv.center, mv.axis, v3(0, 0, -1));
  // CS 口に最も近い縁の点から始め、後壁（−z）側を回って側壁（+x）へ半周
  const csOs = ra.csOs.center;
  let startIdx = 0, best = Infinity;
  rim.forEach((r, i) => { const d = dist(q.position(r.v), csOs); if (d < best) { best = d; startIdx = i; } });
  const n = rim.length;
  const step = (k: number) => rim[(startIdx + k + n) % n];
  // 進む向き：数歩先が後方（z が小さい）になる向き
  const zAhead = (sign: number) => q.position(step(sign * 4).v).z;
  const sign = zAhead(1) < zAhead(-1) ? 1 : -1;
  const csPts: Vec3[] = [add(csOs, scale(ra.csOs.axis, -6)), csOs];
  for (let k = 0; k <= Math.floor(n * 0.55); k++) {
    const v = step(sign * k).v;
    const p = q.position(v);
    const nrm = q.normalAt(v);
    csPts.push(add(add(p, scale(nrm, CS_PATH.epicardialOffsetMm)), scale(mv.axis, -CS_PATH.aboveAnnulusMm)));
  }
  // 細かい凹凸をならす（3 点移動平均。端は固定）
  // ならしたあと、LA 表面から一定の距離（心外膜側）に戻す
  const smooth = csPts.map((p, i) => {
    if (i < 2 || i === csPts.length - 1) return p;
    const avg = scale(add(add(csPts[i - 1], p), csPts[i + 1]), 1 / 3);
    const hit = q.closestPoint(avg);
    return add(hit.point, scale(hit.normal, CS_PATH.epicardialOffsetMm));
  });
  const cs = polyline('cs', smooth, false, CS_PATH.defaultInsertionMm, -1);

  // ── His：三尖弁輪の縁を、His 部位（Koch 三角の頂点）から CS 口の方向（後下方）へたどる
  const tv = ra.tricuspid;
  const tvRim = sortAround(q, anatomy.rims.tricuspid, tv.center, tv.axis, v3(1, 0.5, 0));
  const hisV = anatomy.anchors.his.vertex;
  const m = tvRim.length;
  let hisIdx = 0, hBest = Infinity;
  tvRim.forEach((r, i) => { const d = dist(q.position(r.v), q.position(hisV)); if (d < hBest) { hBest = d; hisIdx = i; } });
  const at = (k: number) => q.position(tvRim[(hisIdx + k + m * 4) % m].v);
  const hSign = dist(at(4), csOs) < dist(at(-4), csOs) ? 1 : -1;
  const hisPts: Vec3[] = [];
  for (let k = 0; k <= Math.min(m - 1, 14); k++) hisPts.push(add(at(hSign * k), scale(tv.axis, -2)));
  const his = polyline('his', dedupe(hisPts), true, 0, 1);

  // ── HRA：洞結節から RA 側壁を下る経路
  const sn = anatomy.anchors.sinusNode.point;
  const hraPts = surfaceWalk(q, sn, v3(-0.6, -1, 0.2), 40);
  const hra = polyline('hra', hraPts, true, 16, -1);

  return { cs, his, hra };
}

function dedupe(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 0.5) out.push(p);
  return out;
}
