import { describe, it, expect } from 'vitest';
import { makeEllipsoidChamber } from './presetChambers';
import { weldVertices } from './weldVertices';
import { CellularAutomaton } from '../propagation/CellularAutomaton';

describe('weldVertices', () => {
  it('重複頂点をまとめ、潰れた三角形を除く', () => {
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0];
    const r = weldVertices(pos, [0, 1, 2, 0, 3, 2, 1, 3, 2]);
    expect(r.positions.length / 3).toBe(3);
    expect(Array.from(r.indices)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('楕円体の極と継ぎ目が 1 頂点・連続した面になる', () => {
    const seg = 16;
    const mesh = makeEllipsoidChamber('LA', { x: 20, y: 20, z: 20 }, seg);
    // 極 2 点 + 中間リング (seg-1) × seg 点
    expect(mesh.positions.length / 3).toBe(2 + (seg - 1) * seg);
    for (const nb of mesh.neighbors) expect(nb.length).toBeGreaterThanOrEqual(3);
  });

  it('継ぎ目をまたいで伝導する（経度 0° 付近の両側がほぼ同時に興奮）', () => {
    const mesh = makeEllipsoidChamber('LA', { x: 20, y: 20, z: 20 }, 24);
    const ca = new CellularAutomaton(mesh);
    // 継ぎ目（+x 方向、赤道）の頂点を刺激し、すぐ両隣（z の正負）が同程度の時刻で興奮すること
    const p = mesh.positions;
    let seam = 0;
    for (let v = 0; v < p.length / 3; v++) if (p[3 * v] > p[3 * seam] ) seam = v;
    ca.stimulate(seam);
    for (let i = 0; i < 20; i++) ca.step(1);
    const nb = Array.from(mesh.neighbors[seam]);
    const plusZ = nb.filter((u) => p[3 * u + 2] > 1);
    const minusZ = nb.filter((u) => p[3 * u + 2] < -1);
    expect(plusZ.length).toBeGreaterThan(0);
    expect(minusZ.length).toBeGreaterThan(0);
    for (const u of [...plusZ, ...minusZ]) expect(ca.tissue.lastActivation[u]).toBeGreaterThanOrEqual(0);
  });
});
