import type { Catheter, SurfaceMesh, TissueState } from '../types';

/**
 * 心内心電図（EGM）生成。
 *
 * 方針（docs/DESIGN.md §6）:
 *  - 単極電位: 電極近傍の頂点について「活性化からの経過時間」に応じた
 *    テンプレート波形（RS 型）を距離重み付きで加算する。
 *  - 双極電位: 2 電極の単極電位の差分。接触頂点の voltage でスケールする。
 *  - 遠隔電位（far-field）: 距離の 2 乗で減衰する成分として全頂点から加算（間引き可）。
 *  - 非接触（contactVertex = -1）の電極は far-field のみ → 低振幅の鈍な波形になる。
 *
 * TODO(Phase 3): PV 電位（PVP）と心房電位の分離、fractionation（AF・遅伝導路）、
 *   His 電位・心室遠隔電位のテンプレート追加。
 */
export class EgmGenerator {
  constructor(readonly mesh: SurfaceMesh, readonly tissue: TissueState) {}

  /** 1 電極の単極電位 [mV] を現在時刻 now [ms] で返す */
  unipolar(vertex: number, now: number): number {
    if (vertex < 0) return 0;
    const t = this.tissue;
    let sum = 0;
    const center = vertex;
    const p = this.mesh.positions;
    const cx = p[3 * center], cy = p[3 * center + 1], cz = p[3 * center + 2];
    // 近傍 2 リングのみ（簡易）。研究用途では半径指定の探索に置換。
    const ring1 = this.mesh.neighbors[center];
    const visited = new Set<number>([center, ...ring1]);
    for (const u of ring1) for (const w of this.mesh.neighbors[u]) visited.add(w);
    for (const v of visited) {
      const dt = now - t.lastActivation[v];
      if (t.lastActivation[v] < 0 || dt < 0 || dt > 60) continue;
      const d = Math.hypot(p[3 * v] - cx, p[3 * v + 1] - cy, p[3 * v + 2] - cz);
      sum += template(dt) * t.voltage[v] / (1 + d);
    }
    return sum;
  }

  /** カテーテルの全双極チャンネルの現在値を返す */
  bipolarAll(cath: Catheter, now: number): number[] {
    return cath.bipoles.map(([a, b]) =>
      this.unipolar(cath.electrodes[a].contactVertex, now) -
      this.unipolar(cath.electrodes[b].contactVertex, now));
  }
}

/** 活性化からの経過時間 dt [ms] に対する単極テンプレート（RS 型、正規化） */
function template(dt: number): number {
  // 正の R 波 → 急峻な S 波（intrinsic deflection）→ 回復
  if (dt < 8) return Math.sin((dt / 8) * Math.PI / 2);
  if (dt < 16) return Math.cos(((dt - 8) / 8) * Math.PI); // +1 → -1
  if (dt < 60) return -Math.exp(-(dt - 16) / 10);
  return 0;
}
