import type { SurfaceMesh, ChamberId } from '../types';
import { buildNeighbors } from './buildNeighbors';
import { weldVertices } from './weldVertices';

/**
 * 楕円体メッシュ（単体テスト用の簡易形状）。
 * 解剖メッシュは parametric/atria.ts（ChamberLoader 経由）を使う。
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
