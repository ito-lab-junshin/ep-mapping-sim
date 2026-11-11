import type { SurfaceMesh, TissueState } from '../types';
import { CONDUCTION } from '../params';
import { MinHeap } from '../util/MinHeap';

/**
 * 心臓表面メッシュ上の簡易セルオートマトン。
 *
 *  - 各頂点は 静止(0) → 興奮/絶対不応(1) → 相対不応(2) → 静止(0) を巡る。
 *  - 興奮した頂点は隣接頂点へ「距離 / 伝導速度」の遅延で興奮を伝える。
 *  - viability が 0 の頂点（完全病変）は興奮せず、伝播を遮断する。
 *  - 異方性：両端の頂点が線維方向（fiber）と長軸方向の伝導速度（cvLongitudinal）をもつ辺は、
 *    辺と線維のなす角 θ に応じて楕円則 1/cv² = cos²θ/cvL² + sin²θ/cvT² で伝導速度を決める
 *    （cvT = conductionVelocity。分界稜・Bachmann 束）。
 *  - 心房間の連結（mesh.bridges）は連結ごとの伝導速度で伝える。
 *  - 到達予定はイベントとして時刻順に処理し、刻み幅の途中の正確な時刻で興奮させる
 *    （刻みの終わりに丸めると 1 回の伝導ごとに平均 dt/2 遅れ、伝導速度が見かけ上遅くなるため）。
 *  - 三角形更新：辺だけで伝えると経路がジグザグになり、到達が実際より約 2 割遅れる（数値誤差）。
 *    そこで辺 v–u を共有する三角形の第 3 頂点 w がすでに同じ波で興奮していれば、
 *    辺 v–w 上の点 p（興奮時刻は v と w の線形補間）から u へ直進する経路も候補にする
 *    （eikonal 方程式の fast marching 法と同じ考え方）。
 *
 * 研究用途に拡張する場合は、この層を FitzHugh–Nagumo 等の反応拡散モデルに
 * 差し替えられるよう、外部からは step() / stimulate() のみを使うこと。
 */
/** 三角形更新で辺上を刻む数 */
const TRI_SAMPLES = 8;

export class CellularAutomaton {
  readonly tissue: TissueState;
  private pending: Float64Array; // 頂点ごとの「興奮到達予定時刻」（Infinity = なし）
  private queue = new MinHeap();
  private bridgeNb: { u: number; cv: number }[][];
  /** 辺 v→u を共有する三角形の第 3 頂点（key = v * n + u） */
  private opposite = new Map<number, number[]>();
  time = 0;

  constructor(readonly mesh: SurfaceMesh, opts?: { cv?: number; erp?: number }) {
    const n = mesh.positions.length / 3;
    this.tissue = {
      phase: new Uint8Array(n),
      timer: new Float32Array(n),
      lastActivation: new Float32Array(n).fill(-1),
      conductionVelocity: new Float32Array(n).fill(opts?.cv ?? CONDUCTION.atrialCv), // mm/ms（§4.2 一般心房筋）
      erp: new Float32Array(n).fill(opts?.erp ?? 250),
      fiber: new Float32Array(n * 3),
      cvLongitudinal: new Float32Array(n),
      viability: new Float32Array(n).fill(1),
      voltage: new Float32Array(n).fill(2.5),
    };
    this.pending = new Float64Array(n).fill(Infinity);
    const idx = mesh.indices;
    const addOpp = (a: number, b: number, c: number) => {
      const k = a * n + b;
      const list = this.opposite.get(k);
      if (list) list.push(c); else this.opposite.set(k, [c]);
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      addOpp(a, b, c); addOpp(b, a, c); addOpp(b, c, a); addOpp(c, b, a); addOpp(a, c, b); addOpp(c, a, b);
    }
    this.bridgeNb = Array.from({ length: n }, () => []);
    for (const b of mesh.bridges ?? []) {
      for (const [a, c] of b.pairs) {
        this.bridgeNb[a].push({ u: c, cv: b.cvMmPerMs });
        this.bridgeNb[c].push({ u: a, cv: b.cvMmPerMs });
      }
    }
  }

  /** 頂点 v を外部刺激で興奮させる（ペーシング・トリガー） */
  stimulate(v: number): boolean {
    const t = this.tissue;
    if (t.phase[v] !== 0 || t.viability[v] <= 0) return false;
    this.activate(v, this.time);
    return true;
  }

  /**
   * 頂点 v を時刻 t に興奮させる予約（刺激伝導系からの逆行伝導・PV トリガー・ペーシング）。
   * その時刻に不応期なら興奮しない（捕捉されない）。
   */
  excite(v: number, t: number) {
    this.schedule(v, t);
  }

