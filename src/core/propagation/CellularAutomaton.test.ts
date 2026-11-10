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

import { surfaceNets } from '../geometry/parametric/surfaceNets';
import { ellipsoid, v3 } from '../geometry/parametric/sdf';
import { buildNeighbors } from '../geometry/buildNeighbors';

function sphereMesh(R: number) {
  const raw = surfaceNets(ellipsoid(v3(0, 0, 0), v3(R, R, R)), { min: [-R - 4, -R - 4, -R - 4], max: [R + 4, R + 4, R + 4] }, 2);
  const n = raw.positions.length / 3;
  return { chamber: 'LA' as const, positions: raw.positions, indices: raw.indices, neighbors: buildNeighbors(n, raw.indices), regionOfVertex: new Uint8Array(n), regionNames: [] };
}

describe('CellularAutomaton の精度と異方性', () => {
  it('到達時刻 × 伝導速度が表面距離（大円）と 5 % 以内で一致する（刻み 2 ms でも）', () => {
    const R = 20;
    const mesh = sphereMesh(R);
    const ca = new CellularAutomaton(mesh, { cv: 1.0 });
    const p = mesh.positions;
    let top = 0;
    for (let v = 0; v < p.length / 3; v++) if (p[3 * v + 1] > p[3 * top + 1]) top = v;
    ca.stimulate(top);
    for (let i = 0; i < 60; i++) ca.step(2);
    const ratios: number[] = [];
    for (let v = 0; v < p.length / 3; v++) {
      const t = ca.tissue.lastActivation[v];
      const geo = R * Math.acos(Math.max(-1, Math.min(1, p[3 * v + 1] / Math.hypot(p[3 * v], p[3 * v + 1], p[3 * v + 2]))));
      if (t > 0 && geo > 10) ratios.push((t * 1.0) / geo);
    }
    ratios.sort((a, b) => a - b);
    expect(Math.abs(ratios[ratios.length >> 1] - 1)).toBeLessThan(0.05);
  });

  it('線維方向（上下）だけ速い組織では、上下方向に速く伝わる', () => {
    const mesh = sphereMesh(20);
    const ca = new CellularAutomaton(mesh, { cv: 1.0 });
    const p = mesh.positions;
    const n = p.length / 3;
    for (let v = 0; v < n; v++) {
      // 接平面に射影した上下方向を線維方向とする
      const x = p[3 * v], y = p[3 * v + 1], z = p[3 * v + 2];
      const l = Math.hypot(x, y, z);
      const d = y / l;
      let fx = -d * x / l, fy = 1 - d * y / l, fz = -d * z / l;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      ca.tissue.fiber.set([fx, fy, fz], 3 * v);
      ca.tissue.cvLongitudinal[v] = 2.0;
    }
    // 赤道上の点から刺激し、上下方向と水平方向へ 10 mm 離れた点の到達時刻を比べる
    let start = 0;
    for (let v = 0; v < n; v++) if (Math.abs(p[3 * v + 1]) < Math.abs(p[3 * start + 1]) && p[3 * v] > 15) start = v;
    ca.stimulate(start);
    for (let i = 0; i < 30; i++) ca.step(2);
    const sx = p[3 * start], sy = p[3 * start + 1], sz = p[3 * start + 2];
    const near = (dx: number, dy: number, dz: number) => {
      let best = 0, bd = Infinity;
      for (let v = 0; v < n; v++) {
        const d = Math.hypot(p[3 * v] - (sx + dx), p[3 * v + 1] - (sy + dy), p[3 * v + 2] - (sz + dz));
        if (d < bd) { bd = d; best = v; }
      }
      return ca.tissue.lastActivation[best];
    };
    const vertical = near(0, 10, 0), horizontal = near(0, 0, 10);
    expect(vertical).toBeLessThan(horizontal * 0.75);
  });

  it('心房間の連結は、連結ごとの伝導速度で伝える', () => {
    const base = makeEllipsoidChamber('LA', { x: 10, y: 10, z: 10 }, 8);
    const n = base.positions.length / 3;
    // 2 つの頂点の間に連結を張る（隣接リストにはない）
    const a = 0, b = n - 1;
    const dist = Math.hypot(base.positions[0] - base.positions[3 * b], base.positions[1] - base.positions[3 * b + 1], base.positions[2] - base.positions[3 * b + 2]);
    const mesh = { ...base, neighbors: base.neighbors.map(() => new Int32Array(0)), bridges: [{ name: 'bachmann' as const, pairs: [[a, b] as [number, number]], cvMmPerMs: 2.0 }] };
    const ca = new CellularAutomaton(mesh);
    ca.stimulate(a);
    for (let i = 0; i < 20; i++) ca.step(1);
    expect(ca.tissue.lastActivation[b]).toBeCloseTo(dist / 2.0, 3);
  });
});
