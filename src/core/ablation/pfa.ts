import type { SurfaceMesh } from '../types';
import type { PvInfo } from '../geometry/parametric/atria';
import { ABLATION } from '../params';
import type { LesionField } from './LesionModel';
import { pvBand } from './pvGeometry';

const F = ABLATION.pfa;

export type PfaShape = 'basket' | 'flower';

/** デバイスの外径 mm（§7：直径 18〜24 mm の病変） */
export function pfaFootprintDiameterMm(pv: PvInfo, shape: PfaShape): number {
  return 2 * (pv.radius + (shape === 'basket' ? F.basketOuterMm : F.flowerOuterMm));
}

/**
 * PFA の 1 回の通電：PV 口のまわりに、幅広く浅い病変を瞬時に作る（心筋選択性のため周辺構造には影響しない）。
 *  - バスケット型：PV 口の縁の輪
 *  - フラワー型：PV 口を覆う円盤
 * 1 回で貫壁性 0.5、2 回以上で 1（回数で耐久性が増す）。
 */
export function depositPfa(field: LesionField, mesh: SurfaceMesh, pv: PvInfo, shape: PfaShape) {
  const inner = shape === 'basket' ? Math.max(0, pv.radius + F.basketInnerMm) : 0;
  const outer = pv.radius + (shape === 'basket' ? F.basketOuterMm : F.flowerOuterMm);
  for (const { v } of pvBand(mesh, pv, -F.antralMm, 3, inner, outer, true)) field.add(v, F.transmuralityPerApplication);
}
