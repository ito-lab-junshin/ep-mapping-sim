import type { BiatrialModel } from './parametric/atria';
import { buildBiatrialModel } from './parametric/atria';
import type { DimensionSetId } from './parametric/dimensions';

/**
 * 解剖メッシュの読み込み口（docs/DESIGN.md §9.1）。
 * Phase 2 はパラメトリック生成のみ。Phase 7 で glTF ローダ（公開モデル）を同じインターフェースで追加する。
 * どのローダも、領域ラベル（regionOfVertex）・心房間の連結・解剖の目印（anatomy）を持つ BiatrialModel を返す。
 */
export interface ChamberLoader {
  readonly id: string;
  readonly label: string;
  load(set: DimensionSetId): Promise<BiatrialModel>;
}

const cache = new Map<DimensionSetId, BiatrialModel>();

/** パラメトリック生成は同期で作れるため、初期表示とテストではこちらを使う */
export function loadParametricSync(set: DimensionSetId): BiatrialModel {
  let m = cache.get(set);
  if (!m) { m = buildBiatrialModel(set); cache.set(set, m); }
  return m;
}

export const parametricLoader: ChamberLoader = {
  id: 'parametric',
  label: 'パラメトリック（数式で生成）',
  load: async (set) => loadParametricSync(set),
};
