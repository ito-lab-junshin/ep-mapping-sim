import type { Catheter, SurfaceMesh, TissueState, Vec3 } from '../types';
import { actionPotential } from './templates';

/**
 * 心内心電図（EGM）生成 — φ モデル（電流源密度近似、docs/DESIGN.md §6）。
 *
 *  1. 各頂点の膜電位 Vm を「活性化からの経過時間」に対する活動電位テンプレートで与える。
 *     電流源は活性化から 16 ms 以内の頂点とその隣接（波面付近）に限る（心房の再分極は省く）。
 *  2. メッシュ上の余接（cotangent）ラプラシアンで、頂点ごとの膜電流（電流源）Iₘ を求める。
 *       Iₘ,ᵥ ∝ ½ Σᵤ (cot α + cot β)(Vmᵤ − Vmᵥ) × (voltageᵥ / 2.5)
 *     波面の前方は湧き出し（＋）、後方は吸い込み（−）になり、Σ Iₘ ≈ 0。
 *  3. 電極位置 x の電位を φ(x) = K Σ Iₘ,ᵥ / |x − xᵥ| で求める。
 *
 * ここから自然に次の性質が出る（教育上の要点）:
 *  - 単極電位は 起源で QS 型、伝導の途中で RS 型、終点で R 型
 *  - Σ Iₘ ≈ 0 のため遠方では双極子として振る舞い、距離の 2 乗程度で減衰（遠隔電位）
 *  - 電極を壁から離すと（非接触）鈍く低振幅になる
 *  - viability = 0 の頂点は電流源にならず、そこへ向かう辺も除く（no-flux 境界）。
 *    瘢痕・病変の上では局所電位が消え、周囲からの遠隔電位だけが残る
 *  - 電位は電極の 3D 座標で計算するため、電極間隔が辺長より短くても双極電位が 0 にならない
 *
 * 振幅較正 K は「接触・電極間隔 2 mm の双極で正常心房 ≈ 1〜2 mV」になるよう決めた教育用近似。
 */
export const PHI_GAIN = 2.0;
/** 電流源とみなす「活性化からの時間」の上限 ms（立ち上がり 6 ms + 余裕） */
const FRONT_WINDOW_MS = 16;
/** 1/r の発散を防ぐ最小距離 mm */
const MIN_R_MM = 0.5;
/** 余接重みの上限（細長い三角形での発散防止） */
const MAX_COT = 10;
/** 正常心房の voltage（TissueState.voltage の既定値） */
const NORMAL_VOLTAGE = 2.5;

export class EgmGenerator {
  /** CSR 形式の隣接と余接重み */
  private nbStart: Int32Array;
  private nbIndex: Int32Array;
  private nbWeight: Float32Array;
  private vm: Float32Array;
  private source: Float32Array;
  private active: Int32Array;
  private recent: Uint8Array;
  private activeCount = 0;
  private computedAt = NaN;
  private centroid: Vec3;

