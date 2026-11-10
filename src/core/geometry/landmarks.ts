import type { ChamberId, Vec3 } from '../types';

/**
 * 心腔ごとの解剖ランドマーク（Phase 1 の仮実装）。
 * Phase 2 でパラメトリック解剖メッシュの領域ラベル（regionOfVertex）に置き換える。
 *
 * 座標系: +x = 患者の左、+y = 頭側、+z = 前方。方向は心腔重心から見たベクトル。
 * 方位角 azimuth は xz 平面で +x を 0°、−z（後方）を 270° とする。
 */
export interface ChamberLandmarks {
  /**
   * 洞調律の興奮が入る部位（LA: 中隔からの心房間伝導、RA: 洞結節）。
   * LA は楕円体で前後対称なため、Bachmann 束の前上方に置くと側壁へ前壁回りの波も
   * 同時に届き、遠位 CS が衝突部位になってしまう。Phase 1 では中隔中央やや上方とし、
   * 洞調律で CS 近位→遠位の順になるようにする（解剖メッシュ導入時に見直す）。
   */
  sinusEntry: Vec3;
  /** 房室結節（His へ伝える部位）の代理頂点の方向 */
  avNode: Vec3;
  /** 中隔側の方位角（CS 口の方位） */
  septalAzimuthDeg: number;
  /** 中隔から後壁へ向かう方位角の符号 */
  posteriorSign: 1 | -1;
  /** HRA を置けるか（RA のみ） */
  hasHra: boolean;
}

export const LANDMARKS: Partial<Record<ChamberId, ChamberLandmarks>> = {
  LA: {
    sinusEntry: { x: -0.9, y: 0.4, z: 0 },
    avNode: { x: -0.7, y: -0.6, z: -0.2 },
    septalAzimuthDeg: 180,
    posteriorSign: 1,
    hasHra: false,
  },
  RA: {
    sinusEntry: { x: -0.5, y: 0.8, z: 0.1 },
    avNode: { x: 0.7, y: -0.5, z: 0.1 },
    septalAzimuthDeg: 0,
    posteriorSign: -1,
    hasHra: true,
  },
};

export function landmarksFor(chamber: ChamberId): ChamberLandmarks {
  const l = LANDMARKS[chamber];
  if (!l) throw new Error(`landmarks not defined for ${chamber}`);
  return l;
}
