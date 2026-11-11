import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { avnrtScenario } from '../arrhythmia/avnrt';
import { wpwScenario } from '../arrhythmia/wpw';
import { aflCtiScenario } from '../arrhythmia/aflCti';
import { afScenario } from '../arrhythmia/af';
import { verifyCure } from '../arrhythmia/common';
import { PV_NAMES, REGION_ID, type PvName } from '../geometry/regions';
import type { ArrhythmiaScenario, Vec3 } from '../types';
import type { AnatomyDimensionSet } from '../types';

/**
 * Phase 5 の回帰：4 症例を、簡易通電ではなく新しい病変モデル（RF・クライオ・PFA）で根治できる。
 * 通電の時計はテストを速くするため大きな倍速で回す（病変の大きさは経過時間だけで決まるので結果は同じ）。
 */
const make = (dims: AnatomyDimensionSet, sc: ArrhythmiaScenario) => { const e = new SimulationEngine(loadParametricSync(dims)); sc.setupSubstrate(e); return e; };
const finish = (e: SimulationEngine) => { e.ablation.speed = 250; while (e.ablation.active) e.ablation.step(e.sampleMs); };
/** ABL の先端を point に接触（壁から 1 mm）させて RF 通電 */
const rf = (e: SimulationEngine, point: Vec3, powerW = 30, durationS = 30) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW, durationS };
  const err = e.ablation.start('rf');
  expect(err).toBeNull();
  finish(e);
};
const FAST = { s1Beats: 4, s2StartMs: 360, observeMs: 1200 };

describe('回帰：RF で 4 症例', () => {
  it('AVNRT：遅伝導路に RF 1 回で根治', () => {
    const e = make('normal', avnrtScenario);
    rf(e, e.model.anatomy.anchors.slowPathway.point);
    const checks = verifyCure(e, avnrtScenario, FAST);
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
  }, 120_000);

  it('WPW：副伝導路の部位に RF で根治', () => {
    const e = make('normal', wpwScenario);
    const ap = e.conduction.ap!.vertices;
    rf(e, e.query.position(ap[Math.floor(ap.length / 2)]));
    e.tick(2500);
    const checks = verifyCure(e, wpwScenario, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 });
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
  }, 120_000);

  it('通常型 AFL：CTI に 40 W の点状通電を並べた線で両方向性ブロック・非誘発', () => {
    const e = make('aflRemodeled', aflCtiScenario);
    const a = e.model.anatomy.anchors, p = a.ctiTv.point, q = a.ctiIvc.point;
    const cti: number[] = [];
    e.mesh.regionOfVertex.forEach((r, v) => { if (r === REGION_ID.cti) cti.push(v); });
    const n = 8;
    for (let i = 0; i <= n + 2; i++) {
      const t = i / n;
      const chord = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
      rf(e, (t <= 1 ? e.query.closestPoint(chord, cti) : e.query.closestPoint(chord)).point, 40, 30);
    }
    const checks = verifyCure(e, aflCtiScenario, { observeMs: 1000 });
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
  }, 300_000);
});

describe('回帰：AF の PVI を 3 エネルギーで', () => {
  const ringPoints = (e: SimulationEngine, pv: PvName, stepDeg = 30): Vec3[] => {
    const info = e.model.anatomy.la.pvs.find((x) => x.name === pv)!, f = info.frame, R = info.radius + 3;
    const out: Vec3[] = [];
    for (let deg = 0; deg < 360; deg += stepDeg) {
      const a = (deg * Math.PI) / 180, c = Math.cos(a) * R, s = Math.sin(a) * R;
      out.push(e.query.closestPoint({
        x: info.ostium.x + f.u.x * c + f.v.x * s - f.axis.x * 2,
        y: info.ostium.y + f.u.y * c + f.v.y * s - f.axis.y * 2,
        z: info.ostium.z + f.u.z * c + f.v.z * s - f.axis.z * 2,
      }).point);
    }
    return out;
  };

  it('RF：PV 口の前庭部を一周する点状通電（30 W・20 秒）で 4 本隔離・非誘発', () => {
    const e = make('afRemodeled', afScenario);
    for (const pv of PV_NAMES) for (const p of ringPoints(e, pv)) rf(e, p, 30, 20);
    const checks = verifyCure(e, afScenario);
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
  }, 300_000);

  it('RF：一周に隙間（60° 分を焼かない）があると、その PV は隔離されない', () => {
    const e = make('afRemodeled', afScenario);
    ringPoints(e, 'LSPV').forEach((p, i) => { if (i !== 3 && i !== 4) rf(e, p, 30, 20); });
    expect(afScenario.structuralChecks(e).find((c) => c.id === 'entrance-LSPV')!.ok).toBe(false);
  }, 120_000);

  it('クライオバルーン：4 本とも閉塞良好で 180 秒 → 構造的な隔離が完成', () => {
    const e = make('afRemodeled', afScenario);
    for (const pv of PV_NAMES) {
      e.ablation.cryo = { ...e.ablation.cryo, pv, push01: 1, misalignDeg: 0 };
      e.ablation.start('cryo'); finish(e);
      expect(e.ablation.last!.timeToIsolationS, pv).not.toBeNull();
    }
    const checks = afScenario.structuralChecks(e);
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
  }, 300_000);

  it('PFA：4 本に 2 回ずつで構造的な隔離が完成（1 回ずつでは未完成）', () => {
    const e = make('afRemodeled', afScenario);
    const all = (shape: 'basket' | 'flower') => { for (const pv of PV_NAMES) { e.ablation.pfa = { pv, shape }; e.ablation.applyPfa(); } };
    all('basket');
    expect(afScenario.structuralChecks(e).some((c) => !c.ok)).toBe(true);
    all('flower');
    const checks = afScenario.structuralChecks(e);
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
  }, 300_000);
});
