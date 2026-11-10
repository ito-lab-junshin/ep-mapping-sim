import type { SurfaceMesh, TissueState, Vec3 } from '../types';
import { REGION_ID } from '../geometry/regions';
import { CONDUCTION } from '../params';

/**
 * 優先伝導路（docs/DESIGN.md §4.2）を組織に設定する。
 *  - 分界稜：線維方向 = 上下（頭尾）方向を表面の接平面に射影したもの。長軸方向だけ速い
 *  - Bachmann 束（LA 前壁の帯）：線維方向 = 左右方向を接平面に射影したもの
 * 横方向の伝導速度は一般心房筋（conductionVelocity）のまま。
 */
export function applyPreferentialPathways(mesh: SurfaceMesh, tissue: TissueState, cv = CONDUCTION) {
  const normals = vertexNormals(mesh);
  const set = (region: number, axis: Vec3, cvL: number) => {
    for (let v = 0; v < mesh.regionOfVertex.length; v++) {
      if (mesh.regionOfVertex[v] !== region) continue;
      const nx = normals[3 * v], ny = normals[3 * v + 1], nz = normals[3 * v + 2];
      const d = axis.x * nx + axis.y * ny + axis.z * nz;
      let fx = axis.x - d * nx, fy = axis.y - d * ny, fz = axis.z - d * nz;
      const l = Math.hypot(fx, fy, fz) || 1;
      fx /= l; fy /= l; fz /= l;
      tissue.fiber[3 * v] = fx; tissue.fiber[3 * v + 1] = fy; tissue.fiber[3 * v + 2] = fz;
      tissue.cvLongitudinal[v] = cvL;
    }
  };
  set(REGION_ID.crista_terminalis, { x: 0, y: 1, z: 0 }, cv.cristaLongitudinalCv);
  set(REGION_ID.bachmann_bundle, { x: 1, y: 0, z: 0 }, cv.bachmannLongitudinalCv);
}

function vertexNormals(mesh: SurfaceMesh): Float32Array {
  const p = mesh.positions, idx = mesh.indices;
  const out = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1x = p[3 * b] - p[3 * a], e1y = p[3 * b + 1] - p[3 * a + 1], e1z = p[3 * b + 2] - p[3 * a + 2];
    const e2x = p[3 * c] - p[3 * a], e2y = p[3 * c + 1] - p[3 * a + 1], e2z = p[3 * c + 2] - p[3 * a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { out[3 * v] += nx; out[3 * v + 1] += ny; out[3 * v + 2] += nz; }
  }
  for (let v = 0; v < p.length / 3; v++) {
    const l = Math.hypot(out[3 * v], out[3 * v + 1], out[3 * v + 2]) || 1;
    out[3 * v] /= l; out[3 * v + 1] /= l; out[3 * v + 2] /= l;
  }
  return out;
}
