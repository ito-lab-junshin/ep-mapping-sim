import { AV_NODE } from '../params';

/**
 * 房室結節の経路（docs/DESIGN.md §5.3）。
 * 速伝導路（前上方）と遅伝導路（後下方）がそれぞれ Koch 三角の入口頂点をもち、共通路（His の手前）で合流する。
 * 洞調律や AFL などのシナリオは速伝導路だけを使い、AVNRT は 2 経路を使う。
 */
export interface PathwayParams {
  name: 'fast' | 'slow';
  /** 入口頂点（心房メッシュ）の興奮 → His までの基本の伝導時間 */
  ahMs: number;
  erpMs: number;
  /** 減衰伝導：AH の延長の最大値と時定数 */
  decrementMaxMs: number;
  decrementTauMs: number;
  /** 逆行伝導（共通路 → 入口頂点）の時間と ERP。未設定なら逆行しない */
  retroMs?: number;
  retroErpMs?: number;
}

export interface PathwayState {
  params: PathwayParams;
  /** 入口頂点（心房側の出口も同じ） */
  vertex: number;
  /** 最後に興奮した時刻（順行・逆行のどちらでも） */
  last: number;
  /** 入口の領域の頂点（遅伝導路。AV_NODE.slowRegion）。なければ入口頂点だけ */
  region?: number[];
  /** 領域の頂点のうち焼けた割合（エンジンが毎刻み更新する） */
  ablatedFraction?: number;
}

/** 経路の状態：離断（伝導しない）・修飾（ERP 延長・エコーなし）・正常 */
export function pathwayStatus(p: PathwayState): 'blocked' | 'modified' | 'intact' {
  const f = p.ablatedFraction ?? 0, R = AV_NODE.slowRegion;
  if (!p.region) return 'intact';
  if (f >= R.blockFraction) return 'blocked';
  if (f >= R.modifyFraction) return 'modified';
  return 'intact';
}

export function fastPathway(vertex: number): PathwayState {
  return { params: { name: 'fast', ...AV_NODE.fast }, vertex, last: -Infinity };
}
export function slowPathway(vertex: number): PathwayState {
  return { params: { name: 'slow', ...AV_NODE.slow }, vertex, last: -Infinity };
}

/** 連結期 coupling での順行性の伝導時間。ERP 未満なら null（ブロック） */
export function antegradeTime(p: PathwayParams, couplingMs: number): number | null {
  if (couplingMs < p.erpMs) return null;
  return p.ahMs + p.decrementMaxMs * Math.exp(-(couplingMs - p.erpMs) / p.decrementTauMs);
}
