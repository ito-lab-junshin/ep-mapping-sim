import type { Vec3 } from '../../types';
import { dot, sub, v3 } from './sdf';

/**
 * パラメトリック生成で使うメッシュ操作（純関数）。
 * positions は [x0,y0,z0, ...]、indices は三角形。
 */
export interface RawMesh { positions: Float32Array; indices: Uint32Array }

export const pos = (m: RawMesh, v: number): Vec3 => v3(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);

/** 平面による開口（弁輪・静脈の端・CS 口） */
export interface Opening {
  name: string;
  /** 切断面上の点（開口の中心） */
  center: Vec3;
  /** 心腔の外へ向かう軸 */
  axis: Vec3;
  /** 開口の半径 mm */
  radius: number;
}

/** 軸からの距離 */
export function radialDistance(o: Opening, p: Vec3): number {
  const d = sub(p, o.center);
  const a = dot(d, o.axis);
  return Math.hypot(d.x - o.axis.x * a, d.y - o.axis.y * a, d.z - o.axis.z * a);
}

/** 切断面からの符号付き距離（外側が正） */
export function axialDistance(o: Opening, p: Vec3): number {
  return dot(sub(p, o.center), o.axis);
}

/**
 * 心腔中心 c から axis 方向へ、閉じた面を切ったときの切り口の半径が radius になる切断面を求める。
 * 軸の先端（表面）から内側へ切断面を下ろし、軸の近く（radius の 3 倍以内）の切り口だけを測る。
 * 近くの別の構造（例：CS 口の近くの IVC）と交わっても見積もりが乱れないようにするため。
 */
export function openingAtRadius(m: RawMesh, name: string, c: Vec3, axis: Vec3, radius: number): Opening {
  const n = m.positions.length / 3;
  const at = (h: number): Opening => ({ name, center: v3(c.x + axis.x * h, c.y + axis.y * h, c.z + axis.z * h), axis, radius });
  // 先端：軸の近く（2.5 mm 以内）の頂点で最も外側
  let tip = 0;
  for (let v = 0; v < n; v++) {
    const p = pos(m, v);
    if (radialDistance(at(0), p) < 2.5) tip = Math.max(tip, axialDistance(at(0), p));
  }
  const idx = m.indices;
  const ringRadius = (h: number) => {
    const o = at(h);
    let s = 0, k = 0;
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = pos(m, idx[t + e]), b = pos(m, idx[t + ((e + 1) % 3)]);
        const da = axialDistance(o, a), db = axialDistance(o, b);
        if ((da < 0) === (db < 0)) continue;
        const u = da / (da - db);
        const r = radialDistance(o, v3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u));
        if (r > radius * 3) continue;
        s += r; k++;
      }
    }
    return k ? s / k : 0;
  };
  const step = 0.25;
  let h = tip;
  while (h > 0 && ringRadius(h) < radius) h -= step;
  let lo = Math.max(0, h), hi = Math.min(tip, h + step);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (ringRadius(mid) > radius) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2);
}

/** 開口の外側（切断面より外、かつ開口付近の円柱内）にある三角形を取り除く */
export function cutOpenings(m: RawMesh, openings: Opening[]): RawMesh {
  const keep: number[] = [];
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = pos(m, idx[t]), b = pos(m, idx[t + 1]), c = pos(m, idx[t + 2]);
    const g = v3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
    const removed = openings.some((o) => axialDistance(o, g) > 0 && radialDistance(o, g) < o.radius * 1.6);
    if (!removed) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return compact({ positions: m.positions, indices: Uint32Array.from(keep) });
}

/** 使われていない頂点を除き、index を詰める */
export function compact(m: RawMesh): RawMesh {
  const n = m.positions.length / 3;
  const map = new Int32Array(n).fill(-1);
  const out: number[] = [];
  for (const v of m.indices) {
    if (map[v] >= 0) continue;
    map[v] = out.length / 3;
    out.push(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
  }
  return { positions: Float32Array.from(out), indices: Uint32Array.from(m.indices, (v) => map[v]) };
}

/** 三角形でつながった最大の連結成分だけを残す（切り抜きで生じた小片を除く） */
export function largestComponent(m: RawMesh): RawMesh {
  const n = m.positions.length / 3;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) { unite(idx[t], idx[t + 1]); unite(idx[t + 1], idx[t + 2]); }
  const size = new Map<number, number>();
  for (let v = 0; v < n; v++) { const r = find(v); size.set(r, (size.get(r) ?? 0) + 1); }
  let best = -1, bestSize = 0;
  for (const [r, s] of size) if (s > bestSize) { best = r; bestSize = s; }
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) if (find(idx[t]) === best) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  return compact({ positions: m.positions, indices: Uint32Array.from(keep) });
}

/** 境界辺（1 つの三角形にしか属さない辺）の数 */
export function boundaryEdgeVertices(m: RawMesh): Set<number> {
  const count = new Map<string, number>();
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const out = new Set<number>();
  for (const [k, c] of count) if (c === 1) { const [a, b] = k.split('-').map(Number); out.add(a); out.add(b); }
  return out;
}
