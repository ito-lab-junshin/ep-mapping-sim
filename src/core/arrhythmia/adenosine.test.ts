import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { avnrtScenario } from './avnrt';
import { wpwScenario } from './wpw';
import { aflCtiScenario } from './aflCti';
import { tryInduce } from './common';
import { AV_NODE } from '../params';
import type { ArrhythmiaScenario } from '../types';

/** アデノシン急速静注：房室結節を一時的に止める（先生と決定。AV_NODE.adenosine） */
const B = AV_NODE.adenosine.blockMs;
const induced = (sc: ArrhythmiaScenario, dims: 'normal' | 'aflRemodeled', ov: object) => {
  const base = new SimulationEngine(loadParametricSync(dims));
  sc.setupSubstrate(base);
  const r = tryInduce(base, sc, ov);
  expect(r.induced).toBe(true);
  return r.engine;
};
const vBeatsBetween = (e: SimulationEngine, t0: number, t1: number) => e.conduction.vBeats.filter((b) => b.time >= t0 && b.time < t1);

describe('アデノシン（房室結節の一時的なブロック）', () => {
  it('AVNRT は止まり、洞調律に戻る（房室伝導も戻る）', () => {
    const e = induced(avnrtScenario, 'normal', { s1Beats: 4, s2StartMs: 360, observeMs: 1200 });
    e.ablation.giveAdenosine();
    expect(e.ablation.avBlockRemainingMs).toBeGreaterThan(B - 10);
    e.tick(B + 6000);
    expect(e.rhythm.state).not.toBe('tachycardia');
    // ブロックが終わったあとは洞調律が His を通って心室へ伝わる
    expect(vBeatsBetween(e, e.time - 3000, e.time).some((b) => b.source === 'his')).toBe(true);
  }, 120_000);

  it('順行性 AVRT（WPW）は止まる。副伝導路は止めないので、ブロック中の洞調律の拍は副伝導路から（最大の早期興奮）', () => {
    const e = induced(wpwScenario, 'normal', { s1Beats: 4, s2StartMs: 300, observeMs: 1200 });
    const t0 = e.time;
    e.ablation.giveAdenosine();
    e.tick(B + 6000);
    expect(e.rhythm.state).not.toBe('tachycardia');
    const during = vBeatsBetween(e, t0 + 1000, t0 + B);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((b) => b.source === 'ap' && b.hisArrival === undefined)).toBe(true);
  }, 120_000);

  it('AFL は心房の粗動が続き、ブロック中は心室の拍がない（粗動波が見えやすい）', () => {
    const e = induced(aflCtiScenario, 'aflRemodeled', { observeMs: 1000 });
    const t0 = e.time;
    e.ablation.giveAdenosine();
    e.tick(B - 500);
    expect(vBeatsBetween(e, t0 + 300, t0 + B - 500)).toHaveLength(0);
    expect(e.rhythm.atrial.filter((t) => t > t0 + 300).length).toBeGreaterThan(10);
    e.tick(3000);
    expect(e.rhythm.state).toBe('tachycardia');
    expect(vBeatsBetween(e, t0 + B, e.time).length).toBeGreaterThan(0);
  }, 120_000);
});
