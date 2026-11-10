import { describe, it, expect } from 'vitest';
import { makeEllipsoidChamber } from '../geometry/presetChambers';
import { CellularAutomaton } from './CellularAutomaton';

describe('CellularAutomaton', () => {
  it('興奮が刺激点から全頂点へ伝わる', () => {
    const mesh = makeEllipsoidChamber('LA', { x: 20, y: 20, z: 20 }, 16);
    const ca = new CellularAutomaton(mesh);
    expect(ca.stimulate(0)).toBe(true);
    for (let i = 0; i < 400; i++) ca.step(1);
    const activated = Array.from(ca.tissue.lastActivation).filter((t) => t >= 0).length;
    expect(activated).toBe(mesh.positions.length / 3);
  });

  it('viability 0 の帯は伝導を遮断する', () => {
    const mesh = makeEllipsoidChamber('LA', { x: 20, y: 20, z: 20 }, 16);
    const ca = new CellularAutomaton(mesh);
    // 赤道（y≈0）に病変帯をつくる
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (Math.abs(mesh.positions[3 * v + 1]) < 3) ca.tissue.viability[v] = 0;
    }
    ca.stimulate(0); // 北極付近
    for (let i = 0; i < 600; i++) ca.step(1);
    const south = mesh.positions.length / 3 - 1;
    expect(ca.tissue.lastActivation[south]).toBe(-1);
  });
});
