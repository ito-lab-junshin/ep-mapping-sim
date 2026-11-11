import type { EcgLead, EcgLeadCount, Vec3 } from '../types';
import type { VentricularBeat } from '../conduction/ConductionSystem';
import { QT_MS } from '../params';

/**
 * 体表 ECG（docs/DESIGN.md §5.5、教育用近似）。12 誘導（Phase 7）。
 *
 *  - 心房成分（P 波・粗動波）：φ モデルの電流源から求めた心房の電気ベクトル p を、誘導の方向 L に投影する
 *    （V = k p·L）。洞調律の P 波、粗動の鋸歯状波、AF の f 波が同じ式から出る。
 *  - 心室成分：心室はメッシュを持たないため、拍の種類ごとに「時刻とともに向きの変わる電気ベクトル」の和で表し
 *    （成分ごとにガウス関数の時間経過と 3 次元の向き）、同じ誘導の方向に投影する。
 *      His 経由：中隔（右前方）→ 主成分（左下後方）→ 基部（右上方）、T 波（左下）
 *      副伝導路による早期興奮：デルタ波（左側自由壁の副伝導路：右前方・下方へ向かう）＋ His 経由の QRS（融合）
 *      RV 心尖ペーシング：幅の広い QRS（左脚ブロック型・上方軸）と二次性の T
 *    成分の向きは、Phase 6 までの I・II・V1 のテンプレートの振幅から逆算した（3 誘導の波形はほぼ変わらない）。
 *  - 誘導の方向（座標系 +x = 左、+y = 頭側、+z = 前方）と振幅の較正は仮定値（教育用近似）。
 *    肢誘導は Einthoven の関係（III = II − I、aVR = −(I + II)/2 など）を満たす。胸部誘導は水平面の方向で近似する。
 */

export interface EcgLeadOption { count: EcgLeadCount; label: string; leads: EcgLead[]; available: boolean }

export const LIMB_LEADS: EcgLead[] = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'];
export const PRECORDIAL_LEADS: EcgLead[] = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

export const ECG_LEAD_OPTIONS: EcgLeadOption[] = [
  { count: 1, label: '1 誘導（II）', leads: ['II'], available: true },
  { count: 3, label: '3 誘導（I・II・V1）', leads: ['I', 'II', 'V1'], available: true },
  { count: 12, label: '12 誘導', leads: [...LIMB_LEADS, ...PRECORDIAL_LEADS], available: true },
];

/** 選択した誘導数で表示する誘導 */
export function ecgLeadsFor(count: EcgLeadCount): EcgLead[] {
  return ECG_LEAD_OPTIONS.find((o) => o.count === count)?.leads ?? [];
}

const unit = (x: number, y: number, z: number): Vec3 => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
const I_VEC: Vec3 = { x: 1, y: 0, z: 0 };
const II_VEC: Vec3 = { x: 0.5, y: -0.866, z: 0 };
const lin = (a: number, u: Vec3, b: number, v: Vec3): Vec3 => ({ x: a * u.x + b * v.x, y: a * u.y + b * v.y, z: a * u.z + b * v.z });

/**
 * 誘導の方向。肢誘導は I・II から Einthoven の関係で作る（III・aVR・aVL・aVF の大きさは 1 または 0.87）。
 * 胸部誘導は水平面（左 +x、前 +z）の角度で、V1 は右前方、V6 は左方。仮定値（教育用近似）
 */
export const LEAD_VECTOR: Record<EcgLead, Vec3> = {
  I: I_VEC,
  II: II_VEC,
  III: lin(1, II_VEC, -1, I_VEC),
  aVR: lin(-0.5, I_VEC, -0.5, II_VEC),
  aVL: lin(1, I_VEC, -0.5, II_VEC),
  aVF: lin(-0.5, I_VEC, 1, II_VEC),
  V1: { x: -0.25, y: 0, z: 0.968 },
  V2: unit(-0.05, 0, 1),
  V3: unit(0.35, 0, 0.94),
  V4: unit(0.6, -0.1, 0.8),
  V5: unit(0.85, -0.1, 0.5),
  V6: unit(1, -0.1, 0.1),
};

/** 心房の電気ベクトル → mV の係数（洞調律の II の P 波のピーク ≈ 0.15 mV になるよう較正） */
export const ATRIAL_ECG_GAIN = 0.0018;

/** 心室の電気ベクトルの成分：[中心 ms, 幅 ms, 向きと大きさ（mV 相当）] */
type Component = readonly [number, number, Vec3];
const T_PEAK_MS = QT_MS - 80;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * His 経由の QRS・T（QRS 開始から）。向きは I・II・V1 の振幅（中隔 −0.12/−0.05/+0.25：V5・V6 の中隔性 q が見えるよう I を深めた、主成分 0.7/1.1/−0.9、
 * 基部 −0.1/−0.2/0、T 0.2/0.3/−0.03：V1 の T は平坦に近く、V2 から陽性）を満たすように逆算した
 */
