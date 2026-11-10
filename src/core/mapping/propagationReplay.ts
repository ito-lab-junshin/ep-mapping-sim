/**
 * 伝播アニメーション（LAT マップの再生、docs/DESIGN.md §6）。
 * 再生中の時刻 phase（LAT の値の範囲を繰り返す）に対し、LAT が phase に近い頂点ほど明るくする。
 */
export function replayPhase(timeMs: number, latMin: number, latMax: number, padMs = 30, speed = 0.25): number {
  const period = latMax - latMin + padMs;
  if (period <= 0) return latMin;
  return latMin + ((timeMs * speed) % period);
}

/** 波面の強さ 0〜1（LAT が phase の直前 bandMs 以内のとき最大、それより古いと減衰） */
export function wavefrontIntensity(latMs: number, phase: number, bandMs = 12): number {
  const age = phase - latMs;
  if (age < 0 || age > bandMs * 3) return 0;
  return age <= bandMs ? 1 : 1 - (age - bandMs) / (bandMs * 2);
}
