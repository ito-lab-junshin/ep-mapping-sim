import type { SurfaceMesh } from '../types';
import type { BiatrialAnatomy } from '../geometry/parametric/atria';
import { REGIONS } from '../geometry/regions';
import { ABLATION } from '../params';

/** RF の病変指標の目標の区分：後壁の目標（低い）／前壁の目標（高い） */
export type RfTarget = 'posterior' | 'anterior';

/**
 * 頂点ごとの通電の性質（仮定値・教育用近似）：
 *  - 壁厚 mm：LA 2、PV 1.5、RA 2、Koch 三角 2。CTI は三尖弁輪側 5 mm から IVC 側 3.5 mm へ直線的に薄くなる
 *  - RF の目標の区分：LA の後半分（天蓋を除く）・Koch 三角は後壁の目標、LA の前半分・天蓋・RA（CTI を含む）は前壁の目標
 */
export interface AblationSites { wallMm: Float32Array; target: RfTarget[] }

export function ablationSites(mesh: SurfaceMesh, anatomy: BiatrialAnatomy): AblationSites {
  const n = mesh.positions.length / 3, p = mesh.positions, w = ABLATION.wallThicknessMm;
  const wallMm = new Float32Array(n);
  const target: RfTarget[] = new Array(n);
  const la = anatomy.la, tv = anatomy.anchors.ctiTv.point, ivc = anatomy.anchors.ctiIvc.point;
  const ax = { x: ivc.x - tv.x, y: ivc.y - tv.y, z: ivc.z - tv.z };
  const len2 = ax.x ** 2 + ax.y ** 2 + ax.z ** 2 || 1;
  const laPart = mesh.parts?.[0];
  for (let v = 0; v < n; v++) {
    const r = REGIONS[mesh.regionOfVertex[v]];
    const x = p[3 * v], y = p[3 * v + 1], z = p[3 * v + 2];
    const inLa = laPart ? v >= laPart.vertexStart && v < laPart.vertexStart + laPart.vertexCount : r.startsWith('la');
    const koch = r === 'his_region' || r === 'av_node' || r === 'slow_pathway';
    if (r === 'cti') {
      const t = Math.min(1, Math.max(0, ((x - tv.x) * ax.x + (y - tv.y) * ax.y + (z - tv.z) * ax.z) / len2));
      wallMm[v] = w.ctiTv + (w.ctiIvc - w.ctiTv) * t;
    } else if (r.endsWith('_sleeve') || r.endsWith('_ostium')) wallMm[v] = w.pv;
    else if (koch) wallMm[v] = w.koch;
    else wallMm[v] = inLa ? w.la : w.ra;
    if (inLa) {
      const qy = y - la.center.y, qz = z - la.center.z;
      target[v] = qz < 0 && qy <= 0.6 * la.radii.y ? 'posterior' : 'anterior';
    } else target[v] = koch ? 'posterior' : 'anterior';
  }
  return { wallMm, target };
}
