import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario } from '../arrhythmia/af';
import { verifyCure } from '../arrhythmia/common';
import { GeometryAcquisition } from '../geometry/acquisition';
import { GoalTracker } from './GoalTracker';
import { PVI_TUTORIAL, TUTORIALS, TUTORIAL_LA_COVERAGE_PCT, advanceTutorial, type TutorialContext } from './tutorials';
import { SCENARIOS } from '../arrhythmia';
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
    const ui: TutorialContext['ui'] = { arrhythmia: 'avnrt', geometryMode: 'preset', energy: 'rf', coveragePct: { LA: 0, RA: 0 }, coverageTargetPct: 95, cureOk: false, confirmed: new Set() };
    const ctx = (): TutorialContext => ({ engine: e, goals, points: [], ui: { ...ui, coveragePct: { LA: acq.coveragePct(la.vertexStart, la.vertexCount), RA: 0 } } });
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
    // 症例が選ばれていても「この症例で始める」を押すまで進まない（QA の所見 12）
    expect(step()).toBe('scenario');
    (ui.confirmed as Set<string>).add('scenario');
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
    // 再伝導の確認：20 分の待機
    expect(step()).toBe('reconnection');
    e.ablation.wait();
    goals.record({ kind: 'wait', time: e.time, minutes: 20, lesionCount: e.lesions.length });
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
  const ui: TutorialContext['ui'] = { arrhythmia: 'af', geometryMode: 'preset', energy: 'rf', coveragePct: { LA: 0, RA: 0 }, coverageTargetPct: 70, cureOk: false, confirmed };
  let points: MapPoint[] = [];
  let i = 0;
  const ctx = (): TutorialContext => ({ engine: e, goals, points, ui });
  return {
    goals, ui, confirmed,
    setPoints: (p: MapPoint[]) => { points = p; },
    step: () => { goals.update(e, points); i = advanceTutorial(t, i, ctx()); return t.steps[i]?.id ?? 'done'; },
    skip: () => { expect(t.steps[i].optional).toBe(true); i++; },
    /** 再伝導の確認：アデノシン負荷（出来事として記録する） */
    waitReconnection: () => {
      e.ablation.giveAdenosine();
      goals.record({ kind: 'adenosine', time: e.time, lesionCount: e.lesions.length });
    },
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
      r.confirmed.add('scenario');
      // 誘発済みのエンジン（頻拍中）なので「誘発する」はすぐ完了
      expect(r.step()).toBe('direction');
      expect(flutterDirection(e)).toBe(dir);
      r.goals.record({ kind: 'answer', time: e.time, question: 'afl-direction', value: dir, correct: flutterDirection(e) === dir });
      expect(r.step()).toBe('build-ra');
      if (dir === 'ccw') {
        // （任意）収集モードで RA の形を作る：RA の壁をなぞって目安の被覆率に届くと進む
        r.ui.geometryMode = 'acquire';
        expect(r.step()).toBe('build-ra');
        const acq = new GeometryAcquisition(e.mesh), ra = e.mesh.parts![1];
        for (let v = ra.vertexStart; v < ra.vertexStart + ra.vertexCount; v += 25) {
          e.setPlacement('abl', { kind: 'free', point: e.query.position(v), heightMm: 1, rotationDeg: 0 });
          acq.collect([e.catheter('abl')!]);
        }
        r.ui.coveragePct = { LA: acq.coveragePct(e.mesh.parts![0].vertexStart, e.mesh.parts![0].vertexCount), RA: acq.coveragePct(ra.vertexStart, ra.vertexCount) };
        expect(r.ui.coveragePct.LA).toBeLessThan(5);
        expect(r.step()).toBe('lat-map');
      } else {
        r.skip();
        expect(r.step()).toBe('lat-map');
      }
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
      expect(r.step()).toBe('reconnection');
      r.waitReconnection();
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
    r.confirmed.add('scenario');
    expect(r.step()).toBe('build-ra');
    {
      // （任意）収集モードで RA の形を作る：RA をなぞって目安に届くと進む
      r.ui.geometryMode = 'acquire';
      const acq = new GeometryAcquisition(e.mesh), ra = e.mesh.parts![1];
      for (let v = ra.vertexStart; v < ra.vertexStart + ra.vertexCount; v += 25) {
        e.setPlacement('abl', { kind: 'free', point: e.query.position(v), heightMm: 1, rotationDeg: 0 });
        acq.collect([e.catheter('abl')!]);
      }
      r.ui.coveragePct = { LA: 0, RA: acq.coveragePct(ra.vertexStart, ra.vertexCount) };
    }
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
    expect(r.step()).toBe('reconnection');
    r.waitReconnection();
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
    r.confirmed.add('scenario');
    expect(r.step()).toBe('delta');
    r.confirmed.add('delta');
    expect(r.step()).toBe('rv-pacing');
    r.protocol('RV', 'noninducible');
    expect(r.step()).toBe('build-la');
    r.skip(); // （任意）LA の収集はとばす
    expect(r.step()).toBe('earliest');
    const ap = e.conduction.ap!.vertices;
    const pt = (v: number, lat: number, id: number): MapPoint => ({ id, position: e.query.position(v), vertex: v, latMs: lat, voltageMv: 1, catheterId: 'abl', signal: 'bipolar', referenceTime: 0 });
    r.setPoints([pt(ap[0], 0, 1), ...[100, 200, 300, 400].map((v, k) => pt(v, 40 + k * 5, k + 2))]);
    expect(r.step()).toBe('ablate');
    rfAt(e, e.query.position(ap[Math.floor(ap.length / 2)]));
    expect(r.step()).toBe('delta-gone');
    e.tick(2500);
    r.protocol('CS_DIST', 'noninducible');
    expect(r.step()).toBe('reconnection');
    r.waitReconnection();
    expect(r.step()).toBe('cure');
    r.ui.cureOk = verifyCure(e, wpwScenario, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 }).every((c) => c.ok);
    expect(r.step()).toBe('done');
  }, 300_000);
});

