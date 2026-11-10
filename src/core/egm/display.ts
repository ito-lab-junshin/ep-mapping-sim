import { PX_PER_MM } from '../params';

/**
 * EGM パネルの表示計算（純関数）。
 * 実機の「紙送り速度 mm/s」を画面上の目安（PX_PER_MM）で px に換算する。
 */
export const SWEEP_SPEEDS_MM_S = [25, 50, 100, 200] as const;
export type SweepSpeed = (typeof SWEEP_SPEEDS_MM_S)[number];

/** 1 px あたりの ms */
export function msPerPx(speedMmS: number, pxPerMm = PX_PER_MM): number {
  return 1000 / (speedMmS * pxPerMm);
}

/** 幅 widthPx に表示できる時間 ms */
export function visibleMs(widthPx: number, speedMmS: number, pxPerMm = PX_PER_MM): number {
  return widthPx * msPerPx(speedMmS, pxPerMm);
}

/** 幅 widthPx に表示するサンプル数（バッファ長で頭打ち） */
export function visibleSamples(widthPx: number, speedMmS: number, sampleMs: number, available: number, pxPerMm = PX_PER_MM): number {
  return Math.min(available, Math.ceil(visibleMs(widthPx, speedMmS, pxPerMm) / sampleMs) + 1);
}

/** キャリパー：2 本の縦線の間隔（px）→ ms と、周期とみなしたときの bpm */
export function caliper(x1Px: number, x2Px: number, speedMmS: number, pxPerMm = PX_PER_MM): { ms: number; bpm: number } {
  const ms = Math.abs(x2Px - x1Px) * msPerPx(speedMmS, pxPerMm);
  return { ms, bpm: ms > 0 ? 60000 / ms : 0 };
}
