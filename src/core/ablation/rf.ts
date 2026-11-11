import type { SurfaceMesh, Vec3 } from '../types';
import { ABLATION } from '../params';
import type { LesionField } from './LesionModel';

const RF = ABLATION.rf;

/** §7 の病変半径 mm（時間 t 秒の時点。通電の途中も同じ式で育つ） */
export function rfRadiusMm(powerW: number, timeS: number, contactForceG: number): number {
  const x = Math.pow(powerW, 0.6) * Math.pow(Math.max(timeS, 0), 0.3) * Math.pow(Math.max(contactForceG, 0), 0.3);
  return Math.min(RF.maxRadiusMm, 1.5 + x / 12);
}

/** 病変の深さ mm（半径に比例。仮定値） */
export function rfDepthMm(radiusMm: number): number {
  return RF.depthRatio * radiusMm;
}

/** 接触圧 g：先端の壁からの距離 heightMm から（押し込むほど大きく、非接触は 0。仮定値の対応） */
export function contactForceG(heightMm: number, contactThresholdMm = 2): number {
  if (heightMm > contactThresholdMm) return 0;
  return Math.min(RF.contactForceMaxG, ((contactThresholdMm - heightMm) / RF.contactForcePushRangeMm) * RF.contactForceMaxG);
}

/** 局所インピーダンス Ω：血中の値 + 接触で上がる分 − 病変の形成で下がる分（DirectSense 風の教育用近似） */
export function localImpedanceOhm(cfG: number, formation01: number): { value: number; drop: number } {
  const li = ABLATION.localImpedance;
  const drop = li.maxDropOhm * Math.max(0, Math.min(1, formation01));
  return { value: li.bloodOhm + li.contactMaxOhm * Math.min(1, cfG / RF.contactForceMaxG) - drop, drop };
}

/** 病変指標（独自の尺度）：貫壁性に必要な量 = 100 % */
export function lesionIndexPct(depthMm: number, wallMm: number): number {
  return (100 * depthMm) / wallMm;
}

/** 点 center のまわりに RF 病変を置く：深さは中心で depthMm、半径 r の球冠の形で浅くなる */
export function depositRf(field: LesionField, mesh: SurfaceMesh, center: Vec3, radiusMm: number, depthMm: number) {
  const p = mesh.positions;
  for (let v = 0; v < p.length / 3; v++) {
    const d = Math.hypot(p[3 * v] - center.x, p[3 * v + 1] - center.y, p[3 * v + 2] - center.z);
    if (d >= radiusMm) continue;
    field.raiseDepth(v, depthMm * Math.sqrt(1 - (d / radiusMm) ** 2));
  }
}
