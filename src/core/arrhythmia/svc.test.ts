import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario, afTypeOf, circularSvcContacts } from './af';
import { phrenicNerveLine, segmentDistanceMm, svcDistalVertices, svcGapHint, svcIsolated, svcRingPoints, svcTip, svcVertices } from './svc';
import { PV_NAMES, PV_OSTIUM, REGION_ID } from '../geometry/regions';
import { ablateAt } from '../ablation/simpleAblation';
import { isolatedPvs } from './pv';
import { GoalTracker } from '../learning/GoalTracker';
import { ABLATION, AF_SUBSTRATE } from '../params';
import type { Vec3 } from '../types';

/** AF-2：非 PV トリガー（SVC）。docs/DESIGN.md §5.1 */
const make = (afType?: 'pv' | 'pvSvc') => {
  const e = new SimulationEngine(loadParametricSync('afRemodeled'));
  afScenario.setupSubstrate(e, afType ? { afType } : undefined);
  return e;
};
/** PV 口の帯をすべて焼く（簡易通電）＝ 4 本の PV の隔離 */
const pvi = (e: SimulationEngine) => {
  for (const pv of PV_NAMES) {
    const id = REGION_ID[PV_OSTIUM[pv]];
    e.mesh.regionOfVertex.forEach((r, v) => { if (r === id) ablateAt(e, e.query.position(v)); });
  }
  expect(isolatedPvs(e)).toHaveLength(4);
};
const finish = (e: SimulationEngine) => { e.ablation.speed = 250; while (e.ablation.active) e.ablation.step(e.sampleMs); };
const rf = (e: SimulationEngine, point: Vec3) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW: 30, durationS: 30 };
  expect(e.ablation.start('rf')).toBeNull();
  e.ablation.step(e.sampleMs);
  const m = e.ablation.metrics();
  finish(e);
  return m;
};
const inAf = (e: SimulationEngine) => e.rhythm.state === 'tachycardia';

