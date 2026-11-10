import type { MapSettings, TachycardiaState } from '../types';

/**
 * 実際に使う関心窓（WOI）（docs/DESIGN.md §6）。
 * 頻拍中（tachycardia）は、WOI が周期長を超えると同じ点に 2 拍分の興奮が入り LAT が破綻する。
 * そこで手動設定でなければ、幅を「周期長 − 10 ms」にし、基準から −10 ms を中心に置く：
 *   WOI = [ −(CL − 10)/2 − 10,  +(CL − 10)/2 − 10 ]（例：CL 250 ms → −130〜+110 ms）
 * 既定の幅のほうが狭ければ既定のままにする。
 */
export function effectiveWoi(
  s: Pick<MapSettings, 'woiBeforeMs' | 'woiAfterMs' | 'woiManual'>,
  rhythm: TachycardiaState,
  cycleLengthMs: number | null,
): { beforeMs: number; afterMs: number; auto: boolean } {
  const width = s.woiAfterMs - s.woiBeforeMs;
  if (s.woiManual || rhythm !== 'tachycardia' || !cycleLengthMs || width <= cycleLengthMs - 10) {
    return { beforeMs: s.woiBeforeMs, afterMs: s.woiAfterMs, auto: false };
  }
  const half = (cycleLengthMs - 10) / 2;
  return { beforeMs: -half - 10, afterMs: half - 10, auto: true };
}
