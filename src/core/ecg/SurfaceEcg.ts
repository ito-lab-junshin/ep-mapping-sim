import type { EcgLead, EcgLeadCount } from '../types';
import { gaussSum } from '../egm/templates';
import { QT_MS } from '../params';

/**
 * 体表 ECG のテンプレート合成（docs/DESIGN.md §5.5、教育用近似）。
 *
 *  - P 波: 1 拍ごとの「心房の活性化済み割合 f（0→1）」を位相とするテンプレート。
 *    始まり＝心房の最早活性化、幅＝全心房の活性化時間になる（因果的に計算できる）。
 *    II・I は単峰性の陽性、V1 は前半陽性・後半陰性の二相性（RA → LA の順を表す）。
 *  - QRS・T 波: 心室興奮（QRS 開始）時刻からのガウス成分の和。
 *  - Phase 4 で鋸歯状波（AFL）・デルタ波（WPW）を追加する。
 */

export interface EcgLeadOption { count: EcgLeadCount; label: string; leads: EcgLead[]; available: boolean }

export const ECG_LEAD_OPTIONS: EcgLeadOption[] = [
  { count: 1, label: '1 誘導（II）', leads: ['II'], available: true },
  { count: 3, label: '3 誘導（I・II・V1）', leads: ['I', 'II', 'V1'], available: true },
  { count: 12, label: '12 誘導（準備中）', leads: [], available: false },
];

/** 選択した誘導数で表示する誘導。準備中の選択肢は空配列 */
export function ecgLeadsFor(count: EcgLeadCount): EcgLead[] {
  return ECG_LEAD_OPTIONS.find((o) => o.count === count)?.leads ?? [];
}

/** P 波の振幅 mV（単峰成分, 二相成分） */
const P_AMP: Record<EcgLead, { mono: number; bi: number }> = {
  I: { mono: 0.08, bi: 0 },
  II: { mono: 0.15, bi: 0 },
  V1: { mono: 0.03, bi: 0.07 },
};

/** QRS・T（QRS 開始からの [中心 ms, 幅 ms, 振幅 mV]） */
const T_PEAK_MS = QT_MS - 80;
const QRS_T: Record<EcgLead, readonly (readonly [number, number, number])[]> = {
  I: [[15, 5, -0.04], [40, 11, 0.7], [66, 7, -0.1], [T_PEAK_MS, 40, 0.2]],
  II: [[15, 5, -0.05], [40, 10, 1.1], [65, 7, -0.2], [T_PEAK_MS, 40, 0.3]],
  V1: [[22, 7, 0.25], [50, 12, -0.9], [T_PEAK_MS, 40, -0.08]],
};

/** 新しい拍とみなす活性化の空白 ms */
const BEAT_GAP_MS = 40;
/** 活性化が止まってから P 波を減衰させる時定数 ms */
const P_DECAY_MS = 8;

export class SurfaceEcg {
  private beatActivated = 0;
  private lastActTime = -Infinity;
  private f = 0;

  /**
   * 毎サンプル呼ぶ。newActivations = このサンプル間に活性化した頂点数、
   * viableCount = 興奮しうる頂点数。
   */
  update(now: number, newActivations: number, viableCount: number) {
    if (newActivations > 0) {
      if (now - this.lastActTime > BEAT_GAP_MS) this.beatActivated = 0;
      this.beatActivated += newActivations;
      this.lastActTime = now;
    }
    this.f = viableCount > 0 ? Math.min(1, this.beatActivated / viableCount) : 0;
  }

  /** P 波成分 mV */
  pWave(now: number, lead: EcgLead): number {
    if (this.lastActTime === -Infinity) return 0;
    const quiet = now - this.lastActTime;
    const decay = quiet <= 2 ? 1 : Math.exp(-(quiet - 2) / P_DECAY_MS);
    const a = P_AMP[lead];
    return decay * (a.mono * Math.sin(Math.PI * this.f) + a.bi * Math.sin(2 * Math.PI * this.f));
  }

  /** QRS・T 成分 mV。vTimes = 心室興奮（QRS 開始）時刻 */
  ventricular(now: number, lead: EcgLead, vTimes: number[]): number {
    let s = 0;
    for (const v of vTimes) {
      const dt = now - v;
      if (dt < -30 || dt > QT_MS + 150) continue;
      s += gaussSum(dt, QRS_T[lead]);
    }
    return s;
  }

  sample(now: number, lead: EcgLead, vTimes: number[]): number {
    return this.pWave(now, lead) + this.ventricular(now, lead, vTimes);
  }

  reset() { this.beatActivated = 0; this.lastActTime = -Infinity; this.f = 0; }
}
