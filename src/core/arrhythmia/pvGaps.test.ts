import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario } from './af';
import { isolatedPvs, pvGaps } from './pv';
import { pvRingPoints } from '../research/strategies';
import { PV_NAMES } from '../geometry/regions';
import type { Vec3 } from '../types';

/** PV の隙間の候補（チュートリアルの補助、QA の所見 6〜8） */
const make = () => { const e = new SimulationEngine(loadParametricSync('afRemodeled')); afScenario.setupSubstrate(e); return e; };
const rf = (e: SimulationEngine, point: Vec3) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW: 30, durationS: 30 };
  expect(e.ablation.start('rf')).toBeNull();
  e.ablation.speed = 250;
  while (e.ablation.active) e.ablation.step(e.sampleMs);
};
const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('PV の隙間の候補', () => {
  it('通電の前は、どの PV も隔離されておらず、通り道は病変に接していない（未通電）', () => {
    const e = make();
    for (const pv of PV_NAMES) {
      const g = pvGaps(e, pv);
      expect(g.isolated).toBe(false);
      expect(g.touchesLesion).toBe(false);
      expect(g.encircled).toBe(0);
      expect(g.clusters.length).toBe(0);
    }
  });

  it('一周すると候補は 0 で隔離（isolatedPvs と一致）。1 点抜くと、抜いた点の近くに隙間が出る', () => {
    const full = make();
    const pts = pvRingPoints(full, 'LSPV', 5);
    for (const p of pts) rf(full, p);
    const g = pvGaps(full, 'LSPV');
    expect(g.isolated).toBe(true);
    expect(g.vertices.length).toBe(0);
    expect(isolatedPvs(full)).toContain('LSPV');

    const gap = make();
    const skip = Math.floor(pts.length / 2);
    pts.forEach((p, i) => { if (i !== skip) rf(gap, p); });
    const h = pvGaps(gap, 'LSPV');
    expect(h.isolated).toBe(false);
    expect(isolatedPvs(gap)).not.toContain('LSPV');
    expect(h.touchesLesion).toBe(true);
    expect(h.clusters.length).toBeGreaterThanOrEqual(1);
    const nearest = Math.min(...h.clusters.map((c) => d(c.center, pts[skip])));
    expect(nearest).toBeLessThan(6);
  }, 120_000);
});

describe('PV の隙間の候補：隣の PV', () => {
  it('LSPV だけを焼いても、ほかの PV には隙間の印を出さない（隣の PV のまわりの病変は半周に満たない）', () => {
    const e = make();
    const pts = pvRingPoints(e, 'LSPV', 5);
    pts.forEach((p, i) => { if (i !== 3) rf(e, p); });
    expect(pvGaps(e, 'LSPV').touchesLesion).toBe(true);
    for (const pv of ['LIPV', 'RSPV', 'RIPV'] as const) {
      const g = pvGaps(e, pv);
      expect(g.touchesLesion, pv).toBe(false);
      expect(g.encircled, pv).toBeLessThan(0.5);
    }
  }, 120_000);
});
