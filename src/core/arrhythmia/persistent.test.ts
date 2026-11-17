import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario } from './af';
import { channelCutPoints, roofClearanceMm, roofDriverActive, roofSubstrate, distanceFromRoofCenter } from './persistent';
import { PV_NAMES, PV_OSTIUM, REGION_ID, REGIONS } from '../geometry/regions';
import { ablateAt } from '../ablation/simpleAblation';
import { isolatedPvs } from './pv';
import { GoalTracker } from '../learning/GoalTracker';
import { AF_SUBSTRATE } from '../params';
import type { MapPoint, Vec3 } from '../types';

/** AF-3：持続性 AF（天蓋の低電位領域に固定した旋回と細動様伝導）。docs/DESIGN.md §5.1 */
const make = () => {
  const e = new SimulationEngine(loadParametricSync('afRemodeled'));
  afScenario.setupSubstrate(e, { afType: 'persistent' });
  return e;
};
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
  finish(e);
};
/** CS（調律の判定の頂点）の興奮の周期の平均と変動係数（直近 15 拍） */
const irregularity = (e: SimulationEngine) => {
  const d = e.rhythm.atrial.slice(1).map((x, i) => x - e.rhythm.atrial[i]).slice(-15);
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  return { mean: m, cv: Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length) / m };
};
/** channel の 1 頂点の興奮の周期 */
const channelCl = (e: SimulationEngine, ms: number) => {
  const s = roofSubstrate(e), v = s.channel[Math.floor(s.channel.length / 2)];
  const a: number[] = []; let last = -1;
  for (let k = 0; k < ms; k += 2) { e.tick(2); const x = e.ca.tissue.lastActivation[v]; if (x !== last) { a.push(x); last = x; } }
  const d = a.slice(1).map((x, i) => x - a[i]).slice(-8);
  return d.length ? d.reduce((p, q) => p + q, 0) / d.length : Infinity;
};

