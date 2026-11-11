import type { Vec3 } from '../../types';

/** 境界（1 つの三角形にしか属さない辺）の頂点を、つながった輪ごとに分ける（開口ごとの縁） */
export function boundaryLoops(indices: ArrayLike<number>, vertexCount: number): number[][] {
  const count = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a);
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = key(indices[t + e], indices[t + ((e + 1) % 3)]);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const adj = new Map<number, number[]>();
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const a = Math.floor(k / vertexCount), b = k % vertexCount;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>(), loops: number[][] = [];
  for (const s of adj.keys()) {
    if (seen.has(s)) continue;
    const loop: number[] = [], stack = [s];
    seen.add(s);
    while (stack.length) {
      const v = stack.pop()!;
      loop.push(v);
      for (const u of adj.get(v)!) if (!seen.has(u)) { seen.add(u); stack.push(u); }
    }
    loops.push(loop);
  }
  return loops;
}

/** 三角形でつながった成分（頂点ごとの成分番号と成分の数） */
export function components(indices: ArrayLike<number>, vertexCount: number): { comp: Int32Array; count: number } {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]), b = find(indices[t + 1]), c = find(indices[t + 2]);
    parent[a] = b; parent[find(c)] = find(b);
  }
  const ids = new Map<number, number>();
  const comp = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const r = find(v);
    if (!ids.has(r)) ids.set(r, ids.size);
    comp[v] = ids.get(r)!;
  }
  return { comp, count: ids.size };
}

/** 点の集まりの重心と、共分散の固有ベクトル（大きい順。対称 3×3 のヤコビ法） */
export function pca(points: Vec3[]): { center: Vec3; axes: Vec3[]; values: number[] } {
  const n = points.length || 1;
  const c = points.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n, z: a.z + p.z / n }), { x: 0, y: 0, z: 0 });
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += (d[i] * d[j]) / n;
  }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += m[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(m[p][q]) < 1e-30) continue;
      const th = 0.5 * Math.atan2(2 * m[p][q], m[q][q] - m[p][p]);
      const cs = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const mkp = m[k][p], mkq = m[k][q];
        m[k][p] = cs * mkp - sn * mkq; m[k][q] = sn * mkp + cs * mkq;
      }
      for (let k = 0; k < 3; k++) {
        const mpk = m[p][k], mqk = m[q][k];
        m[p][k] = cs * mpk - sn * mqk; m[q][k] = sn * mpk + cs * mqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((a, b) => m[b][b] - m[a][a]);
  return { center: c, axes: order.map((i) => ({ x: V[0][i], y: V[1][i], z: V[2][i] })), values: order.map((i) => m[i][i]) };
}

/**
 * 開口の縁の輪に円を当てはめる：輪の面（PCA の第 1・第 2 軸）に射影して最小二乗の円（Kåsa 法）。
 * 頂点が偏って並んでいても、重心より正しく開口の中心を求められる。normal は面の法線（向きは呼び出し側で決める）
 */
export function fitRing(points: Vec3[]): { center: Vec3; normal: Vec3 } {
  const { center: c, axes } = pca(points);
  const [e1, e2, nrm] = axes;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  const n = points.length;
  for (const p of points) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const x = dx * e1.x + dy * e1.y + dz * e1.z, y = dx * e2.x + dy * e2.y + dz * e2.z, z = -(x * x + y * y);
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] [D E F]^T = [sxz syz sz]^T
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [sxz, syz, sz];
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D0 = det(A);
  if (Math.abs(D0) < 1e-9) return { center: c, normal: nrm };
  const col = (k: number) => A.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)));
  const D = det(col(0)) / D0, E = det(col(1)) / D0;
  const x0 = -D / 2, y0 = -E / 2;
  return { center: { x: c.x + e1.x * x0 + e2.x * y0, y: c.y + e1.y * x0 + e2.y * y0, z: c.z + e1.z * x0 + e2.z * y0 }, normal: nrm };
}
