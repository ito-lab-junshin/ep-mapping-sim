import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario } from '../arrhythmia/af';
import { verifyCure } from '../arrhythmia/common';
import { GeometryAcquisition } from '../geometry/acquisition';
import { GoalTracker } from './GoalTracker';
import { PVI_TUTORIAL, TUTORIAL_LA_COVERAGE_PCT, advanceTutorial, type TutorialContext } from './tutorials';
import { protocolEvent, protocolStartState } from './events';
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
    const ui: TutorialContext['ui'] = { arrhythmia: 'avnrt', geometryMode: 'preset', laCoveragePct: 0, coverageTargetPct: 95, cureOk: false, confirmed: new Set() };
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

// ───────────── Phase 7：AFL（反時計回り・時計回り）・AVNRT・WPW ─────────────
import { AFL_CCW_TUTORIAL, AFL_CW_TUTORIAL, AVNRT_TUTORIAL, WPW_TUTORIAL, type Tutorial } from './tutorials';
import { aflCtiScenario, aflCtiCwScenario } from '../arrhythmia/aflCti';
import { avnrtScenario } from '../arrhythmia/avnrt';
import { wpwScenario } from '../arrhythmia/wpw';
import { tryInduce } from '../arrhythmia/common';
import { flutterDirection } from './flutter';
import { runProtocol, defaultProtocol } from '../pacing/ProtocolSession';
import { REGION_ID } from '../geometry/regions';
import type { ArrhythmiaScenario, LearningEvent, MapPoint } from '../types';
import type { PacingSite } from '../sim/SimulationEngine';

/** チュートリアルをスクリプトで進めるための道具 */
function runner(t: Tutorial, e: SimulationEngine, scenario: ArrhythmiaScenario) {
  const goals = new GoalTracker(scenario.goals);
  const confirmed = new Set<string>();
  const ui: TutorialContext['ui'] = { arrhythmia: 'af', geometryMode: 'preset', laCoveragePct: 0, coverageTargetPct: 70, cureOk: false, confirmed };
  let points: MapPoint[] = [];
  let i = 0;
  const ctx = (): TutorialContext => ({ engine: e, goals, points, ui });
  return {
    goals, ui, confirmed,
    setPoints: (p: MapPoint[]) => { points = p; },
    step: () => { goals.update(e, points); i = advanceTutorial(t, i, ctx()); return t.steps[i]?.id ?? 'done'; },
    skip: () => { expect(t.steps[i].optional).toBe(true); i++; },
    protocol: (site: PacingSite, status: 'induced' | 'noninducible') => goals.record({
      kind: 'protocol', time: e.time, site, status, results: [], lesionCount: e.lesions.length, contact: true, circPv: null, circPvIsolated: false,
    } as LearningEvent),
  };
}
const rfAt = (e: SimulationEngine, point: Vec3, powerW = 30, durationS = 30) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW, durationS };
  expect(e.ablation.start('rf')).toBeNull();
  e.ablation.speed = 250;
  while (e.ablation.active) e.ablation.step(e.sampleMs);
};

describe('チュートリアル：通常型 AFL（反時計回り・時計回り）', () => {
  for (const [t, scenario, dir] of [[AFL_CCW_TUTORIAL, aflCtiScenario, 'ccw'], [AFL_CW_TUTORIAL, aflCtiCwScenario, 'cw']] as const) {
    it(`${t.title}：誘発 → 旋回方向（${dir}）→ CTI の線 → 両方向性ブロック → 根治`, () => {
      const base = new SimulationEngine(loadParametricSync('aflRemodeled'));
      scenario.setupSubstrate(base);
      const e = tryInduce(base, scenario, { observeMs: 1000 }).engine;
      const r = runner(t, e, scenario);
      expect(r.step()).toBe('scenario');
      r.ui.arrhythmia = scenario.id;
      // 誘発済みのエンジン（頻拍中）なので「誘発する」はすぐ完了
      expect(r.step()).toBe('direction');
      expect(flutterDirection(e)).toBe(dir);
      r.goals.record({ kind: 'answer', time: e.time, question: 'afl-direction', value: dir, correct: flutterDirection(e) === dir });
      expect(r.step()).toBe('lat-map');
      r.skip();
      expect(r.step()).toBe('cti-line');
      const a = e.model.anatomy.anchors, p = a.ctiTv.point, q = a.ctiIvc.point;
      const cti: number[] = [];
      e.mesh.regionOfVertex.forEach((x, v) => { if (x === REGION_ID.cti) cti.push(v); });
      const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / 4);
      for (let k = 0; k <= n + 2; k++) {
        const s = k / n, chord = { x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s, z: p.z + (q.z - p.z) * s };
        rfAt(e, (s <= 1 ? e.query.closestPoint(chord, cti) : e.query.closestPoint(chord)).point, 40, 45);
      }
      expect(r.step()).toBe('bidirectional');
      r.protocol('CS_OS', 'noninducible');
      r.protocol('LOW_LATERAL_RA', 'noninducible');
      expect(r.step()).toBe('cure');
      r.ui.cureOk = verifyCure(e, scenario, { observeMs: 1000 }).every((c) => c.ok);
      expect(r.step()).toBe('done');
    }, 600_000);
  }
});

