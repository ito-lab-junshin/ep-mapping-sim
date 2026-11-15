import type { EnergyId, SurfaceMesh, TissueState } from '../types';
import { ABLATION } from '../params';

/**
 * 病変の場（docs/DESIGN.md §7、教育用近似。各社製品のアルゴリズムとは無関係）。
 * 頂点ごとに、恒久的な傷害＝貫壁性 t（病変の深さ / 壁厚、0〜1）と、可逆的な傷害＝浮腫 r（0〜1）を持ち、組織に反映する：
 *  - t + r ≧ 1：viability = 0（伝導遮断）、電位 0
 *  - t + r < 1：viability = 1 − 0.7 (t + r)（伝導は遅くなるが残る：浅い病変・隙間からの伝導）、電位 × (1 − t − r)
 * 貫壁性は増える一方（同じ部位を焼き足すと深くなる）。浮腫は処置の時計（分）で指数関数的に回復し、
 * t < 1 の所は伝導が戻る（再伝導）。アデノシン負荷のあいだは浮腫の効果を消す（休眠伝導が見える）。
 * 浮腫の値は仮定値（教育用近似、§7。ABLATION.edema）。
 */
export const ENERGY_LABEL: Record<EnergyId, string> = {
  rf: '高周波（RF）',
  cryo: 'クライオバルーン',
  pfa: 'パルスフィールド（PFA）',
};

export class LesionField {
  /** 頂点ごとの貫壁性 0〜1（恒久的な傷害） */
  readonly transmurality: Float32Array;
  /** 頂点ごとの浮腫 0〜1（可逆的な傷害） */
  readonly edema: Float32Array;
  /** 病変の前の組織の値（その頂点に初めて傷害を置いたときに保存する。持続性 AF の瘢痕などを壊さないため） */
  private baseViability: Float32Array;
  private baseVoltage: Float32Array;
  private touched: Uint8Array;
  /** 処置の時計（分）：浮腫が置かれてからの経過。通電時間・待機時間・シミュレーション時間で進む */
  procedureMin = 0;
  /** アデノシン負荷中（浮腫の効果を消す） */
  private adenosine = false;
  /** まだ反映していない回復の時間（分） */
  private pendingMin = 0;

  /** wallMm：頂点ごとの壁厚 mm（sites.ts） */
  constructor(readonly mesh: SurfaceMesh, readonly tissue: TissueState, readonly wallMm: Float32Array) {
    const n = tissue.viability.length;
    this.transmurality = new Float32Array(n);
    this.edema = new Float32Array(n);
    this.baseViability = new Float32Array(n);
    this.baseVoltage = new Float32Array(n);
    this.touched = new Uint8Array(n);
  }

  private touch(v: number) {
    if (this.touched[v]) return;
    this.touched[v] = 1;
    this.baseViability[v] = this.tissue.viability[v];
    this.baseVoltage[v] = this.tissue.voltage[v];
  }

  /** 頂点 v の貫壁性を t 以上にする */
  raise(v: number, t: number) {
    if (t > this.transmurality[v]) { this.touch(v); this.transmurality[v] = Math.min(1, t); this.applyVertex(v); }
  }

  /** 頂点 v の貫壁性に dt を足す（PFA の回数） */
  add(v: number, dt: number) {
    this.touch(v);
    this.transmurality[v] = Math.min(1, this.transmurality[v] + dt);
    this.applyVertex(v);
  }

  /** 頂点 v の深さ depthMm を、その部位の壁厚で割った貫壁性にする */
  raiseDepth(v: number, depthMm: number) {
    this.raise(v, depthMm / this.wallMm[v]);
  }

  /** 頂点 v の浮腫を r 以上にする */
  raiseEdema(v: number, r: number) {
    if (r > this.edema[v]) { this.touch(v); this.edema[v] = Math.min(1, r); this.applyVertex(v); }
  }

  /**
   * 通電を始めるときに呼ぶ。touchUpVertex：同じ部位への焼き足し（touch-up）のとき、その先端の頂点（AblationController が決める）。
   * 焼き足しなら、この通電の深さの増え方を (1 − efficacyLoss × その点の浮腫) 倍にする（浮腫で深く入りにくい。仮定値）。
   * 隣に点を並べる通電は弱めない：連続した線は従来どおり貫壁する
   * （頂点ごと・病変の芯ごとに弱めると、点を並べた標準の線（PVI・CTI）が恒久的に貫壁しなくなった。試算）
   */
  beginApplication(touchUpVertex?: number) {
    this.appFactor = touchUpVertex !== undefined ? 1 - ABLATION.edema.efficacyLoss * this.edema[touchUpVertex] : 1;
  }
  private appFactor = 1;

  /** この通電の深さの係数（beginApplication で決まる） */
  efficacy(_v?: number): number { return this.appFactor; }

  /** 処置の時計を minutes 分進める（浮腫の回復は小刻みにまとめて反映する） */
  advance(minutes: number) {
    if (minutes <= 0) return;
    this.procedureMin += minutes;
    this.pendingMin += minutes;
    if (this.pendingMin >= ABLATION.edema.recoveryStepMin) this.flushRecovery();
  }

  /** 待機時間（伝播は計算せず、浮腫の回復だけを進める） */
  wait(minutes: number) {
    this.advance(minutes);
    this.flushRecovery();
  }

  /** まとめておいた回復の時間を浮腫に反映する */
  flushRecovery() {
    if (this.pendingMin <= 0) return;
    const k = Math.exp(-this.pendingMin / ABLATION.edema.tauMin);
    this.pendingMin = 0;
    const r = this.edema;
    for (let v = 0; v < r.length; v++) {
      if (r[v] <= 0) continue;
      r[v] = r[v] * k < ABLATION.edema.negligible ? 0 : r[v] * k;
      this.applyVertex(v);
    }
  }

  /** アデノシン負荷の開始・終了（浮腫の効果を消す・戻す） */
  setAdenosine(on: boolean) {
    if (on === this.adenosine) return;
    this.adenosine = on;
    for (let v = 0; v < this.edema.length; v++) if (this.edema[v] > 0) this.applyVertex(v);
  }

  get adenosineActive() { return this.adenosine; }

  /** 浮腫の残っている頂点の数 */
  get edemaVertexCount(): number {
    let n = 0;
    for (let v = 0; v < this.edema.length; v++) if (this.edema[v] > 0) n++;
    return n;
  }

  /** 浮腫を除いた状態（恒久的な傷害だけ）で fn を評価する（待機後・アデノシン後の再伝導の判定） */
  withoutEdema<T>(fn: () => T): T {
    const was = this.adenosine;
    this.setAdenosine(true);
    try { return fn(); } finally { this.setAdenosine(was); }
  }

  /** 浮腫で止まっている（t < 1 だが t + r ≧ 1）頂点があるか */
  get hasEdemaBlock(): boolean {
    for (let v = 0; v < this.edema.length; v++) if (this.edema[v] > 0 && this.transmurality[v] < 1 && this.transmurality[v] + this.edema[v] >= 1) return true;
    return false;
  }

  private applyVertex(v: number) {
    if (!this.touched[v]) return;
    const s = Math.min(1, this.transmurality[v] + (this.adenosine ? 0 : this.edema[v]));
    const viab = s >= 1 ? 0 : 1 - ABLATION.partialSlowing * s;
    this.tissue.viability[v] = Math.min(this.baseViability[v], viab);
    this.tissue.voltage[v] = Math.min(this.baseVoltage[v], this.baseVoltage[v] * (1 - s));
  }
}