  /** dt [ms] 進める */
  step(dt: number) {
    const t = this.tissue;
    const n = t.phase.length;
    this.time += dt;
    // 到達予定の興奮を時刻順に処理（この刻みの中で起きた興奮がさらに伝わる分も含む）
    while (this.queue.size > 0 && this.queue.peekTime() <= this.time) {
      const { time: ta, v } = this.queue.pop();
      if (ta !== this.pending[v]) continue; // より早い予定で上書きされた古いイベント
      this.pending[v] = Infinity;
      if (t.phase[v] === 0 && t.viability[v] > 0) this.activate(v, ta);
    }
    for (let v = 0; v < n; v++) {
      if (t.phase[v] === 0) continue;
      t.timer[v] = this.time - t.lastActivation[v];
      const absolute = t.erp[v] * 0.8;
      if (t.phase[v] === 1 && t.timer[v] >= absolute) t.phase[v] = 2;
      if (t.phase[v] === 2 && t.timer[v] >= t.erp[v]) { t.phase[v] = 0; t.timer[v] = 0; }
    }
  }

  /** 辺 v→u の伝導速度 mm/ms（異方性を含む。viability は含まない） */
  edgeVelocity(v: number, u: number, dx: number, dy: number, dz: number, dist: number): number {
    const t = this.tissue;
    const cvT = Math.min(t.conductionVelocity[v], t.conductionVelocity[u]);
    const cvL = Math.min(t.cvLongitudinal[v], t.cvLongitudinal[u]);
    if (cvL <= 0 || dist <= 0) return cvT;
    // 線維方向は両端の平均（向きをそろえてから足す）
    let fx = t.fiber[3 * v], fy = t.fiber[3 * v + 1], fz = t.fiber[3 * v + 2];
    const gx = t.fiber[3 * u], gy = t.fiber[3 * u + 1], gz = t.fiber[3 * u + 2];
    const s = fx * gx + fy * gy + fz * gz < 0 ? -1 : 1;
    fx += s * gx; fy += s * gy; fz += s * gz;
    const fl = Math.hypot(fx, fy, fz);
    if (fl === 0) return cvT;
    const c = (dx * fx + dy * fy + dz * fz) / (dist * fl);
    const c2 = c * c;
    return 1 / Math.sqrt(c2 / (cvL * cvL) + (1 - c2) / (cvT * cvT));
  }

  private schedule(u: number, arrival: number) {
    if (arrival < this.pending[u]) {
      this.pending[u] = arrival;
      this.queue.push(arrival, u);
    }
  }

  /** 頂点 v を時刻 ta に興奮させ、隣接頂点へ到達予定を書き込む */
  private activate(v: number, ta: number) {
    const t = this.tissue;
    t.phase[v] = 1;
    t.timer[v] = this.time - ta;
    t.lastActivation[v] = ta;
    const p = this.mesh.positions;
    for (const u of this.mesh.neighbors[v]) {
      if (t.phase[u] !== 0 || t.viability[u] <= 0) continue;
      const dx = p[3 * u] - p[3 * v], dy = p[3 * u + 1] - p[3 * v + 1], dz = p[3 * u + 2] - p[3 * v + 2];
      const dist = Math.hypot(dx, dy, dz);
      const cv = this.edgeVelocity(v, u, dx, dy, dz, dist) * t.viability[u];
      if (cv <= 0) continue;
      let arrival = ta + dist / cv;
      // 三角形更新：同じ波で興奮済みの第 3 頂点 w があれば、辺 v–w 上から直進する経路を試す
      const opp = this.opposite.get(v * p.length / 3 + u);
      if (opp) for (const w of opp) {
        if (t.phase[w] !== 1 || t.viability[w] <= 0) continue;
        const tw = t.lastActivation[w];
        if (ta - tw > 60) continue;
        arrival = Math.min(arrival, this.triangleArrival(v, w, u, ta, tw, cv));
      }
      this.schedule(u, arrival);
    }
    for (const { u, cv: bcv } of this.bridgeNb[v]) {
      if (t.phase[u] !== 0 || t.viability[u] <= 0) continue;
      const dist = Math.hypot(p[3 * u] - p[3 * v], p[3 * u + 1] - p[3 * v + 1], p[3 * u + 2] - p[3 * v + 2]);
      const cv = bcv * t.viability[u];
      if (cv <= 0) continue;
      this.schedule(u, ta + dist / cv);
    }
  }

  /**
   * 辺 v–w 上の点 p(s) = v + s (w − v)（時刻 tv + s (tw − tv)）から u へ直進したときの最早到達時刻。
   * s を 0〜1 で刻んで最小を取る（端点 s = 0 は辺 v→u と同じ）。
   */
  private triangleArrival(v: number, w: number, u: number, tv: number, tw: number, cv: number): number {
    const p = this.mesh.positions;
    let best = Infinity;
    for (let k = 1; k <= TRI_SAMPLES; k++) {
      const s = k / TRI_SAMPLES;
      const x = p[3 * v] + s * (p[3 * w] - p[3 * v]);
      const y = p[3 * v + 1] + s * (p[3 * w + 1] - p[3 * v + 1]);
      const z = p[3 * v + 2] + s * (p[3 * w + 2] - p[3 * v + 2]);
      const d = Math.hypot(p[3 * u] - x, p[3 * u + 1] - y, p[3 * u + 2] - z);
      const arr = tv + s * (tw - tv) + d / cv;
      if (arr < best) best = arr;
    }
    return best;
  }

  reset() {
    const t = this.tissue;
    t.phase.fill(0); t.timer.fill(0); t.lastActivation.fill(-1);
    this.pending.fill(Infinity);
    this.queue = new MinHeap();
    this.time = 0;
  }
}