  /** frontOnly = false で全頂点を電流源の候補にする（検証用） */
  constructor(readonly mesh: SurfaceMesh, readonly tissue: TissueState, readonly opts: { frontOnly?: boolean } = {}) {
    const n = mesh.positions.length / 3;
    const weights = cotangentWeights(mesh);
    this.nbStart = new Int32Array(n + 1);
    for (let v = 0; v < n; v++) this.nbStart[v + 1] = this.nbStart[v] + weights[v].size;
    this.nbIndex = new Int32Array(this.nbStart[n]);
    this.nbWeight = new Float32Array(this.nbStart[n]);
    for (let v = 0; v < n; v++) {
      let k = this.nbStart[v];
      for (const [u, w] of weights[v]) { this.nbIndex[k] = u; this.nbWeight[k] = w; k++; }
    }
    this.vm = new Float32Array(n);
    this.source = new Float32Array(n);
    this.active = new Int32Array(n);
    this.recent = new Uint8Array(n);
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < n; v++) { cx += mesh.positions[3 * v]; cy += mesh.positions[3 * v + 1]; cz += mesh.positions[3 * v + 2]; }
    this.centroid = { x: cx / n, y: cy / n, z: cz / n };
  }

  /** 時刻 now の電流源分布を計算する（同じ now では再計算しない） */
  update(now: number) {
    if (now === this.computedAt) return;
    this.computedAt = now;
    const t = this.tissue;
    const n = this.vm.length;
    for (let v = 0; v < n; v++) {
      const la = t.lastActivation[v];
      this.vm[v] = la < 0 ? 0 : actionPotential(now - la, t.erp[v] * 0.8);
    }
    // 立ち上がり（脱分極）の直後の頂点だけを電流源の候補にする。心房の再分極（Ta 波）は
    // 小さく、EGM・体表 ECG の教育目的では省いてよい。電流源が波面付近に限られ、計算量が大きく減る。
    for (let v = 0; v < n; v++) {
      const la = t.lastActivation[v];
      this.recent[v] = this.opts.frontOnly === false || (la >= 0 && now - la < FRONT_WINDOW_MS) ? 1 : 0;
    }
    this.activeCount = 0;
    for (let v = 0; v < n; v++) {
      // 興奮しない頂点（病変・瘢痕）は電流源にならず、そこへ向かう電流もない（no-flux 境界）
      if (t.viability[v] <= 0) { this.source[v] = 0; continue; }
      let near = this.recent[v] === 1;
      for (let k = this.nbStart[v]; !near && k < this.nbStart[v + 1]; k++) near = this.recent[this.nbIndex[k]] === 1;
      if (!near) { this.source[v] = 0; continue; }
      const vv = this.vm[v];
      let s = 0;
      for (let k = this.nbStart[v]; k < this.nbStart[v + 1]; k++) {
        const u = this.nbIndex[k];
        if (t.viability[u] <= 0) continue;
        s += this.nbWeight[k] * (this.vm[u] - vv);
      }
      s *= t.voltage[v] / NORMAL_VOLTAGE;
      this.source[v] = s;
      if (Math.abs(s) > 1e-4) this.active[this.activeCount++] = v;
    }
  }

  /** 位置 pos の単極電位 mV（時刻 now） */
  unipolarAt(pos: Vec3, now: number): number {
    this.update(now);
    const p = this.mesh.positions;
    let phi = 0;
    for (let i = 0; i < this.activeCount; i++) {
      const v = this.active[i];
      const r = Math.max(MIN_R_MM, Math.hypot(p[3 * v] - pos.x, p[3 * v + 1] - pos.y, p[3 * v + 2] - pos.z));
      phi += this.source[v] / r;
    }
    return PHI_GAIN * phi;
  }

  /**
   * 時刻 now の心房の電気ベクトル（電流双極子モーメント）p = Σ Iₘ,ᵥ (xᵥ − c)。
   * Σ Iₘ ≈ 0 なので基準点 c にほぼ依存しない。体表 ECG の心房成分（P 波・粗動波）に使う。
   */
  dipole(now: number): Vec3 {
    this.update(now);
    const p = this.mesh.positions;
    let x = 0, y = 0, z = 0, s = 0;
    for (let i = 0; i < this.activeCount; i++) {
      const v = this.active[i];
      const q = this.source[v];
      x += q * p[3 * v]; y += q * p[3 * v + 1]; z += q * p[3 * v + 2]; s += q;
    }
    // 残りの Σ Iₘ（数値誤差）の分を重心で差し引く
    const c = this.centroid;
    return { x: x - s * c.x, y: y - s * c.y, z: z - s * c.z };
  }

  /** 双極電位 mV = 電極 a の単極 − 電極 b の単極 */
  bipolar(cath: Catheter, pair: [number, number], now: number): number {
    return this.unipolarAt(cath.electrodes[pair[0]].position, now)
      - this.unipolarAt(cath.electrodes[pair[1]].position, now);
  }

  /** カテーテルの全双極チャンネルの現在値 */
  bipolarAll(cath: Catheter, now: number): number[] {
    return cath.bipoles.map((pair) => this.bipolar(cath, pair, now));
  }
}

/** 頂点ごとの隣接頂点と余接重み ½(cot α + cot β) */
function cotangentWeights(mesh: SurfaceMesh): Map<number, number>[] {
  const p = mesh.positions, idx = mesh.indices;
  const n = p.length / 3;
  const w: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const add = (a: number, b: number, c: number) => {
    // 頂点 c の対角で辺 a-b に寄与
    const ux = p[3 * a] - p[3 * c], uy = p[3 * a + 1] - p[3 * c + 1], uz = p[3 * a + 2] - p[3 * c + 2];
    const vx = p[3 * b] - p[3 * c], vy = p[3 * b + 1] - p[3 * c + 1], vz = p[3 * b + 2] - p[3 * c + 2];
    const dot = ux * vx + uy * vy + uz * vz;
    const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const cot = cross < 1e-12 ? 0 : Math.max(-MAX_COT, Math.min(MAX_COT, dot / cross));
    const half = 0.5 * cot;
    w[a].set(b, (w[a].get(b) ?? 0) + half);
    w[b].set(a, (w[b].get(a) ?? 0) + half);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    add(a, b, c); add(b, c, a); add(c, a, b);
  }
  return w;
}
