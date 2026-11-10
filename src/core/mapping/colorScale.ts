/**
 * マップの色（docs/DESIGN.md §8.2）。色の並びはテーマ（src/systems）から受け取り、ここでは値 → 色の変換だけを行う。
 * 戻り値は 0〜1 の RGB。
 */
export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** 色の並び ramp 上の位置 f（0〜1）の色（線形補間） */
export function rampColor(ramp: readonly string[], f: number): Rgb {
  const x = Math.max(0, Math.min(1, f)) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  const a = hexToRgb(ramp[i]), b = hexToRgb(ramp[i + 1]);
  const t = x - i;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** LAT：最早（latMin）→ 最遅（latMax）を ramp の先頭 → 末尾に */
export function latColor(latMs: number, latMin: number, latMax: number, ramp: readonly string[]): Rgb {
  const span = latMax - latMin;
  return rampColor(ramp, span > 0 ? (latMs - latMin) / span : 0);
}

/**
 * ボルテージ：scarMv 未満は瘢痕色、normalMv 以上は ramp の末尾（正常）、その間は ramp の先頭 → 末尾。
 */
export function voltageColor(mv: number, scarMv: number, normalMv: number, ramp: readonly string[], scarColor: string): Rgb {
  if (mv < scarMv) return hexToRgb(scarColor);
  if (mv >= normalMv) return hexToRgb(ramp[ramp.length - 1]);
  return rampColor(ramp, (mv - scarMv) / (normalMv - scarMv));
}

/** 値の最小・最大（NaN を除く）。値がなければ null */
export function finiteRange(values: ArrayLike<number>): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}
