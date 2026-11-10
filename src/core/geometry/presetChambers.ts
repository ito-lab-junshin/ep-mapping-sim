import type { SurfaceMesh, ChamberId } from '../types';
import { buildNeighbors } from './buildNeighbors';
import { weldVertices } from './weldVertices';

/**
 * プリセット心腔メッシュ（開発初期用の楕円体）。
 * TODO(Phase 2): 解剖学的 LA（4 本の PV 口・LAA・僧帽弁輪）と RA（CTI・Koch 三角・
 *   三尖弁輪・CS 口）をもつ glTF を src/data/ に置き、ここで読み込む。
 *   領域ラベル（regionOfVertex）はメッシュ側の頂点カラーまたは別ファイルで与える。
 */
export function makeEllipsoidChamber(
  chamber: ChamberId,
  radii: { x: number; y: number; z: number },
  segments = 48,
): SurfaceMesh {
  const rings = segments, slices = segments;
  const positions: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const v = (i / rings) * Math.PI;
    for (let j = 0; j <= slices; j++) {
      const u = (j / slices) * Math.PI * 2;
      positions.push(
        radii.x * Math.sin(v) * Math.cos(u),
        radii.y * Math.cos(v),
        radii.z * Math.sin(v) * Math.sin(u),
      );
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = a + slices + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // 極・継ぎ目の重複頂点をまとめる（継ぎ目が伝導ブロック線にならないように）
  const welded = weldVertices(positions, indices);
  const idx = welded.indices;
  const vertexCount = welded.positions.length / 3;
  return {
    chamber,
    positions: welded.positions,
    indices: idx,
    neighbors: buildNeighbors(vertexCount, idx),
    regionOfVertex: new Uint8Array(vertexCount), // 0 = 一般心房筋
    regionNames: ['atrial_myocardium'],
  };
}

export const PRESET_LA = () => makeEllipsoidChamber('LA', { x: 22, y: 20, z: 24 });
export const PRESET_RA = () => makeEllipsoidChamber('RA', { x: 24, y: 26, z: 22 });