describe('AF-3：持続性 AF（天蓋の低電位領域）', () => {
  it('基質：天蓋の、PV の口・スリーブ・左心耳・僧帽弁輪・Bachmann 束から 15 mm 以上離れた所に、瘢痕・channel・線維化の輪（出口つき）', () => {
    const e = make();
    const s = roofSubstrate(e);
    expect(roofClearanceMm(e)).toBeGreaterThan(15);
    expect(REGIONS[e.mesh.regionOfVertex[e.query.closestPoint(s.center).vertex]]).toBe('la_roof');
    expect(s.core.length).toBeGreaterThan(10);
    expect(s.channel.length).toBeGreaterThan(s.core.length);
    expect(s.insulation.length).toBeGreaterThan(20);
    const t = e.ca.tissue;
    for (const v of [...s.core, ...s.insulation]) expect(t.viability[v]).toBe(0);
    for (const v of s.channel) { expect(t.conductionVelocity[v]).toBe(AF_SUBSTRATE.persistent.channelCv); expect(t.voltage[v]).toBeLessThanOrEqual(0.15); }
    // 既定の型の ERP のばらつきは変わらない
    const d = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(d);
    const lb = e.mesh.parts![0];
    let lo = Infinity, hi = -Infinity;
    for (let v = lb.vertexStart; v < lb.vertexStart + lb.vertexCount; v++) { const r = REGIONS[d.mesh.regionOfVertex[v]]; if (r.endsWith('_sleeve')) continue; lo = Math.min(lo, d.ca.tissue.erp[v]); hi = Math.max(hi, d.ca.tissue.erp[v]); }
    expect(lo).toBeGreaterThanOrEqual(159.9); expect(hi).toBeLessThanOrEqual(200.1);
  });

  it('旋回は規則的（周期 180〜220 ms）で、心房全体（CS）は不規則（細動様伝導）。PVI だけでは止まらず、channel を横切る RF で止まる', () => {
    const e = make();
    const cl = channelCl(e, 8000);
    expect(cl).toBeGreaterThan(180); expect(cl).toBeLessThan(220);
    expect(e.rhythm.state).toBe('tachycardia');
    const before = irregularity(e);
    expect(before.cv, `CS の変動係数 ${before.cv.toFixed(2)}`).toBeGreaterThan(0.15);
    pvi(e);
    e.tick(10000);
    expect(e.rhythm.state, 'PVI だけでは止まらない').toBe('tachycardia');
    expect(irregularity(e).cv).toBeGreaterThan(0.15);
    expect(roofDriverActive(e, afScenario)).toBe(true);
    expect(afScenario.structuralChecks(e).find((c) => c.id === 'roof-driver')!.ok).toBe(false);
    for (const p of channelCutPoints(e)) rf(e, p);
    e.tick(10000);
    expect(e.rhythm.state).not.toBe('tachycardia');
    expect(roofDriverActive(e, afScenario)).toBe(false);
    const checks = afScenario.structuralChecks(e);
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
  }, 240_000);

  it('双極の振幅（壁から 1 mm、電極間隔 2 mm）：channel と瘢痕は 0.5 mV 未満が大半、正常の心房は 1.5 mV 以上', () => {
    const e = make();
    const s = roofSubstrate(e);
    e.tick(2000);
    const pair = (v: number) => {
      const p = e.query.position(v), n = e.query.normalAt(v);
      const a = { x: p.x - n.x, y: p.y - n.y, z: p.z - n.z };
      const r = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      const k = r.x * n.x + r.y * n.y + r.z * n.z, u = { x: r.x - k * n.x, y: r.y - k * n.y, z: r.z - k * n.z }, l = Math.hypot(u.x, u.y, u.z);
      return [a, { x: a.x + (2 * u.x) / l, y: a.y + (2 * u.y) / l, z: a.z + (2 * u.z) / l }] as const;
    };
    const la = e.mesh.parts![0];
    const groups = { low: [...s.channel.filter((_, i) => i % 30 === 0), ...s.core.filter((_, i) => i % 10 === 0)], normal: [la.vertexStart + 2000, la.vertexStart + 1200] };
    const amp = (vs: number[]) => {
      const ps = vs.map(pair), mx = vs.map(() => -Infinity), mn = vs.map(() => Infinity);
      for (let k = 0; k < 1500; k += 2) {
        e.tick(2);
        ps.forEach(([a, b], i) => { const x = e.egm.unipolarAt(a, e.time) - e.egm.unipolarAt(b, e.time); mx[i] = Math.max(mx[i], x); mn[i] = Math.min(mn[i], x); });
      }
      return mx.map((x, i) => x - mn[i]);
    };
    const low = amp(groups.low), normal = amp(groups.normal);
    expect(low.filter((x) => x < 0.5).length / low.length).toBeGreaterThan(0.75);
    for (const x of normal) expect(x).toBeGreaterThan(1.5);
  }, 60_000);

  it('学習ゴール：持続性の型だけ。天蓋に 0.5 mV 未満の点が 5 点でボルテージのゴールを達成', () => {
    const e = make();
    const t = new GoalTracker(afScenario.goals);
    t.update(e);
    expect(t.activeGoals().map((g) => g.id)).toEqual(expect.arrayContaining(['lva-map', 'roof-driver', 'persistent-af-stopped']));
    expect(t.activeGoals().some((g) => g.id.startsWith('svc'))).toBe(false);
    const s = roofSubstrate(e);
    const pt = (v: number, mv: number, id: number): MapPoint => ({ id, position: e.query.position(v), vertex: v, latMs: 0, voltageMv: mv, catheterId: 'abl', signal: 'bipolar', referenceTime: 0 });
    const ch = s.channel.filter((_, i) => i % 10 === 0).slice(0, 5);
    expect(ch.every((v) => distanceFromRoofCenter(e, e.query.position(v)) <= 16)).toBe(true);
    t.update(e, ch.map((v, i) => pt(v, 0.6, i)));
    expect(t.isAchieved('lva-map')).toBe(false);
    t.update(e, ch.map((v, i) => pt(v, 0.3, i)));
    expect(t.isAchieved('lva-map')).toBe(true);
    // 既定の型では持続性のゴールを扱わない
    const d = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(d);
    const g = new GoalTracker(afScenario.goals);
    g.update(d);
    expect(g.activeGoals().some((x) => x.id === 'lva-map')).toBe(false);
  }, 60_000);
});

describe('持続性 AF：旋回は長く続く（QA の所見 27）', () => {
  it('持続性の型には PV のトリガーを置かない。旋回は 60 秒たっても規則的（約 194 ms）で、心房は不規則。60 秒後に PVI しても AF は続き、channel を横切る通電で止まる', () => {
    const e = make();
    expect(e.foci).toHaveLength(0);
    e.tick(60000);
    const cl = channelCl(e, 3000);
    expect(cl).toBeGreaterThan(180); expect(cl).toBeLessThan(220);
    expect(e.rhythm.state).toBe('tachycardia');
    expect(irregularity(e).cv).toBeGreaterThan(0.15);
    pvi(e);
    e.tick(10000);
    expect(e.rhythm.state, '60 秒後の PVI だけでは止まらない').toBe('tachycardia');
    const cl2 = channelCl(e, 3000);
    expect(cl2).toBeGreaterThan(180); expect(cl2).toBeLessThan(220);
    for (const p of channelCutPoints(e)) rf(e, p);
    e.tick(10000);
    expect(e.rhythm.state).not.toBe('tachycardia');
  }, 600_000);
});