const NORMAL: Component[] = [
  [17, 6, v(-0.12, -0.012, 0.227)],  // 中隔：左 → 右・前方（I・V6 の小さな q、V1 の r）
  [43, 11, v(0.7, -0.866, -0.749)],  // 主成分：左下後方（I・II の R、V1 の S、V6 の R）
  [65, 7, v(-0.1, 0.173, -0.026)],   // 基部：右上方（II の s）
  [T_PEAK_MS, 40, v(0.2, -0.231, 0.02)], // T 波
];

/** RV 心尖ペーシング（左脚ブロック型・上方軸：I 陽性、II 陰性、V1 陰性）と二次性の T */
const PACED: Component[] = [
  [50, 25, v(0.8, 1.501, -0.826)],
  [T_PEAK_MS + 20, 50, v(-0.25, -0.433, 0.245)],
];

/**
 * デルタ波のベクトル（左側自由壁の副伝導路）：副伝導路の心室付着部（左側方）から離れる向き＝右・前方・下方。
 * I・aVL で陰性、V1 で陽性（A 型）、下壁誘導で陽性。値はデルタ波の終わりの振幅（I −0.25、II +0.2、V1 +0.35 mV）
 */
export const DELTA_VECTOR: Vec3 = v(-0.25, -0.375, 0.297);
/** 心室の興奮がすべて副伝導路から（His 経由が届かない）ときのデルタ波の長さ ms */
const FULL_PREEXCITATION_MS = 60;

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

function addComponents(out: Vec3, dt: number, comps: readonly Component[]) {
  for (const [c, w, d] of comps) {
    const g = Math.exp(-0.5 * ((dt - c) / w) ** 2);
    out.x += g * d.x; out.y += g * d.y; out.z += g * d.z;
  }
}

export class SurfaceEcg {
  private dipole: Vec3 = { x: 0, y: 0, z: 0 };

  /** 毎サンプル、心房の電気ベクトルを渡す */
  setAtrialDipole(p: Vec3) { this.dipole = p; }

  /** 心房成分 mV */
  atrial(lead: EcgLead): number {
    return ATRIAL_ECG_GAIN * dot(this.dipole, LEAD_VECTOR[lead]);
  }

  /** 心室の電気ベクトル（mV 相当）：時刻 now での全拍の和 */
  ventricularVector(now: number, beats: VentricularBeat[]): Vec3 {
    const out = { x: 0, y: 0, z: 0 };
    for (const b of beats) {
      const dt = now - b.time;
      if (dt < -30 || dt > QT_MS + 200) continue;
      if (b.source === 'pace') { addComponents(out, dt, PACED); continue; }
      if (b.source === 'ap') {
        const delta = Math.min(FULL_PREEXCITATION_MS, (b.hisArrival ?? b.time + FULL_PREEXCITATION_MS) - b.time);
        const amp = (delta / FULL_PREEXCITATION_MS + 0.3) / 1.3;
        // デルタ波：緩やかに立ち上がり、His 経由の QRS が始まるまで続く
        if (dt >= 0) {
          const k = amp * (dt < delta ? dt / delta : Math.exp(-(dt - delta) / 20));
          out.x += k * DELTA_VECTOR.x; out.y += k * DELTA_VECTOR.y; out.z += k * DELTA_VECTOR.z;
        }
        addComponents(out, dt - delta, NORMAL);
        continue;
      }
      addComponents(out, dt, NORMAL);
    }
    return out;
  }

  /** 同じ時刻の 12 誘導で計算をくり返さないための記憶 */
  private cache: { now: number; beats: VentricularBeat[]; n: number; vec: Vec3 } | null = null;

  /** 心室成分 mV（QRS・デルタ波・T） */
  ventricular(now: number, lead: EcgLead, beats: VentricularBeat[]): number {
    const c = this.cache;
    let vec: Vec3;
    if (c && c.now === now && c.beats === beats && c.n === beats.length) vec = c.vec;
    else { vec = this.ventricularVector(now, beats); this.cache = { now, beats, n: beats.length, vec }; }
    return dot(vec, LEAD_VECTOR[lead]);
  }

  sample(now: number, lead: EcgLead, beats: VentricularBeat[]): number {
    return this.atrial(lead) + this.ventricular(now, lead, beats);
  }

  reset() { this.dipole = { x: 0, y: 0, z: 0 }; this.cache = null; }
}
