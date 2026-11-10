import type { LatMethod, SampleBuffer } from '../types';

/**
 * 信号の注釈（docs/DESIGN.md §6）。バッファは等間隔（sampleMs）で、最後のサンプルが時刻 now。
 */

/** バッファ中の i 番目のサンプルの時刻 */
export function sampleTime(buf: SampleBuffer, i: number, now: number, sampleMs: number): number {
  return now - (buf.length - 1 - i) * sampleMs;
}

/** 時刻 t に最も近いサンプルの index（範囲外は -1） */
export function indexAt(buf: SampleBuffer, t: number, now: number, sampleMs: number): number {
  const i = Math.round(buf.length - 1 - (now - t) / sampleMs);
  return i >= 0 && i < buf.length ? i : -1;
}

/**
 * 基準チャンネルの興奮時刻を新しい順に返す。
 * 振幅ではなく傾き |dV/dt| の局所最大で取る：CS などの基準チャンネルには心室の遠隔電位（鈍く大きい）が
 * 乗るため、振幅で取ると V を拾ってしまう。鋭い局所の A は傾きが大きいので確実に区別できる。
 * minGapMs 以内の山は 1 つにまとめ、全体の最大の 40 % 未満の山は捨てる。
 */
export function referenceBeats(buf: SampleBuffer, now: number, sampleMs: number, minGapMs = 150): number[] {
  const n = buf.length;
  if (n < 2) return [];
  const slope = new Float32Array(n);
  let max = 0;
  for (let i = 1; i < n; i++) {
    slope[i] = Math.abs(buf.at(i) - buf.at(i - 1));
    if (slope[i] > max) max = slope[i];
  }
  if (max <= 0) return [];
  const thr = max * 0.4;
  const gap = Math.round(minGapMs / sampleMs);
  const beats: number[] = [];
  let i = n - 1;
  while (i >= 1) {
    if (slope[i] < thr) { i--; continue; }
    let best = i, bv = slope[i];
    for (let j = i; j >= 1 && i - j <= gap; j--) if (slope[j] > bv) { bv = slope[j]; best = j; }
    beats.push(sampleTime(buf, best, now, sampleMs));
    i = best - gap;
  }
  return beats;
}

/** 基準の拍間隔の中央値（周期長の推定）。2 拍未満なら null */
export function estimateCycleLength(beats: number[]): number | null {
  if (beats.length < 2) return null;
  const d: number[] = [];
  for (let i = 1; i < beats.length; i++) d.push(beats[i - 1] - beats[i]);
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

export interface Annotation {
  /** 基準からの LAT ms（窓内に信号がなければ null） */
  latMs: number | null;
  /** peak-to-peak mV */
  voltageMv: number;
}

/**
 * 1 つの双極信号（と、−dV/dt 用の遠位電極の単極信号）を、基準時刻 tRef・WOI で注釈する。
 *  - bipolarPeak：双極の |振幅| が最大の時刻
 *  - unipolarDvdt：単極の下降速度（−dV/dt）が最大の時刻
 * 電位は双極の peak-to-peak。振幅が minMv 未満なら LAT は null（判定不能）。
 */
export function annotate(
  bipolar: (t: number) => number,
  unipolar: ((t: number) => number) | null,
  tRef: number, woi: { beforeMs: number; afterMs: number }, sampleMs: number,
  method: LatMethod, minMv = 0.02,
): Annotation {
  let hi = -Infinity, lo = Infinity, peakT = 0, peakV = -1;
  for (let t = tRef + woi.beforeMs; t <= tRef + woi.afterMs; t += sampleMs) {
    const v = bipolar(t);
    if (v > hi) hi = v;
    if (v < lo) lo = v;
    if (Math.abs(v) > peakV) { peakV = Math.abs(v); peakT = t; }
  }
  const voltageMv = hi - lo;
  if (voltageMv < minMv) return { latMs: null, voltageMv };
  if (method === 'unipolarDvdt' && unipolar) {
    let best = -Infinity, bestT = peakT;
    for (let t = tRef + woi.beforeMs + sampleMs; t <= tRef + woi.afterMs; t += sampleMs) {
      const slope = (unipolar(t - sampleMs) - unipolar(t)) / sampleMs;
      if (slope > best) { best = slope; bestT = t - sampleMs / 2; }
    }
    return { latMs: bestT - tRef, voltageMv };
  }
  return { latMs: peakT - tRef, voltageMv };
}