describe('チュートリアルの手順 1（症例を選ぶ）', () => {
  it.each(TUTORIALS.map((t) => [t.title, t] as const))('%s：症例が選ばれていても「この症例で始める」を押すまで進まず、押すと進む（QA の所見 12）', (_, t) => {
    const sc = SCENARIOS[t.scenario];
    const e = new SimulationEngine(loadParametricSync(sc.anatomy));
    sc.setupSubstrate(e, t.caseOptions);
    const confirmed = new Set<string>();
    const ctx: TutorialContext = {
      engine: e, goals: new GoalTracker(sc.goals), points: [],
      ui: { arrhythmia: t.scenario, geometryMode: 'preset', energy: 'rf', coveragePct: { LA: 0, RA: 0 }, coverageTargetPct: 70, cureOk: false, confirmed },
    };
    const first = t.steps[0];
    expect(first.id).toBe('scenario');
    expect(first.ready!(ctx)).toBe(true);
    expect(advanceTutorial(t, 0, ctx)).toBe(0);
    confirmed.add('scenario');
    expect(advanceTutorial(t, 0, ctx)).toBeGreaterThan(0);
  });
});

// ───────────── Phase 6 の拡張：クライオバルーン・PFA の PVI ─────────────
import { CRYO_TUTORIAL, PFA_TUTORIAL } from './tutorials';

