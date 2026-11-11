import type { EcgLead, EcgLeadCount, Vec3 } from '../types';
import type { VentricularBeat } from '../conduction/ConductionSystem';
import { gaussSum } from '../egm/templates';
import { QT_MS } from '../params';

/**
 * 体表 ECG（docs/DESIGN.md §5.5、教育用近似）。
 *
 *  - 心房成分（P 波・粗動波）：φ モデルの電流源から求めた心房の電気ベクトル p を、誘導の方向 L に投影する
 *    （V = k p·L）。洞調律の P 波、粗動の鋸歯状波、AF の f 波が同じ式から出る。
 *  - 心室成分：心室はメッシュを持たないため、拍の種類ごとのテンプレート
 *      His 経由：正常の QRS・T
 *      副伝導路による早期興奮：デルタ波（緩やかな立ち上がり）＋ His 経由の興奮が届いてからの QRS（融合）
 *      RV ペーシング：幅の広い QRS
 *  - 誘導の方向（座標系 +x = 左、+y = 頭側、+z = 前方）と振幅の較正は仮定値（教育用近似）。
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

/** 誘導の方向（単位ベクトル）。I = 左、II = 左下 60°、V1 = 右前方。仮定値 */
export const LEAD_VECTOR: Record<EcgLead, Vec3> = {
  I: { x: 1, y: 0, z: 0 },
  II: { x: 0.5, y: -0.866, z: 0 },
  V1: { x: -0.25, y: 0, z: 0.968 },
};

/** 心房の電気ベクトル → mV の係数（洞調律の II の P 波のピーク ≈ 0.15 mV になるよう較正） */
export const ATRIAL_ECG_GAIN = 0.0018;

type Parts = readonly (readonly [number, number, number])[];
const T_PEAK_MS = QT_MS - 80;

/** His 経由の QRS・T（QRS 開始からの [中心 ms, 幅 ms, 振幅 mV]） */
const QRS_T: Record<EcgLead, Parts> = {
  I: [[15, 5, -0.04], [40, 11, 0.7], [66, 7, -0.1], [T_PEAK_MS, 40, 0.2]],
  II: [[15, 5, -0.05], [40, 10, 1.1], [65, 7, -0.2], [T_PEAK_MS, 40, 0.3]],
  V1: [[22, 7, 0.25], [50, 12, -0.9], [T_PEAK_MS, 40, -0.08]],
};

/** RV 心尖ペーシングの幅広い QRS（左脚ブロック型・上方軸）と二次性の T */
const PACED_QRS_T: Record<EcgLead, Parts> = {
  I: [[50, 25, 0.8], [T_PEAK_MS + 20, 50, -0.25]],
  II: [[50, 25, -0.9], [T_PEAK_MS + 20, 50, 0.25]],
  V1: [[55, 28, -1.0], [T_PEAK_MS + 20, 50, 0.3]],
};

/**
 * デルタ波の極性（左側自由壁の副伝導路：I で陰性、V1 で陽性 = A 型）と振幅 mV（デルタ波の終わり）。
 * 早期興奮の程度（融合の時間）が長いほど、デルタ波は大きく長くなる。
 */
const DELTA_MV: Record<EcgLead, number> = { I: -0.25, II: 0.2, V1: 0.35 };
/** 心室の興奮がすべて副伝導路から（His 経由が届かない）ときのデルタ波の長さ ms */
const FULL_PREEXCITATION_MS = 60;

export class SurfaceEcg {
  private dipole: Vec3 = { x: 0, y: 0, z: 0 };

  /** 毎サンプル、心房の電気ベクトルを渡す */
  setAtrialDipole(p: Vec3) { this.dipole = p; }

  /** 心房成分 mV */
  atrial(lead: EcgLead): number {
    const l = LEAD_VECTOR[lead], p = this.dipole;
    return ATRIAL_ECG_GAIN * (p.x * l.x + p.y * l.y + p.z * l.z);
  }

  /** 心室成分 mV（QRS・デルタ波・T） */
  ventricular(now: number, lead: EcgLead, beats: VentricularBeat[]): number {
    let s = 0;
    for (const b of beats) {
      const dt = now - b.time;
      if (dt < -30 || dt > QT_MS + 200) continue;
      if (b.source === 'pace') { s += gaussSum(dt, PACED_QRS_T[lead]); continue; }
      if (b.source === 'ap') {
        const delta = Math.min(FULL_PREEXCITATION_MS, (b.hisArrival ?? b.time + FULL_PREEXCITATION_MS) - b.time);
        const amp = DELTA_MV[lead] * (delta / FULL_PREEXCITATION_MS + 0.3) / 1.3;
        // デルタ波：緩やかに立ち上がり、His 経由の QRS が始まるまで続く
        if (dt >= 0) s += dt < delta ? amp * (dt / delta) : amp * Math.exp(-(dt - delta) / 20);
        s += gaussSum(dt - delta, QRS_T[lead]);
        continue;
      }
      s += gaussSum(dt, QRS_T[lead]);
    }
    return s;
  }

  sample(now: number, lead: EcgLead, beats: VentricularBeat[]): number {
    return this.atrial(lead) + this.ventricular(now, lead, beats);
  }

  reset() { this.dipole = { x: 0, y: 0, z: 0 }; }
}
