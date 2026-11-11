import type { SurfaceMesh } from '../types';
import type { PvInfo } from '../geometry/parametric/atria';
import { ABLATION } from '../params';
import type { LesionField } from './LesionModel';
import { angleDiff, pvBand } from './pvGeometry';

const C = ABLATION.cryo;

/** 閉塞度 0〜1：押し付け（0〜1）と、バルーンの軸と PV の軸のずれ（deg） */
export function cryoOcclusion(push01: number, misalignDeg: number): number {
  return Math.max(0, Math.min(1, push01 * (1 - Math.abs(misalignDeg) / C.misalignLimitDeg)));
}

/** 最低温度 ℃（閉塞がよいほど低い） */
export function cryoMinTempC(occlusion: number): number {
  return C.minTempBaseC + C.minTempSlopeC * occlusion;
}

/** 時間 t 秒の病変の深さ mm */
export function cryoDepthMm(timeS: number, minTempC: number): number {
  return C.maxDepthMm * (Math.abs(minTempC) / 60) * (1 - Math.exp(-timeS / C.tauS));
}

/** 一周の帯のうち病変ができる角度の割合（閉塞度 0.8 以上で 1） */
export function cryoCoverage(occlusion: number): number {
  return Math.min(1, occlusion / C.fullRingOcclusion);
}

/**
 * クライオの病変：PV 口の前庭部を一周する帯。閉塞が不十分なら、押し付けの向き leakAngleDeg の反対側
 * （血流が漏れて冷えない側）に隙間が残る。
 */
export function depositCryo(field: LesionField, mesh: SurfaceMesh, pv: PvInfo, occlusion: number, leakAngleDeg: number, depthMm: number) {
  const covered = cryoCoverage(occlusion);
  const gapHalf = (1 - covered) * 180;
  for (const { v, c } of pvBand(mesh, pv, -C.antralMm, 3, 0, pv.radius + C.marginMm, true)) {
    if (gapHalf > 0 && angleDiff(c.angleDeg, leakAngleDeg) < gapHalf) continue;
    field.raiseDepth(v, depthMm);
  }
}