describe('AF-2：SVC の心筋スリーブとトリガー', () => {
  it('AF の型の既定は pv。SVC は afRemodeled だけ 20 mm（ほかの寸法セットは 12 mm のまま）', () => {
    expect(afTypeOf(undefined)).toBe('pv');
    expect(make().caseOptions.afType).toBe('pv');
    const af = loadParametricSync('afRemodeled'), normal = loadParametricSync('normal');
    expect(af.dimensions.vein.svcLength).toBe(20);
    expect(normal.dimensions.vein.svcLength).toBeUndefined();
    expect(normal.dimensions.vein.length).toBe(12);
  });

  it('pvSvc：SVC のスリーブは PV のスリーブと同じ伝導速度・ERP で、先端にトリガーがある。pv の型にはない', () => {
    const e = make('pvSvc');
    const v = svcVertices(e);
    expect(v.length).toBeGreaterThan(100);
    expect(e.ca.tissue.erp[v[0]]).toBe(AF_SUBSTRATE.svcSleeveErpMs);
    expect(e.ca.tissue.conductionVelocity[v[0]]).toBe(AF_SUBSTRATE.svcSleeveCv);
    expect(e.foci.some((f) => f.vertex === svcTip(e))).toBe(true);
    expect(e.foci).toHaveLength(3);
    expect(make('pv').foci).toHaveLength(2);
    // 隔離の判定に使う遠位側はスリーブの一部
    expect(svcDistalVertices(e).length).toBeLessThan(v.length);
  });

  it('pvSvc：PVI の後も AF が続き、SVC–RA 接合部の少し上を RF で一周すると SVC が隔離されて AF が止まる。根治の基準がすべて満たされる', () => {
    const e = make('pvSvc');
    e.tick(6000);
    expect(inAf(e)).toBe(true);
    pvi(e);
    e.tick(8000);
    expect(inAf(e), 'PVI だけでは止まらない').toBe(true);
    const before = afScenario.structuralChecks(e);
    expect(before.find((c) => c.id === 'entrance-SVC')!.ok).toBe(false);
    for (const p of svcRingPoints(e)) rf(e, p);
    expect(svcIsolated(e)).toBe(true);
    e.tick(8000);
    expect(inAf(e)).toBe(false);
    const checks = afScenario.structuralChecks(e);
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
  }, 240_000);

  it('pv（既定）：PVI で AF が止まる（SVC のトリガーがないので SVC の基準もない）', () => {
    const e = make('pv');
    e.tick(4000);
    pvi(e);
    e.tick(6000);
    expect(inAf(e)).toBe(false);
    expect(afScenario.structuralChecks(e).some((c) => c.id.endsWith('SVC'))).toBe(false);
  }, 120_000);

  it('RF の注意：右横隔神経の走行（模式）・洞結節の部位から 5 mm 以内で出る（合併症は再現しない）', () => {
    const e = make('pvSvc');
    const [a, b] = phrenicNerveLine(e);
    const ring = svcRingPoints(e);
    const near = ring.reduce((m, p) => (segmentDistanceMm(p, a, b) < segmentDistanceMm(m, a, b) ? p : m));
    expect(segmentDistanceMm(near, a, b)).toBeLessThan(ABLATION.phrenicWarningMm);
    expect(rf(e, near)?.message ?? '').toContain('横隔神経');
    const sn = make('pvSvc');
    expect(rf(sn, sn.model.anatomy.anchors.sinusNode.point)?.message ?? '').toContain('洞結節');
    // 接合部の少し上の輪は洞結節から離れている
    const p = e.model.anatomy.anchors.sinusNode.point;
    expect(Math.min(...ring.map((q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)))).toBeGreaterThan(ABLATION.sinusNodeWarningMm);
  }, 120_000);

  it('学習ゴール：SVC のゴールは pvSvc だけ。環状カテーテルを SVC に置くと SVC 電位を記録できる', () => {
    const t = new GoalTracker(afScenario.goals);
    const e0 = make('pv');
    t.update(e0);
    expect(t.activeGoals().some((g) => g.id.startsWith('svc'))).toBe(false);

    const e = make('pvSvc');
    const g = new GoalTracker(afScenario.goals);
    pvi(e);
    const o = e.model.anatomy.ra.svc;
    const len = e.model.dimensions.vein.svcLength!;
    const inSvc = { x: o.center.x - o.axis.x * len * 0.4, y: o.center.y - o.axis.y * len * 0.4, z: o.center.z - o.axis.z * len * 0.4 };
    e.setPlacement('circ', { kind: 'free', point: e.query.closestPoint(inSvc, svcVertices(e)).point, heightMm: 1, rotationDeg: 0, diameterMm: 20 });
    expect(circularSvcContacts(e).length).toBeGreaterThanOrEqual(3);
    e.tick(3000);
    g.update(e);
    expect(g.activeGoals().map((x) => x.id)).toEqual(expect.arrayContaining(['svc-potential', 'svc-isolation', 'af-stopped']));
    expect(g.isAchieved('svc-potential')).toBe(true);
    expect(g.isAchieved('svc-isolation')).toBe(false);
  }, 120_000);
});

describe('隙間のヒント：SVC の一周（pvSvc の型だけ）', () => {
  it('焼く前は未隔離・まだ焼いていない。一周すると隔離。隣り合う 2 点を抜くと、その近くに隙間の印', () => {
    expect(afScenario.gapHints!(make('pv')).map((g) => g.name)).not.toContain('SVC');
    const e0 = make('pvSvc');
    const g0 = afScenario.gapHints!(e0).find((g) => g.name === 'SVC')!;
    expect(g0.complete).toBe(false);
    expect(g0.coverage).toBe(0);
    expect(g0.showGaps).toBe(false);

    const full = make('pvSvc');
    const ring = svcRingPoints(full);
    for (const p of ring) rf(full, p);
    expect(svcIsolated(full)).toBe(true);
    expect(svcGapHint(full).complete).toBe(true);

    const gap = make('pvSvc');
    const skip = [3, 4];
    ring.forEach((p, i) => { if (!skip.includes(i)) rf(gap, p); });
    const g = svcGapHint(gap);
    expect(svcIsolated(gap)).toBe(false);
    expect(g.complete).toBe(false);
    expect(g.coverage).toBeGreaterThanOrEqual(0.5);
    expect(g.showGaps).toBe(true);
    const mid = { x: (ring[3].x + ring[4].x) / 2, y: (ring[3].y + ring[4].y) / 2, z: (ring[3].z + ring[4].z) / 2 };
    expect(Math.min(...g.clusters.map((c) => Math.hypot(c.center.x - mid.x, c.center.y - mid.y, c.center.z - mid.z)))).toBeLessThan(8);
  }, 180_000);
});
