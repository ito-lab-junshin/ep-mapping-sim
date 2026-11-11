/**
 * パラメトリックモデルを glTF（GLB）と領域ラベルの JSON に書き出す（Blender での手直しの出発点、往復の確認用）。
 *   npm run export-gltf -- normal 出力.glb 出力.labels.json
 * 寸法セット：normal／afRemodeled／aflRemodeled
 */
import { writeFileSync } from 'node:fs';
import { loadParametricSync } from '../src/core/geometry/ChamberLoader';
import { exportModelToGltf } from '../src/core/geometry/gltf/GltfLoader';
import type { DimensionSetId } from '../src/core/geometry/parametric/dimensions';

const [set = 'normal', glbPath = `${set}.glb`, labelsPath = `${set}.labels.json`] = process.argv.slice(2).filter((a) => a !== '--');
const { glb, labels } = exportModelToGltf(loadParametricSync(set as DimensionSetId));
writeFileSync(glbPath, glb);
writeFileSync(labelsPath, JSON.stringify(labels));
console.error(`書き出し：${glbPath}（${glb.byteLength} バイト）、${labelsPath}`);