describe.each([['cryo', CRYO_TUTORIAL], ['pfa', PFA_TUTORIAL]] as const)('チュートリアル：PVI（%s）', (energy, t) => {
  it('症例 → エネルギー → PV 電位 → 4 本の隔離（単発のデバイス）→ entrance・exit block → 再伝導の確認 → 根治', () => {
    const e = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(e);
    const r = runner(t, e, afScenario);
    const circIn = (name: PvName) => {
      const q = e.model.anatomy.la.pvs.find((p) => p.name === name)!, g = q.frame;
      e.setPlacement('circ', { kind: 'free', point: { x: q.ostium.x + g.axis.x * 6, y: q.ostium.y + g.axis.y * 6, z: q.ostium.z + g.axis.z * 6 }, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
    };
    /** 1 本の PV を隔離する（クライオは閉塞度 1 で 180 秒、PFA は 2 回） */
    const isolate = (pv: PvName, occlusion = 1) => {
      if (energy === 'cryo') {
        e.ablation.cryo = { ...e.ablation.cryo, pv, push01: occlusion, misalignDeg: 0 };
        expect(e.ablation.start('cryo')).toBeNull();
        e.ablation.speed = 250;
        while (e.ablation.active) e.ablation.step(e.sampleMs);
      } else {
        e.ablation.pfa = { pv, shape: 'basket' };
        e.ablation.applyPfa();
        expect(r.step()).toBe(pv === 'LSPV' ? 'pfa-lspv' : 'pfa-all'); // 1 回では隔離にならない
        e.ablation.applyPfa();
      }
    };
    expect(r.step()).toBe('scenario');
    r.confirmed.add('scenario');
    expect(r.step()).toBe('energy');
    r.ui.energy = 'rf';
    expect(r.step()).toBe('energy');
    r.ui.energy = energy;
    // 形の収集の手順はない（既定の形で始める）
    expect(r.step()).toBe('pv-potential');
    circIn('LSPV');
    e.tick(1500);
    expect(r.step()).toBe(`${energy}-lspv`);
    if (energy === 'cryo') {
      // 閉塞が不十分（0.7）だと隔離にならず、手順は進まない
      isolate('LSPV', 0.7);
      expect(r.step()).toBe('cryo-lspv');
    }
    isolate('LSPV');
    expect(r.step()).toBe(`${energy}-all`);
    for (const pv of PV_NAMES.filter((x) => x !== 'LSPV')) isolate(pv);
    expect(r.step()).toBe('entrance');
    for (const name of PV_NAMES.filter((x) => x !== 'LSPV')) { circIn(name); r.step(); }
    expect(r.step()).toBe('exit-block');
    r.goals.record({ kind: 'protocol', time: e.time, site: 'CIRC', status: 'noninducible', results: [], lesionCount: e.lesions.length, ...protocolStartState(e, 'CIRC') });
    expect(r.step()).toBe('reconnection');
    r.waitReconnection();
    expect(r.step()).toBe('cure');
    r.ui.cureOk = verifyCure(e, afScenario).every((c) => c.ok);
    expect(r.step()).toBe('done');
  }, 300_000);
});

// ───────────── AF の型ごと：SVC トリガー・持続性 AF ─────────────
import { SVC_TUTORIAL, PERSISTENT_TUTORIAL } from './tutorials';
import { svcRingPoints, svcVertices } from '../arrhythmia/svc';
import { channelCutPoints, roofSubstrate } from '../arrhythmia/persistent';
import type { AfType } from '../params';

describe.each([['pvSvc', SVC_TUTORIAL], ['persistent', PERSISTENT_TUTORIAL]] as const)('チュートリアル：AF（%s）', (type, t) => {
  it('症例（AF の型）→ PVI → AF が続く → 非 PV の基質（SVC／天蓋）→ 通電 → AF の停止 → 再伝導 → 根治', () => {
    const e = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(e, { afType: type as AfType });
    const r = runner(t, e, afScenario);
    expect(r.step()).toBe('scenario');
    r.confirmed.add('scenario');
    expect(r.step()).toBe('pvi');
    // PVI はクライオバルーン（閉塞度 1）で 4 本
    for (const pv of PV_NAMES) {
      e.ablation.cryo = { ...e.ablation.cryo, pv, push01: 1, misalignDeg: 0 };
      expect(e.ablation.start('cryo')).toBeNull();
      e.ablation.speed = 250;
      while (e.ablation.active) e.ablation.step(e.sampleMs);
    }
    expect(r.step()).toBe('af-persists');
    e.tick(8000);
    expect(e.rhythm.state, 'PVI だけでは止まらない').toBe('tachycardia');
    r.confirmed.add('af-persists');
    if (type === 'pvSvc') {
      expect(r.step()).toBe('svc-potential');
      const o = e.model.anatomy.ra.svc, len = e.model.dimensions.vein.svcLength!;
      const inSvc = { x: o.center.x - o.axis.x * len * 0.4, y: o.center.y - o.axis.y * len * 0.4, z: o.center.z - o.axis.z * len * 0.4 };
      e.setPlacement('circ', { kind: 'free', point: e.query.closestPoint(inSvc, svcVertices(e)).point, heightMm: 1, rotationDeg: 0, diameterMm: 20 });
      e.tick(3000);
      expect(r.step()).toBe('svc-isolation');
      for (const p of svcRingPoints(e)) rfAt(e, p, 30, 30);
    } else {
      expect(r.step()).toBe('lva-map');
      // 天蓋の低電位の点（channel の頂点、0.3 mV）を 5 点
      const ch = roofSubstrate(e).channel.filter((_, i) => i % 10 === 0).slice(0, 5);
      r.setPoints(ch.map((v, i) => ({ id: i, position: e.query.position(v), vertex: v, latMs: 0, voltageMv: 0.3, catheterId: 'abl', signal: 'bipolar', referenceTime: 0 } as MapPoint)));
      const cut = channelCutPoints(e);
      expect(r.step()).toBe('roof-driver');
      for (const p of cut) rfAt(e, p, 30, 30);
    }
    // 通電の直後は「AF が止まった」の手順（頻拍の判定が解けるのを待つ）。止まれば再伝導の確認へ進む
    expect(r.step()).toBe('af-stopped');
    e.tick(15000);
    expect(e.rhythm.state).not.toBe('tachycardia');
    expect(r.step()).toBe('reconnection');
    r.waitReconnection();
    expect(r.step()).toBe('cure');
    r.ui.cureOk = verifyCure(e, afScenario).every((c) => c.ok);
    expect(r.step()).toBe('done');
  }, 600_000);
});
