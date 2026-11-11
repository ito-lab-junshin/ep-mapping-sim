import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario } from '../arrhythmia/af';
import { aflCtiScenario } from '../arrhythmia/aflCti';
import { avnrtScenario } from '../arrhythmia/avnrt';
import { wpwScenario } from '../arrhythmia/wpw';
import { tryInduce } from '../arrhythmia/common';
import { GoalTracker } from './GoalTracker';
import { flutterDirection } from './flutter';
import { protocolEvent, protocolStartState } from './events';
import { runProtocol, defaultProtocol } from '../pacing/ProtocolSession';
import { PV_NAMES, REGION_ID } from '../geometry/regions';
import type { ArrhythmiaScenario, AnatomyDimensionSet, LearningEvent, MapPoint, Vec3 } from '../types';
import type { PacingSite } from '../sim/SimulationEngine';

const make = (dims: AnatomyDimensionSet, sc: ArrhythmiaScenario) => { const e = new SimulationEngine(loadParametricSync(dims)); sc.setupSubstrate(e); return e; };
const rf = (e: SimulationEngine, point: Vec3, powerW = 30, durationS = 30) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW, durationS };
  expect(e.ablation.start('rf')).toBeNull();
  e.ablation.speed = 250;
  while (e.ablation.active) e.ablation.step(e.sampleMs);
};
/** 刺激プロトコルの出来事（結果は与えたもの） */
const protocol = (e: SimulationEngine, site: PacingSite, status: 'induced' | 'noninducible', extra: Partial<Extract<LearningEvent, { kind: 'protocol' }>> = {}): LearningEvent => ({
  kind: 'protocol', time: e.time, site, status, results: [], lesionCount: e.lesions.length, contact: true, circPv: null, circPvIsolated: false, ...extra,
});
const ids = (t: GoalTracker) => [...t.achievedAt.keys()];

