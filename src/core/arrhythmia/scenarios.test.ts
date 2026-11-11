import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { avnrtScenario } from './avnrt';
import { wpwScenario } from './wpw';
import { afScenario, AF_TRIGGER_PVS, sleeveTip } from './af';
import { PV_NAMES, PV_OSTIUM, REGION_ID, type PvName } from '../geometry/regions';
import { tryInduce, verifyCure } from './common';
import { ablateAt } from '../ablation/simpleAblation';
import { AV_NODE } from '../params';
import { antegradeTime } from '../conduction/AvNode';

/** テストを速くするための短いプロトコル（S1 4 拍、S2 は 360 ms から） */
const FAST = { s1Beats: 4, s2StartMs: 360, observeMs: 1200 };

describe('AVNRT', () => {
  const engine = () => { const e = new SimulationEngine(loadParametricSync('normal')); avnrtScenario.setupSubstrate(e); return e; };

  it('S1-S2 で AH ジャンプ（≧ 50 ms）からエコー、頻拍が誘発され、頻拍中は A と V がほぼ同時', () => {
    const r = tryInduce(engine(), avnrtScenario, FAST);
    expect(r.induced).toBe(true);
    const res = r.session!.results;
    const ah = res.map((x) => x.ahMs).filter((x): x is number => x !== null);
    const jumps = ah.slice(1).map((x, i) => x - ah[i]);
    expect(Math.max(...jumps)).toBeGreaterThanOrEqual(50);
    expect(res[res.length - 1].echo).toBe(true);
    const e = r.engine;
    const cl = e.rhythm.currentCycleLength(e.time)!;
    expect(cl).toBeGreaterThan(220);
    expect(cl).toBeLessThan(400);
    // 頻拍中の V と、速伝導路を逆行した心房への出口がほぼ同時
    const v = e.conduction.vTimes[e.conduction.vTimes.length - 1];
    const a = e.conduction.exitLog.filter((x) => x.via === 'fast').map((x) => x.time);
    const nearest = a.reduce((m, t) => (Math.abs(t - v) < Math.abs(m - v) ? t : m), Infinity);
    expect(Math.abs(nearest - v)).toBeLessThan(25);
  }, 120_000);

  it('遅伝導路を焼くと非誘発、速伝導路は保たれる（長い連結期の AH は変わらない）', () => {
    const e = engine();
    ablateAt(e, e.model.anatomy.anchors.slowPathway.point);
    const checks = verifyCure(e, avnrtScenario, FAST);
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
    const r = tryInduce(e, avnrtScenario, FAST);
    // 速伝導路の減衰伝導の式どおりの AH（遅伝導路へのジャンプがない）
    for (const x of r.session!.results.filter((y) => y.ahMs !== null)) {
      const expected = antegradeTime({ name: 'fast', ...AV_NODE.fast }, x.couplingMs)!;
      expect(Math.abs(x.ahMs! - expected)).toBeLessThan(8);
    }
  }, 120_000);
});

