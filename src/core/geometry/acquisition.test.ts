import { describe, it, expect } from 'vitest';
import { loadParametricSync } from './ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { GeometryAcquisition } from './acquisition';
import { ACQUISITION } from '../params';

describe('収集モード（FAM 風、§9.2）', () => {
  const engine = new SimulationEngine(loadParametricSync('normal'));
  const la = engine.mesh.parts![0];

  it('収集前は何も表示されない（全体が穴）', () => {
    const acq = new GeometryAcquisition(engine.mesh);
    expect(acq.revealedIndices().length).toBe(0);
    expect(acq.coveragePct()).toBe(0);
  });

  it('壁から離れた電極は点を記録するが、形は現れない', () => {
    const acq = new GeometryAcquisition(engine.mesh);
    const v = la.vertexStart + 100;
    const p = engine.query.position(v), n = engine.query.normalAt(v);
    const h = ACQUISITION.wallReachMm + 3;
    expect(acq.addElectrode({ x: p.x - n.x * h, y: p.y - n.y * h, z: p.z - n.z * h }, h)).toBe(false);
    expect(acq.points.length).toBe(1);
    expect(acq.coveragePct()).toBe(0);
  });

  it('ABL で LA の壁をなぞるほど被覆率が上がり、表示は真のメッシュの三角形の一部になる。RA は収集されない', () => {
    const acq = new GeometryAcquisition(engine.mesh);
    const cov: number[] = [];
    for (const stride of [400, 100, 25]) {
      for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v += stride) {
        engine.setPlacement('abl', { kind: 'free', point: engine.query.position(v), heightMm: 1, rotationDeg: 0 });
        acq.collect([engine.catheter('abl')!]);
      }
      cov.push(acq.coveragePct(la.vertexStart, la.vertexCount));
    }
    expect(cov[0]).toBeGreaterThan(0);
    expect(cov[1]).toBeGreaterThan(cov[0]);
    expect(cov[2]).toBeGreaterThan(80);
    const ra = engine.mesh.parts![1];
    expect(acq.coveragePct(ra.vertexStart, ra.vertexCount)).toBeLessThan(5);
    const shown = acq.revealedIndices(la.indexStart, la.indexCount);
    expect(shown.length).toBeGreaterThan(0.75 * la.indexCount);
    expect(shown.length % 3).toBe(0);
    const v0 = acq.version;
    acq.clear();
    expect(acq.coveragePct()).toBe(0);
    expect(acq.version).toBeGreaterThan(v0);
  });

  it('同じ場所の電極は 1 点として記録する（間隔 1.5 mm 以上）', () => {
    const acq = new GeometryAcquisition(engine.mesh);
    const p = engine.query.position(la.vertexStart);
    acq.addElectrode(p, 0); acq.addElectrode({ x: p.x + 0.1, y: p.y, z: p.z }, 0);
    expect(acq.points.length).toBeLessThanOrEqual(2);
    acq.addElectrode({ x: p.x + 0.05, y: p.y, z: p.z }, 0);
    expect(acq.points.length).toBeLessThanOrEqual(2);
  });
});
