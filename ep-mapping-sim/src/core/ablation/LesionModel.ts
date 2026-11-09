import type { EnergyId, Lesion, SurfaceMesh, TissueState } from '../types';

export interface RfParams { powerW: number; durationS: number; contactForceG: number }
export interface CryoParams { balloonContact: number /*0-1: PV 口の閉塞度*/; minTempC: number; durationS: number }
export interface PfaParams { shape: 'basket' | 'flower'; applications: number }

/**
 * エネルギー別の病変モデル（教育用の近似。数値は文献値の目安であり、
 * 実機のアルゴリズムではない — docs/DESIGN.md §7 を参照）。
 */
export function rfLesionRadiusMm(p: RfParams): number {
  // Ablation Index 風: 出力×時間×接触の積で病変径が増える近似
  const ai = Math.pow(p.powerW, 0.6) * Math.pow(Math.max(p.durationS, 1), 0.3) * Math.pow(Math.max(p.contactForceG, 1), 0.3);
  return Math.min(8, 1.5 + ai / 12); // 2〜8 mm 程度
}

export function pfaLesionRadiusMm(p: PfaParams): number {
  return p.shape === 'flower' ? 12 : 9; // 広範・浅い病変の近似
}

/** 病変を組織へ反映（viability を下げ、伝導を遮断） */
export function applyLesion(mesh: SurfaceMesh, tissue: TissueState, lesion: Lesion) {
  const p = mesh.positions;
  const c = lesion.centerVertex;
  const cx = p[3 * c], cy = p[3 * c + 1], cz = p[3 * c + 2];
  for (let v = 0; v < tissue.viability.length; v++) {
    const d = Math.hypot(p[3 * v] - cx, p[3 * v + 1] - cy, p[3 * v + 2] - cz);
    if (d > lesion.radiusMm) continue;
    const depth = (1 - d / lesion.radiusMm) * lesion.transmurality;
    tissue.viability[v] = Math.min(tissue.viability[v], 1 - depth);
    tissue.voltage[v] *= 1 - depth;        // ボルテージ低下
    if (tissue.viability[v] < 0.3) tissue.viability[v] = 0; // 中心は完全遮断
  }
}

export const ENERGY_LABEL: Record<EnergyId, string> = {
  rf: '高周波（RF）',
  cryo: 'クライオバルーン',
  pfa: 'パルスフィールド（PFA）',
};
