import type { BiatrialModel } from './parametric/atria';
import { buildBiatrialModel } from './parametric/atria';
import type { DimensionSetId } from './parametric/dimensions';
import { loadGltfModel } from './gltf/GltfLoader';
import type { LabelFile } from './gltf/labels';

/**
 * 解剖メッシュの読み込み口（docs/DESIGN.md §9.1）。
 * パラメトリック生成（Phase 2）と glTF（Phase 7、gltf/GltfLoader.ts）。
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

/**
 * glTF のモデルの読み込み口（Phase 7）。どの症例（寸法セット）にも同じ形を使う。
 * labels を省くと領域を形から半自動で推定する（gltf/estimate.ts）
 */
export function gltfChamberLoader(name: string, data: ArrayBuffer | Uint8Array | string, labels?: LabelFile): ChamberLoader {
  let model: BiatrialModel | null = null;
  return {
    id: `gltf:${name}`,
    label: `glTF：${name}`,
    load: async () => (model ??= loadGltfModel(data, labels, { name }).model),
  };
}
