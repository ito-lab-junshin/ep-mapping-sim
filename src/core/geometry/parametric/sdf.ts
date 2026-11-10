import type { Vec3 } from '../../types';

/**
 * 符号付き距離関数（SDF）。内側が負、外側が正、表面が 0。
 * 解剖形状は「楕円体・楕円断面の管」をなめらかに足し合わせて作る。
 * 楕円体・楕円管は厳密な距離ではなく近似だが、等値面（表面）の形には影響しない。
 */
export type Sdf = (x: number, y: number, z: number) => number;

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));

/** 中心 c、半径 r（各軸）の楕円体 */
export function ellipsoid(c: Vec3, r: Vec3): Sdf {
  return (x, y, z) => {
    const px = (x - c.x) / r.x, py = (y - c.y) / r.y, pz = (z - c.z) / r.z;
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / r.x, py / r.y, pz / r.z);
    return k1 === 0 ? -Math.min(r.x, r.y, r.z) : (k0 * (k0 - 1)) / k1;
  };
}

/** 管の座標系（軸方向 axis と、断面の長軸 u・短軸 v） */
export interface TubeFrame { a: Vec3; b: Vec3; axis: Vec3; u: Vec3; v: Vec3; ru: number; rv: number; length: number }

/**
 * a から b へ伸びる楕円断面の管（両端は半球状）。ru = u 方向の半径、v = 断面の短軸方向。
 * up は断面の長軸を向けたい方向（軸に直交化して使う）。
 */
export function tubeFrame(a: Vec3, b: Vec3, ru: number, rv: number, up: Vec3): TubeFrame {
  const axis = norm(sub(b, a));
  let u = sub(up, scale(axis, dot(up, axis)));
  if (len(u) < 1e-6) u = cross(axis, v3(1, 0, 0));
  u = norm(u);
  const v = cross(axis, u);
  return { a, b, axis, u, v, ru, rv, length: dist(a, b) };
}

export function tube(f: TubeFrame): Sdf {
  const rMin = Math.min(f.ru, f.rv);
  return (x, y, z) => {
    const p = v3(x - f.a.x, y - f.a.y, z - f.a.z);
    const t = Math.max(0, Math.min(f.length, dot(p, f.axis)));
    const q = sub(p, scale(f.axis, t));
    const qu = dot(q, f.u) / f.ru, qv = dot(q, f.v) / f.rv, qa = dot(q, f.axis) / rMin;
    return (Math.hypot(qu, qv, qa) - 1) * rMin;
  };
}

/** なめらかな和（多項式 smooth-min）。k mm の範囲で滑らかにつなぐ */
export function smoothUnion(k: number, ...fs: Sdf[]): Sdf {
  return (x, y, z) => {
    let d = fs[0](x, y, z);
    for (let i = 1; i < fs.length; i++) {
      const e = fs[i](x, y, z);
      const h = Math.max(k - Math.abs(d - e), 0) / k;
      d = Math.min(d, e) - (h * h * k) / 4;
    }
    return d;
  };
}

/** 数値勾配（正規化済み） */
export function gradient(f: Sdf, p: Vec3, eps = 0.05): Vec3 {
  return norm(v3(
    f(p.x + eps, p.y, p.z) - f(p.x - eps, p.y, p.z),
    f(p.x, p.y + eps, p.z) - f(p.x, p.y - eps, p.z),
    f(p.x, p.y, p.z + eps) - f(p.x, p.y, p.z - eps),
  ));
}

/** 点を等値面（表面）へ射影する */
export function projectToSurface(f: Sdf, p: Vec3, iterations = 4): Vec3 {
  let q = p;
  for (let i = 0; i < iterations; i++) {
    const d = f(q.x, q.y, q.z);
    if (Math.abs(d) < 1e-4) break;
    q = sub(q, scale(gradient(f, q), d));
  }
  return q;
}