describe('チュートリアル：AVNRT', () => {
  it('His → AH ジャンプ（実際の期外刺激）→ 頻拍 → 遅伝導路の通電（接合部調律）→ 非誘発 → 根治', () => {
    const e = new SimulationEngine(loadParametricSync('normal'));
    avnrtScenario.setupSubstrate(e);
    const r = runner(AVNRT_TUTORIAL, e, avnrtScenario);
    expect(r.step()).toBe('scenario');
    r.ui.arrhythmia = 'avnrt';
    expect(r.step()).toBe('ah-jump');
    const n0 = e.lesions.length, st = protocolStartState(e, 'HRA');
    const session = runProtocol(e, { ...defaultProtocol('extrastimulus', 'HRA'), s1Beats: 4, s2StartMs: 360, observeMs: 1200 });
    r.goals.record(protocolEvent(e, session, n0, st));
    expect(session.status).toBe('induced');
    expect(r.step()).toBe('junctional');
    e.setPlacement('abl', { kind: 'free', point: e.model.anatomy.anchors.slowPathway.point, heightMm: 1, rotationDeg: 0 });
    e.ablation.speed = 5;
    expect(e.ablation.start('rf')).toBeNull();
    e.tick(1500);
    expect(r.step()).toBe('noninducible');
    e.ablation.speed = 250;
    while (e.ablation.active) e.ablation.step(e.sampleMs);
    r.protocol('HRA', 'noninducible');
    expect(r.step()).toBe('cure');
    r.ui.cureOk = verifyCure(e, avnrtScenario, { s1Beats: 4, s2StartMs: 360, observeMs: 1200 }).every((c) => c.ok);
    expect(r.step()).toBe('done');
  }, 300_000);
});

describe('チュートリアル：WPW', () => {
  it('デルタ波を見る（確認した）→ RV 刺激 → 最早期 → 通電 → デルタ波の消失・非誘発 → 根治', () => {
    const e = new SimulationEngine(loadParametricSync('normal'));
    wpwScenario.setupSubstrate(e);
    const r = runner(WPW_TUTORIAL, e, wpwScenario);
    expect(r.step()).toBe('scenario');
    r.ui.arrhythmia = 'wpw';
    expect(r.step()).toBe('delta');
    r.confirmed.add('delta');
    expect(r.step()).toBe('rv-pacing');
    r.protocol('RV', 'noninducible');
    expect(r.step()).toBe('earliest');
    const ap = e.conduction.ap!.vertices;
    const pt = (v: number, lat: number, id: number): MapPoint => ({ id, position: e.query.position(v), vertex: v, latMs: lat, voltageMv: 1, catheterId: 'abl', signal: 'bipolar', referenceTime: 0 });
    r.setPoints([pt(ap[0], 0, 1), ...[100, 200, 300, 400].map((v, k) => pt(v, 40 + k * 5, k + 2))]);
    expect(r.step()).toBe('ablate');
    rfAt(e, e.query.position(ap[Math.floor(ap.length / 2)]));
    expect(r.step()).toBe('delta-gone');
    e.tick(2500);
    r.protocol('CS_DIST', 'noninducible');
    expect(r.step()).toBe('cure');
    r.ui.cureOk = verifyCure(e, wpwScenario, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 }).every((c) => c.ok);
    expect(r.step()).toBe('done');
  }, 300_000);
});