describe('学習ゴール：AF（PVI）', () => {
  it('環状カテーテルで PV 電位 → 4 本の隔離 → 環状カテーテルからの刺激で exit block の順に達成する', () => {
    const e = make('afRemodeled', afScenario);
    const t = new GoalTracker(afScenario.goals);
    // 隔離前に環状から刺激しても exit block にはならない
    t.record(protocol(e, 'CIRC', 'noninducible', { circPv: 'LSPV' }));
    e.tick(1500);
    t.update(e);
    expect(ids(t)).toEqual([]);
    // 環状カテーテルを LSPV の中に置く
    const pv = e.model.anatomy.la.pvs.find((p) => p.name === 'LSPV')!, f = pv.frame;
    e.setPlacement('circ', { kind: 'free', point: { x: pv.ostium.x + f.axis.x * 6, y: pv.ostium.y + f.axis.y * 6, z: pv.ostium.z + f.axis.z * 6 }, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
    expect(protocolStartState(e, 'CIRC')).toEqual({ contact: true, circPv: 'LSPV', circPvIsolated: false });
    e.tick(1500);
    t.update(e);
    expect(ids(t)).toEqual(['pv-potential']);
    // 3 本だけ隔離：まだ未達成（途中経過 3/4）
    for (const name of PV_NAMES.slice(0, 3)) { e.ablation.pfa = { pv: name, shape: 'flower' }; e.ablation.applyPfa(); e.ablation.applyPfa(); }
    t.update(e);
    expect(t.isAchieved('isolation')).toBe(false);
    expect(afScenario.goals.find((g) => g.id === 'isolation')!.progress!(t.context(e, []))).toBe('3/4 本');
    e.ablation.pfa = { pv: PV_NAMES[3], shape: 'flower' }; e.ablation.applyPfa(); e.ablation.applyPfa();
    t.update(e);
    expect(t.isAchieved('isolation')).toBe(true);
    expect(t.isAchieved('exit-block')).toBe(false);
    // entrance block：環状カテーテルが入っている LSPV だけ確認済み。残りの PV に 1 本ずつ入れる
    expect(t.itemStatus('entrance', t.context(e, [])).filter((x) => x.done).map((x) => x.id)).toEqual(['LSPV']);
    expect(t.isAchieved('entrance')).toBe(false);
    for (const name of PV_NAMES.filter((x) => x !== 'LSPV')) {
      const q = e.model.anatomy.la.pvs.find((p) => p.name === name)!, g = q.frame;
      e.setPlacement('circ', { kind: 'free', point: { x: q.ostium.x + g.axis.x * 6, y: q.ostium.y + g.axis.y * 6, z: q.ostium.z + g.axis.z * 6 }, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
      t.update(e);
    }
    expect(t.isAchieved('entrance')).toBe(true);
    // 環状カテーテルを LSPV に戻す
    e.setPlacement('circ', { kind: 'free', point: { x: pv.ostium.x + f.axis.x * 6, y: pv.ostium.y + f.axis.y * 6, z: pv.ostium.z + f.axis.z * 6 }, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
    // 隔離後に環状カテーテル（LSPV、接触あり）から刺激
    expect(protocolStartState(e, 'CIRC')).toEqual({ contact: true, circPv: 'LSPV', circPvIsolated: true });
    t.record(protocol(e, 'CIRC', 'noninducible', protocolStartState(e, 'CIRC')));
    t.update(e);
    expect(t.allAchieved).toBe(true);
  }, 120_000);
});

describe('学習ゴール：通常型 AFL', () => {
  it('ハローの興奮順序から旋回方向を読む（CS 口から：反時計回り、低位外側 RA から：時計回り）。正しく答えるとゴール達成', () => {
    const ccw = tryInduce(make('aflRemodeled', aflCtiScenario), aflCtiScenario, { observeMs: 1000 }).engine;
    expect(flutterDirection(ccw)).toBe('ccw');
    const cw = tryInduce(make('aflRemodeled', aflCtiScenario), aflCtiScenario, { site: 'LOW_LATERAL_RA', observeMs: 1000 }).engine;
    expect(flutterDirection(cw)).toBe('cw');
    expect(flutterDirection(make('aflRemodeled', aflCtiScenario))).toBeNull(); // 洞調律
    const t = new GoalTracker(aflCtiScenario.goals);
    t.record({ kind: 'answer', time: 0, question: 'afl-direction', value: 'cw', correct: false });
    t.update(ccw);
    expect(t.isAchieved('direction')).toBe(false);
    t.record({ kind: 'answer', time: 0, question: 'afl-direction', value: 'ccw', correct: true });
    t.update(ccw);
    expect(t.isAchieved('direction')).toBe(true);
  }, 300_000);

  it('CTI の線の完成後に、中隔側と側壁側の両方から刺激すると両方向性ブロックの確認が達成', () => {
    const e = make('aflRemodeled', aflCtiScenario);
    const t = new GoalTracker(aflCtiScenario.goals);
    t.record(protocol(e, 'CS_OS', 'noninducible'));
    const a = e.model.anatomy.anchors, p = a.ctiTv.point, q = a.ctiIvc.point;
    const cti: number[] = [];
    e.mesh.regionOfVertex.forEach((r, v) => { if (r === REGION_ID.cti) cti.push(v); });
    const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / 4);
    for (let i = 0; i <= n + 2; i++) {
      const s = i / n, chord = { x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s, z: p.z + (q.z - p.z) * s };
      rf(e, (s <= 1 ? e.query.closestPoint(chord, cti) : e.query.closestPoint(chord)).point, 40, 45);
    }
    t.update(e);
    expect(t.isAchieved('cti-line')).toBe(true);
    expect(t.isAchieved('bidirectional')).toBe(false); // 線の前の刺激は数えない
    t.record(protocol(e, 'CS_OS', 'noninducible'));
    t.update(e);
    expect(t.isAchieved('bidirectional')).toBe(false); // 側壁側からの刺激がまだ
    t.record(protocol(e, 'HALO_DIST', 'noninducible'));
    t.update(e);
    expect(t.isAchieved('bidirectional')).toBe(true);
  }, 120_000);
});

describe('学習ゴール：AVNRT', () => {
  it('His の記録 → 実際の期外刺激で AH jump → 遅伝導路で接合部調律 → 非誘発', () => {
    const e = make('normal', avnrtScenario);
    const t = new GoalTracker(avnrtScenario.goals);
    t.update(e);
    expect(ids(t)).toEqual(['his']);
    // 期外刺激（実際に走らせる）
    const n0 = e.lesions.length, st = protocolStartState(e, 'HRA');
    const session = runProtocol(e, { ...defaultProtocol('extrastimulus', 'HRA'), s1Beats: 4, s2StartMs: 360, observeMs: 1200 });
    t.record(protocolEvent(e, session, n0, st));
    t.update(e);
    expect(t.isAchieved('ah-jump')).toBe(true);
    // 遅伝導路で RF（接合部調律）
    e.setPlacement('abl', { kind: 'free', point: e.model.anatomy.anchors.slowPathway.point, heightMm: 1, rotationDeg: 0 });
    e.ablation.speed = 5;
    expect(e.ablation.start('rf')).toBeNull();
    e.tick(1500);
    t.update(e);
    expect(t.isAchieved('junctional')).toBe(true);
    e.ablation.speed = 250;
    while (e.ablation.active) e.ablation.step(e.sampleMs);
    t.update(e);
    expect(t.isAchieved('noninducible')).toBe(false);
    t.record(protocol(e, 'HRA', 'noninducible'));
    t.update(e);
    expect(t.allAchieved).toBe(true);
  }, 120_000);
});

describe('学習ゴール：WPW', () => {
  it('最早期の点が副伝導路の近く → 副伝導路の通電 → 非誘発。最早期が離れていれば未達成', () => {
    const e = make('normal', wpwScenario);
    const t = new GoalTracker(wpwScenario.goals);
    const ap = e.conduction.ap!.vertices;
    const pt = (v: number, lat: number, id: number): MapPoint => ({ id, position: e.query.position(v), vertex: v, latMs: lat, voltageMv: 1, catheterId: 'abl', signal: 'bipolar', referenceTime: 0 });
    const far = e.model.anatomy.anchors.sinusNode.vertex;
    const others = [100, 200, 300, 400].map((v, i) => pt(v, 40 + i * 5, i + 2));
    t.update(e, [pt(far, 0, 1), ...others]);
    expect(t.isAchieved('earliest')).toBe(false);
    t.update(e, [pt(ap[0], 0, 1), ...others]);
    expect(t.isAchieved('earliest')).toBe(true);
    rf(e, e.query.position(ap[Math.floor(ap.length / 2)]));
    t.update(e);
    expect(t.isAchieved('ap-ablation')).toBe(true);
    t.record(protocol(e, 'CS_DIST', 'noninducible'));
    t.update(e);
    expect(t.allAchieved).toBe(true);
  }, 120_000);
});
