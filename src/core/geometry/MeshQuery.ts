import type { SurfaceMesh, Vec3 } from '../types';
import { add, cross, dot, norm, scale, sub, v3, len } from './parametric/sdf';

export interface SurfaceHit {
  /** 表面上の最近点 */
  point: Vec3;
  /** 外向き法線（三角形の面法線） */
  normal: Vec3;
  /** 最近点に最も近い頂点 */
  vertex: number;
  /** 問い合わせ点から表面までの距離 mm */
  distance: number;
}

/**
 * メッシュへの幾何問い合わせ（最近点・表面に沿った移動）。
 * SDF に頼らないので、Phase 7 の glTF メッシュでもそのまま使える。
 * 面は外向き（心腔の外を向く）であることを前提とする。
 */
export class MeshQuery {
  private vertexTris: number[][];
  readonly vertexNormals: Float32Array;
  /** 開口（弁輪・静脈の端・CS 口）の縁の頂点 */
  readonly boundary = new Set<number>();

  constructor(readonly mesh: SurfaceMesh) {
    const n = mesh.positions.length / 3;
    this.vertexTris = Array.from({ length: n }, () => []);
    this.vertexNormals = new Float32Array(n * 3);
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const fn = this.faceNormalRaw(t);
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        this.vertexTris[v].push(t);
        this.vertexNormals[3 * v] += fn.x; this.vertexNormals[3 * v + 1] += fn.y; this.vertexNormals[3 * v + 2] += fn.z;
      }
    }
    for (let v = 0; v < n; v++) {
      const l = Math.hypot(this.vertexNormals[3 * v], this.vertexNormals[3 * v + 1], this.vertexNormals[3 * v + 2]) || 1;
      this.vertexNormals[3 * v] /= l; this.vertexNormals[3 * v + 1] /= l; this.vertexNormals[3 * v + 2] /= l;
    }
    // 1 つの三角形にしか属さない辺の端点 = 開口の縁
    const edgeCount = new Map<number, number>();
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
        const k = a < b ? a * n + b : b * n + a;
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }
    for (const [k, c] of edgeCount) if (c === 1) { this.boundary.add(Math.floor(k / n)); this.boundary.add(k % n); }
  }

  /** 最近点が開口の縁にあるか（その先は開口＝表面がない） */
  atOpening(hit: SurfaceHit): boolean {
    return this.boundary.has(hit.vertex);
  }

  position(v: number): Vec3 {
    const p = this.mesh.positions;
    return v3(p[3 * v], p[3 * v + 1], p[3 * v + 2]);
  }

  normalAt(v: number): Vec3 {
    const n = this.vertexNormals;
    return v3(n[3 * v], n[3 * v + 1], n[3 * v + 2]);
  }

  /** 面積で重み付けされた（正規化前の）面法線 */
  private faceNormalRaw(t: number): Vec3 {
    const idx = this.mesh.indices;
    const a = this.position(idx[t]), b = this.position(idx[t + 1]), c = this.position(idx[t + 2]);
    return cross(sub(b, a), sub(c, a));
  }

  nearestVertex(q: Vec3, candidates?: Iterable<number>): number {
    const p = this.mesh.positions;
    let best = -1, bestD = Infinity;
    if (candidates) {
      for (const v of candidates) {
        const d = (p[3 * v] - q.x) ** 2 + (p[3 * v + 1] - q.y) ** 2 + (p[3 * v + 2] - q.z) ** 2;
        if (d < bestD) { bestD = d; best = v; }
      }
      return best;
    }
    for (let v = 0; v < p.length / 3; v++) {
      const d = (p[3 * v] - q.x) ** 2 + (p[3 * v + 1] - q.y) ** 2 + (p[3 * v + 2] - q.z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  /** 表面上の最近点（最寄り頂点のまわりの三角形で厳密に求める） */
  closestPoint(q: Vec3, candidates?: Iterable<number>): SurfaceHit {
    const v0 = this.nearestVertex(q, candidates);
    const idx = this.mesh.indices;
    let best: Vec3 = this.position(v0), bestD = Infinity, bestT = this.vertexTris[v0][0];
    const tris = new Set<number>();
    for (const t of this.vertexTris[v0]) {
      tris.add(t);
      for (let k = 0; k < 3; k++) for (const t2 of this.vertexTris[idx[t + k]]) tris.add(t2);
    }
    for (const t of tris) {
      const c = closestOnTriangle(q, this.position(idx[t]), this.position(idx[t + 1]), this.position(idx[t + 2]));
      const d = len(sub(c, q));
      if (d < bestD) { bestD = d; best = c; bestT = t; }
    }
    return { point: best, normal: norm(this.faceNormalRaw(bestT)), vertex: this.nearestVertex(best, [idx[bestT], idx[bestT + 1], idx[bestT + 2]]), distance: bestD };
  }

  /**
   * 表面に沿って start から方向 dir へ distance mm 進んだ点（0.5 mm 刻みで射影しながら進む）。
   * 開口（弁輪・静脈）の縁に達したら止まる。traveled は実際に表面を進めた距離、direction は最後の進行方向。
   */
  walk(start: Vec3, dir: Vec3, distance: number): SurfaceHit & { traveled: number; direction: Vec3 } {
    let hit = this.closestPoint(start);
    let d = tangent(dir, hit.normal);
    const step = 0.5;
    let moved = 0;
    while (moved < distance - 1e-9) {
      const s = Math.min(step, distance - moved);
      const next = this.closestPoint(add(hit.point, scale(d, s)));
      // 開口の縁で止まった（凹みで一時的に動かないだけなら、そのまま進める）
      if (len(sub(next.point, hit.point)) < s * 0.2 && this.atOpening(next)) break;
      d = tangent(d, next.normal);
      hit = next;
      moved += s;
    }
    return { ...hit, traveled: moved, direction: d };
  }
}

/** ベクトル d を法線 n に直交する面へ射影して正規化 */
export function tangent(d: Vec3, n: Vec3): Vec3 {
  const t = sub(d, scale(n, dot(d, n)));
  return len(t) < 1e-9 ? norm(cross(n, v3(0, 1, 0.1))) : norm(t);
}

/** 三角形上の最近点（Ericson, Real-Time Collision Detection） */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}
