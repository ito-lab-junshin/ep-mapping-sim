/**
 * EGM・体表 ECG のテンプレート波形（教育用近似）。
 * 振幅 mV、時間 ms。すべて純関数。
 */

/** ガウス関数 */
export function gauss(t: number, center: number, width: number): number {
  const z = (t - center) / width;
  return Math.exp(-0.5 * z * z);
}

/** ガウス成分の和 [中心 ms, 幅 ms, 振幅 mV] */
export function gaussSum(t: number, parts: readonly (readonly [number, number, number])[]): number {
  let s = 0;
  for (const [c, w, a] of parts) s += a * gauss(t, c, w);
  return s;
}

/**
 * 心房筋の活動電位（正規化 0〜1）。dt = 活性化からの経過 ms、apd = 活動電位持続 ms。
 * 立ち上がりは 6 ms の smoothstep（メッシュ辺 ≈ 2〜3 mm を CV 1.0 mm/ms で約 2〜3 ms で
 * 渡るため、隣接頂点の立ち上がりが重なり、EGM が頂点ごとのギザギザにならない）。
 */
export const AP_UPSTROKE_MS = 6;
export const AP_REPOL_MS = 60;
export function actionPotential(dt: number, apd: number): number {
  if (dt < 0) return 0;
  if (dt < AP_UPSTROKE_MS) { const x = dt / AP_UPSTROKE_MS; return x * x * (3 - 2 * x); }
  // プラトーは平坦にする（傾きがあると全頂点が弱い電流源になり、計算量だけ増える）
  if (dt < apd) return 1;
  if (dt < apd + AP_REPOL_MS) return 0.5 * (1 + Math.cos(Math.PI * (dt - apd) / AP_REPOL_MS));
  return 0;
}

/** His 電位：鋭い二相性スパイク（約 15 ms）。dt = H の時刻からの経過 */
export function hisSpike(dt: number): number {
  return gaussSum(dt, [[3, 2, 1], [8, 2.5, -0.6]]);
}

/** 心室の局所電位（RV 心尖など）：鋭い大振幅の二相波。dt = 局所活性化からの経過 */
export function localV(dt: number): number {
  return gaussSum(dt, [[4, 3, 1], [11, 4, -0.8], [20, 6, 0.15]]);
}

/** 心室の遠隔電位（心房カテーテルに乗る V）：鈍い二相波。dt = QRS 開始からの経過 */
export function farFieldV(dt: number): number {
  return gaussSum(dt, [[25, 10, 0.6], [55, 14, -1]]);
}

/** 心房の遠隔／合成電位（His カテーテルの A など）：中程度の幅の二相波 */
export function syntheticA(dt: number): number {
  return gaussSum(dt, [[6, 4, 1], [16, 5, -0.7]]);
}
