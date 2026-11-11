import type { SurfaceMesh, Vec3 } from '../types';
import { ABLATION } from '../params';
import type { LesionField } from './LesionModel';
import type { RfTarget } from './sites';

const RF = ABLATION.rf;

/** 通電量の増える速さ（基準条件 30 W・20 g で 1 /s）。接触していなければ 0 */
export function rfDoseRate(powerW: number, contactForceG: number): number {
  const d = RF.dose;
  if (contactForceG <= 0) return 0;
  return Math.pow(powerW / d.refPowerW, d.powerExp) * Math.pow(contactForceG / d.refContactG, d.contactExp);
}

/** 通電量（基準条件の秒数）から病変の深さ mm：時間に対して飽和する */
export function rfDepthFromDose(doseRefS: number): number {
  return RF.saturationDepthMm * (1 - Math.exp(-Math.max(0, doseRefS) / RF.tauRefS));
}

/** 病変の半径 mm（深さに比例） */
export function rfRadiusFromDepth(depthMm: number): number {
  return RF.radiusPerDepth * depthMm;
}

/** 一定の出力・接触圧で timeS 秒通電したときの量・深さ・半径 */
export function rfLesion(powerW: number, contactForceG: number, timeS: number) {
  const dose = rfDoseRate(powerW, contactForceG) * timeS;
  const depthMm = rfDepthFromDose(dose);
  return { dose, depthMm, radiusMm: rfRadiusFromDepth(depthMm) };
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

/** 病変指標（独自の尺度）：その部位の目標量（後壁 30 s・前壁 40 s 相当）に対する通電量の割合 % */
export function lesionIndexPct(doseRefS: number, target: RfTarget): number {
  return (100 * doseRefS) / RF.targetRefS[target];
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
