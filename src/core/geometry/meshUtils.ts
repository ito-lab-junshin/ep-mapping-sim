import type { SurfaceMesh, Vec3 } from '../types';

export function vertexCount(mesh: SurfaceMesh): number {
  return mesh.positions.length / 3;
}

export function vertexPosition(mesh: SurfaceMesh, v: number): Vec3 {
  const p = mesh.positions;
  return { x: p[3 * v], y: p[3 * v + 1], z: p[3 * v + 2] };
}

/** 頂点座標の重心（心腔中心の目安） */
export function centroid(mesh: SurfaceMesh): Vec3 {
  const p = mesh.positions;
  const n = vertexCount(mesh);
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) { x += p[3 * i]; y += p[3 * i + 1]; z += p[3 * i + 2]; }
  return { x: x / n, y: y / n, z: z / n };
}

/** 重心から見て方向 dir に最も近い頂点（解剖ランドマークの仮置き用） */
export function vertexTowards(mesh: SurfaceMesh, dir: Vec3): number {
  const c = centroid(mesh);
  const p = mesh.positions;
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  let best = 0, bestDot = -Infinity;
  for (let v = 0; v < vertexCount(mesh); v++) {
    const x = p[3 * v] - c.x, y = p[3 * v + 1] - c.y, z = p[3 * v + 2] - c.z;
    const l = Math.hypot(x, y, z) || 1;
    const d = (x * dir.x + y * dir.y + z * dir.z) / (l * dl);
    if (d > bestDot) { bestDot = d; best = v; }
  }
  return best;
}

/** 点 q に最も近い頂点 index と距離 mm */
export function nearestVertex(mesh: SurfaceMesh, q: Vec3): { vertex: number; distMm: number } {
  const p = mesh.positions;
  let best = -1, bestD = Infinity;
  for (let v = 0; v < vertexCount(mesh); v++) {
    const d = Math.hypot(p[3 * v] - q.x, p[3 * v + 1] - q.y, p[3 * v + 2] - q.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  return { vertex: best, distMm: bestD };
}

/**
 * 原点 o から方向 dir への半直線とメッシュの最初の交点（Möller–Trumbore）。
 * 交点の位置と、その三角形の法線（o から離れる向き＝心腔の外向き）を返す。
 */
export function raycastFromInside(
  mesh: SurfaceMesh, o: Vec3, dir: Vec3,
): { point: Vec3; normal: Vec3; triangle: number } | null {
  const p = mesh.positions, idx = mesh.indices;
  let bestT = Infinity, bestTri = -1;
  let bn: Vec3 = { x: 0, y: 0, z: 0 };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const e1x = p[3 * b] - ax, e1y = p[3 * b + 1] - ay, e1z = p[3 * b + 2] - az;
    const e2x = p[3 * c] - ax, e2y = p[3 * c + 1] - ay, e2z = p[3 * c + 2] - az;
    const px = dir.y * e2z - dir.z * e2y, py = dir.z * e2x - dir.x * e2z, pz = dir.x * e2y - dir.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
    if (w < 0 || u + w > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist <= 1e-9 || dist >= bestT) continue;
    bestT = dist; bestTri = t / 3;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nx * dir.x + ny * dir.y + nz * dir.z < 0) { nx = -nx; ny = -ny; nz = -nz; }
    bn = { x: nx, y: ny, z: nz };
  }
  if (bestTri < 0) return null;
  return {
    point: { x: o.x + dir.x * bestT, y: o.y + dir.y * bestT, z: o.z + dir.z * bestT },
    normal: bn,
    triangle: bestTri,
  };
}
