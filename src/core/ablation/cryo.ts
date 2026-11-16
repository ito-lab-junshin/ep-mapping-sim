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

/**
 * 冷凍時間 t 秒までに置かれる浮腫の割合 0〜1（深さと同じ育ち方：1 − exp(−t / tauS)）。
 * 浮腫を最初から 1 で置くと、冷凍の開始直後に伝導が止まり Time to isolation が約 1 秒になったため（教育用近似、先生と決定）
 */
export function cryoEdemaFraction(timeS: number): number {
  return 1 - Math.exp(-Math.max(0, timeS) / C.tauS);
}

/** 一周の帯のうち病変ができる角度の割合（閉塞度 0.8 以上で 1） */
export function cryoCoverage(occlusion: number): number {
  return Math.min(1, occlusion / C.fullRingOcclusion);
}

/**
 * クライオの病変：PV 口の前庭部を一周する帯。閉塞が不十分なら、押し付けの向き leakAngleDeg の反対側
 * （血流が漏れて冷えない側）に隙間が残る。
 */
export function depositCryo(field: LesionField, mesh: SurfaceMesh, pv: PvInfo, occlusion: number, leakAngleDeg: number, depthMm: number, edemaFraction = 1) {
  const covered = cryoCoverage(occlusion);
  const gapHalf = (1 - covered) * 180;
  const band: number[] = [];
  for (const { v, c } of pvBand(mesh, pv, -C.antralMm, 3, 0, pv.radius + C.marginMm, true)) {
    if (gapHalf > 0 && angleDiff(c.angleDeg, leakAngleDeg) < gapHalf) continue;
    field.raiseDepth(v, depthMm);
    band.push(v);
  }
  depositEdemaAround(field, mesh, band, edemaFraction);
}

/** 病変の帯の頂点は浮腫 scale（冷凍時間による割合）、そこから marginMm 外側へ直線的に 0（帯ごとに近い頂点の表を覚えておく） */
const marginCache = new WeakMap<SurfaceMesh, Map<string, [number, number][]>>();
function depositEdemaAround(field: LesionField, mesh: SurfaceMesh, band: number[], scale: number) {
  if (!band.length) return;
  const key = `${band.length}:${band[0]}:${band[band.length - 1]}`;
  let m = marginCache.get(mesh);
  if (!m) { m = new Map(); marginCache.set(mesh, m); }
  let near = m.get(key);
  if (!near) {
    const margin = ABLATION.edema.marginMm, p = mesh.positions, inBand = new Set(band);
    near = [];
    for (let v = 0; v < p.length / 3; v++) {
      if (inBand.has(v)) { near.push([v, 1]); continue; }
      let d = Infinity;
      for (const u of band) {
        const dx = p[3 * v] - p[3 * u], dy = p[3 * v + 1] - p[3 * u + 1], dz = p[3 * v + 2] - p[3 * u + 2];
        const x = dx * dx + dy * dy + dz * dz;
        if (x < d) d = x;
      }
      d = Math.sqrt(d);
      if (d < margin) near.push([v, 1 - d / margin]);
    }
    m.set(key, near);
  }
  for (const [v, r] of near) field.raiseEdema(v, r * scale);
}
