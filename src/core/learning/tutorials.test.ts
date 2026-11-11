import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario } from '../arrhythmia/af';
import { verifyCure } from '../arrhythmia/common';
import { GeometryAcquisition } from '../geometry/acquisition';
import { GoalTracker } from './GoalTracker';
import { PVI_TUTORIAL, TUTORIAL_LA_COVERAGE_PCT, advanceTutorial, type TutorialContext } from './tutorials';
import { protocolStartState } from './events';
import { PV_NAMES, type PvName } from '../geometry/regions';
import type { Vec3 } from '../types';

/** PVI のチュートリアルを、指示どおりの操作（スクリプト）で最後まで進められる（Phase 6 の完了条件） */
describe('チュートリアル：PVI（RF）', () => {
  it('指示どおりに操作すると、手順が 1 つずつ進んで最後まで完了する', () => {
    const e = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(e);
    const goals = new GoalTracker(afScenario.goals);
    const acq = new GeometryAcquisition(e.mesh);
    const la = e.mesh.parts![0];
    const ui: TutorialContext['ui'] = { arrhythmia: 'avnrt', geometryMode: 'preset', laCoveragePct: 0, coverageTargetPct: 95, cureOk: false };
    const ctx = (): TutorialContext => ({ engine: e, goals, points: [], ui: { ...ui, laCoveragePct: acq.coveragePct(la.vertexStart, la.vertexCount) } });
    let i = 0;
    const step = () => { goals.update(e); i = advanceTutorial(PVI_TUTORIAL, i, ctx()); return PVI_TUTORIAL.steps[i]?.id ?? 'done'; };
    const rf = (point: Vec3) => {
      e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
      e.ablation.rf = { powerW: 30, durationS: 30 };
      expect(e.ablation.start('rf')).toBeNull();
      e.ablation.speed = 250;
      while (e.ablation.active) e.ablation.step(e.sampleMs);
    };
    /** PV 口の前庭部を一周（間隔 約 5 mm） */
    const ring = (pv: PvName) => {
      const info = e.model.anatomy.la.pvs.find((x) => x.name === pv)!, f = info.frame, R = info.radius + 3;
      const n = Math.ceil((2 * Math.PI * R) / 5);
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n, c = Math.cos(a) * R, s = Math.sin(a) * R;
        rf(e.query.closestPoint({
          x: info.ostium.x + f.u.x * c + f.v.x * s - f.axis.x * 2,
          y: info.ostium.y + f.u.y * c + f.v.y * s - f.axis.y * 2,
          z: info.ostium.z + f.u.z * c + f.v.z * s - f.axis.z * 2,
        }).point);
      }
    };

    expect(step()).toBe('scenario');
    ui.arrhythmia = 'af';
    expect(step()).toBe('geometry-mode');
    ui.geometryMode = 'acquire';
    expect(step()).toBe('build-la');
    // ABL で LA の壁をなぞる
    for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v += 25) {
      e.setPlacement('abl', { kind: 'free', point: e.query.position(v), heightMm: 1, rotationDeg: 0 });
      acq.collect([e.catheter('abl')!]);
    }
    // 目安（設定）を 95 % にすると届かず、既定の 70 % に戻すと進む
    expect(step()).toBe('build-la');
    ui.coverageTargetPct = TUTORIAL_LA_COVERAGE_PCT;
    expect(step()).toBe('pv-potential');
    const pv = e.model.anatomy.la.pvs.find((p) => p.name === 'LSPV')!, f = pv.frame;
    e.setPlacement('circ', { kind: 'free', point: { x: pv.ostium.x + f.axis.x * 6, y: pv.ostium.y + f.axis.y * 6, z: pv.ostium.z + f.axis.z * 6 }, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
    e.tick(1500);
    expect(step()).toBe('voltage-map');
    expect(PVI_TUTORIAL.steps[i].optional).toBe(true);
    i++; // 任意の手順をとばす
    expect(step()).toBe('ablate-lspv');
    ring('LSPV');
    expect(step()).toBe('all-pvs');
    for (const p of PV_NAMES.filter((x) => x !== 'LSPV')) ring(p);
    expect(step()).toBe('entrance');
    // 環状カテーテルは LSPV にあるので LSPV だけチェックが付く。残りの PV に 1 本ずつ入れる
    const entrance = PVI_TUTORIAL.steps[i];
    expect(entrance.items!(ctx()).filter((x) => x.done).map((x) => x.label)).toEqual(['LSPV']);
    for (const name of PV_NAMES.filter((x) => x !== 'LSPV')) {
      const q = e.model.anatomy.la.pvs.find((p) => p.name === name)!, g = q.frame;
      e.setPlacement('circ', { kind: 'free', point: { x: q.ostium.x + g.axis.x * 6, y: q.ostium.y + g.axis.y * 6, z: q.ostium.z + g.axis.z * 6 }, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
      expect(step()).toBe(name === 'RIPV' ? 'exit-block' : 'entrance');
    }
    goals.record({ kind: 'protocol', time: e.time, site: 'CIRC', status: 'noninducible', results: [], lesionCount: e.lesions.length, ...protocolStartState(e, 'CIRC') });
    expect(step()).toBe('cure');
    ui.cureOk = verifyCure(e, afScenario).every((c) => c.ok);
    expect(step()).toBe('done');
  }, 300_000);
});
