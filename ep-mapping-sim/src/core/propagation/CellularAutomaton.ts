import type { SurfaceMesh, TissueState } from '../types';

/**
 * 心臓表面メッシュ上の簡易セルオートマトン。
 *
 *  - 各頂点は 静止(0) → 興奮/絶対不応(1) → 相対不応(2) → 静止(0) を巡る。
 *  - 興奮した頂点は隣接頂点へ「距離 / 伝導速度」の遅延で興奮を伝える。
 *  - viability が 0 の頂点（完全病変）は興奮せず、伝播を遮断する。
 *
 * 研究用途に拡張する場合は、この層を FitzHugh–Nagumo 等の反応拡散モデルに
 * 差し替えられるよう、外部からは step() / stimulate() のみを使うこと。
 */
export class CellularAutomaton {
  readonly tissue: TissueState;
  private pending: Float32Array; // 頂点ごとの「興奮到達予定時刻」（Infinity = なし）
  time = 0;

  constructor(readonly mesh: SurfaceMesh, opts?: { cv?: number; erp?: number }) {
    const n = mesh.positions.length / 3;
    this.tissue = {
      phase: new Uint8Array(n),
      timer: new Float32Array(n),
      lastActivation: new Float32Array(n).fill(-1),
      conductionVelocity: new Float32Array(n).fill(opts?.cv ?? 0.8), // mm/ms（心房筋の目安）
      erp: new Float32Array(n).fill(opts?.erp ?? 250),
      viability: new Float32Array(n).fill(1),
      voltage: new Float32Array(n).fill(2.5),
    };
    this.pending = new Float32Array(n).fill(Infinity);
  }

  /** 頂点 v を外部刺激で興奮させる（ペーシング・トリガー） */
  stimulate(v: number): boolean {
    const t = this.tissue;
    if (t.phase[v] !== 0 || t.viability[v] <= 0) return false;
    this.activate(v);
    return true;
  }

  /** dt [ms] 進める */
  step(dt: number) {
    const t = this.tissue;
    const n = t.phase.length;
    this.time += dt;
    for (let v = 0; v < n; v++) {
      // 到達予定の興奮を処理
      if (this.pending[v] <= this.time) {
        this.pending[v] = Infinity;
        if (t.phase[v] === 0 && t.viability[v] > 0) this.activate(v);
      }
      if (t.phase[v] === 0) continue;
      t.timer[v] += dt;
      const absolute = t.erp[v] * 0.8;
      if (t.phase[v] === 1 && t.timer[v] >= absolute) t.phase[v] = 2;
      if (t.phase[v] === 2 && t.timer[v] >= t.erp[v]) { t.phase[v] = 0; t.timer[v] = 0; }
    }
  }

  private activate(v: number) {
    const t = this.tissue;
    t.phase[v] = 1;
    t.timer[v] = 0;
    t.lastActivation[v] = this.time;
    const p = this.mesh.positions;
    for (const u of this.mesh.neighbors[v]) {
      if (t.phase[u] !== 0 || t.viability[u] <= 0) continue;
      const dx = p[3 * u] - p[3 * v], dy = p[3 * u + 1] - p[3 * v + 1], dz = p[3 * u + 2] - p[3 * v + 2];
      const dist = Math.hypot(dx, dy, dz);
      const cv = Math.min(t.conductionVelocity[v], t.conductionVelocity[u]) * t.viability[u];
      if (cv <= 0) continue;
      const arrival = this.time + dist / cv;
      if (arrival < this.pending[u]) this.pending[u] = arrival;
    }
  }

  reset() {
    const t = this.tissue;
    t.phase.fill(0); t.timer.fill(0); t.lastActivation.fill(-1);
    this.pending.fill(Infinity);
    this.time = 0;
  }
}