describe('WPW', () => {
  const engine = () => { const e = new SimulationEngine(loadParametricSync('normal')); wpwScenario.setupSubstrate(e); return e; };

  it('洞調律：副伝導路から心室が先に興奮し（デルタ波）、PR が短い', () => {
    const e = engine();
    e.tick(2000);
    const beat = e.conduction.vBeats.filter((b) => b.time > 800)[0];
    expect(beat.source).toBe('ap');
    expect(beat.hisArrival! - beat.time).toBeGreaterThan(20);
    // PR（洞結節の興奮 → QRS 開始）< 120 ms
    expect(beat.time - 800).toBeLessThan(120);
  });

  it('RV 刺激：副伝導路を逆行し、心房は偏心性に興奮する（CS 遠位が近位より早い）', () => {
    const e = engine();
    e.sinusEnabled = false;
    e.pace('RV', [100]);
    e.tick(500);
    const cs = e.catheter('cs')!;
    const t = (i: number) => e.ca.tissue.lastActivation[e.query.closestPoint(cs.electrodes[i].position).vertex];
    expect(t(0)).toBeGreaterThan(0);
    expect(t(0)).toBeLessThan(t(9));
  });

  it('S1-S2 で順行性 AVRT が誘発される（His 経由で下行、副伝導路を逆行）', () => {
    const r = tryInduce(engine(), wpwScenario, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 });
    expect(r.induced).toBe(true);
    const e = r.engine;
    const last = e.conduction.vBeats.slice(-3);
    expect(last.every((b) => b.source === 'his')).toBe(true);
    expect(e.conduction.exitLog.slice(-2).every((x) => x.via === 'ap')).toBe(true);
    const cl = e.rhythm.currentCycleLength(e.time)!;
    expect(cl).toBeGreaterThan(250);
    expect(cl).toBeLessThan(400);
  }, 120_000);

  it('副伝導路を焼くとデルタ波が消え、非誘発', () => {
    const e = engine();
    for (const v of e.conduction.ap!.vertices) ablateAt(e, e.query.position(v));
    e.tick(2500);
    const checks = verifyCure(e, wpwScenario, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 });
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
  }, 120_000);
});

describe('AF（PVI）', () => {
  const engine = () => { const e = new SimulationEngine(loadParametricSync('afRemodeled')); afScenario.setupSubstrate(e); return e; };
  /**
   * PV 口の帯（解剖ラベル）の頂点をすべて焼く隔離線。
   * 帯の一部だけを焼くと、病変の周辺部（viability が部分的に下がっただけの頂点）を通って伝導が残る
   */
  const isolate = (e: SimulationEngine, pv: PvName) => {
    const id = REGION_ID[PV_OSTIUM[pv]];
    e.mesh.regionOfVertex.forEach((r, v) => { if (r === id) ablateAt(e, e.query.position(v)); });
  };

  it('PV トリガーで AF が自然に始まり、心房・心室とも不規則', () => {
    const r = tryInduce(engine(), afScenario);
    expect(r.induced).toBe(true);
    const cv = (t: number[]) => {
      const d = t.slice(1).map((x, i) => x - t[i]).slice(-12);
      const m = d.reduce((a, b) => a + b, 0) / d.length;
      return Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length) / m;
    };
    expect(cv(r.engine.rhythm.atrial)).toBeGreaterThan(0.1);
    expect(cv(r.engine.conduction.vTimes)).toBeGreaterThan(0.08);
  }, 120_000);

  it('トリガーのある PV だけを隔離すると AF は止まるが、4 本すべてではないので根治の基準を満たさない', () => {
    const e = engine();
    for (const pv of AF_TRIGGER_PVS) isolate(e, pv);
    const checks = verifyCure(e, afScenario);
    expect(checks.find((c) => c.id === 'noninducible')!.ok).toBe(true);
    // トリガーのない PV（LIPV・RIPV）は隔離されていないので、根治の基準を満たさない
    // （同側の PV は口が隣り合うため、片方だけの隔離線では回り込む経路が残ることもある）
    for (const pv of ['LIPV', 'RIPV']) expect(checks.find((c) => c.id === `entrance-${pv}`)!.ok, pv).toBe(false);
    expect(checks.every((c) => c.ok)).toBe(false);
  }, 120_000);

  it('4 本の PV を隔離すると entrance block・exit block・非誘発がすべて成立し、トリガーは PV 内で発火し続ける', () => {
    const e = engine();
    for (const pv of PV_NAMES) isolate(e, pv);
    const checks = verifyCure(e, afScenario);
    expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
    // 隔離された PV の中ではトリガーが発火し続ける（PV 電位の解離）
    e.tick(2000);
    expect(e.ca.tissue.lastActivation[sleeveTip(e, 'LSPV')]).toBeGreaterThan(e.time - 400);
    expect(e.rhythm.state).not.toBe('tachycardia');
  }, 180_000);
});
