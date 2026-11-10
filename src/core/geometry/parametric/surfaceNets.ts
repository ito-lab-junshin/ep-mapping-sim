import type { Sdf } from './sdf';

/**
 * Surface Nets：SDF の 0 等値面を三角形メッシュにする。
 * 格子間隔 h mm のセルごとに 1 頂点を置くため、頂点がほぼ等間隔に並び、
 * 緯度経度メッシュのような極・継ぎ目ができない。面は外向き（SDF が増える向き）。
 */
export function surfaceNets(
  f: Sdf,
  bounds: { min: [number, number, number]; max: [number, number, number] },
  h: number,
): { positions: Float32Array; indices: Uint32Array } {
  const [x0, y0, z0] = bounds.min;
  const nx = Math.ceil((bounds.max[0] - x0) / h) + 1;
  const ny = Math.ceil((bounds.max[1] - y0) / h) + 1;
  const nz = Math.ceil((bounds.max[2] - z0) / h) + 1;
  const gi = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    val[gi(i, j, k)] = f(x0 + i * h, y0 + j * h, z0 + k * h);
  }

  const cellVertex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const ci = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) {
      cv[c] = val[gi(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
      if (cv[c] < 0) inside++;
    }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += corners[a][0] + t * (corners[b][0] - corners[a][0]);
      sy += corners[a][1] + t * (corners[b][1] - corners[a][1]);
      sz += corners[a][2] + t * (corners[b][2] - corners[a][2]);
      n++;
    }
    cellVertex[ci(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }

  const tri: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tri.push(a, c, b, a, d, c);
    else tri.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = val[gi(i, j, k)] < 0;
    // x 方向の辺：(i,j,k)-(i+1,j,k) を共有する 4 セル
    if (i < nx - 1 && j > 0 && k > 0) {
      const v1 = val[gi(i + 1, j, k)] < 0;
      if (v0 !== v1) {
        quad(cellVertex[ci(i, j - 1, k - 1)], cellVertex[ci(i, j, k - 1)], cellVertex[ci(i, j, k)], cellVertex[ci(i, j - 1, k)], !v0);
      }
    }
    if (j < ny - 1 && i > 0 && k > 0) {
      const v1 = val[gi(i, j + 1, k)] < 0;
      if (v0 !== v1) {
        quad(cellVertex[ci(i - 1, j, k - 1)], cellVertex[ci(i - 1, j, k)], cellVertex[ci(i, j, k)], cellVertex[ci(i, j, k - 1)], !v0);
      }
    }
    if (k < nz - 1 && i > 0 && j > 0) {
      const v1 = val[gi(i, j, k + 1)] < 0;
      if (v0 !== v1) {
        quad(cellVertex[ci(i - 1, j - 1, k)], cellVertex[ci(i, j - 1, k)], cellVertex[ci(i, j, k)], cellVertex[ci(i - 1, j, k)], !v0);
      }
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tri) };
}
