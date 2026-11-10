/**
 * 方向非依存 EGM（omnipolar 風、EnSite 風テーマの機能、docs/DESIGN.md §6）。
 * 直交する 2 本の双極 b1（x 方向）・b2（y 方向）から、方向 θ の双極 b(θ) = b1 cos θ + b2 sin θ を作り、
 * peak-to-peak が最大になる θ の信号を使う。これにより、波面の向きとカテーテルの向きの関係で
 * 双極電位が小さくなる（方向依存性）を避ける。実機のアルゴリズムとは無関係の教育用近似。
 */
export function omnipolar(b1: number[], b2: number[], stepDeg = 5): { voltageMv: number; angleDeg: number; signal: number[] } {
  let best = -1, bestDeg = 0;
  for (let d = 0; d < 180; d += stepDeg) {
    const c = Math.cos((d * Math.PI) / 180), s = Math.sin((d * Math.PI) / 180);
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < b1.length; i++) {
      const v = b1[i] * c + b2[i] * s;
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    if (hi - lo > best) { best = hi - lo; bestDeg = d; }
  }
  const c = Math.cos((bestDeg * Math.PI) / 180), s = Math.sin((bestDeg * Math.PI) / 180);
  return { voltageMv: best, angleDeg: bestDeg, signal: b1.map((v, i) => v * c + b2[i] * s) };
}
