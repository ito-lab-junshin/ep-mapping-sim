import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { defaultProtocol, runProtocol, ProtocolSession } from './ProtocolSession';
import { RhythmMonitor } from '../rhythm/RhythmMonitor';
import { PROTOCOL } from '../params';

const model = loadParametricSync('normal');

describe('刺激プロトコル（§5.6）', () => {
  it('既定値：S1 600 ms × 8、S2 は S1 − 100 ms から 10 ms 刻み、バーストは 300 → 200 ms・各 10 拍', () => {
    const p = defaultProtocol('extrastimulus', 'HRA');
    expect([p.s1Ms, p.s1Beats, p.s2StartMs, p.s2StepMs]).toEqual([600, 8, 500, 10]);
    const b = defaultProtocol('burst', 'CS_OS');
    expect([b.burstFromMs, b.burstToMs, b.burstStepMs, b.burstBeats]).toEqual([300, 200, 10, 10]);
  });

  it('S1 × n と S2 の刺激が予約どおりの間隔で届く', () => {
    const eng = new SimulationEngine(model);
    const s = new ProtocolSession(eng, { ...defaultProtocol('extrastimulus', 'HRA'), s1Beats: 3, s2StartMs: 400 });
    eng.tick(3000);
    s.update();
    const d = eng.stimulator.delivered.slice(-4);
    expect(d[1] - d[0]).toBe(PROTOCOL.s1Ms);
    expect(d[2] - d[1]).toBe(PROTOCOL.s1Ms);
    expect(d[3] - d[2]).toBe(400);
  });

  it('正常の心房（頻拍の基質なし）：S2 を短くすると AH が延び、房室結節の ERP でブロック、心房の ERP で捕捉されなくなり非誘発', () => {
    const eng = new SimulationEngine(model);
    const s = runProtocol(eng, { ...defaultProtocol('extrastimulus', 'HRA'), s1Beats: 3, s2StartMs: 360, observeMs: 800 });
    expect(s.status).toBe('noninducible');
    expect(eng.rhythm.state).toBe('noninducible');
    const conducted = s.results.filter((r) => r.ahMs !== null);
    expect(conducted.length).toBeGreaterThan(1);
    // 減衰伝導：最も短い連結期で伝わった AH は最初より長い
    expect(conducted[conducted.length - 1].ahMs!).toBeGreaterThan(conducted[0].ahMs! + 10);
    // 房室ブロック（AH = null）が起きたあと、心房の ERP で捕捉されなくなる
    expect(s.results.some((r) => r.captured && r.ahMs === null)).toBe(true);
    expect(s.results[s.results.length - 1].captured).toBe(false);
    expect(s.results.every((r) => !r.echo && !r.induced)).toBe(true);
  }, 60_000);
});

describe('RhythmMonitor', () => {
  it('刺激をやめてから 5 秒以上、周期 400 ms 未満の興奮が続けば頻拍、止まれば terminated', () => {
    const m = new RhythmMonitor();
    for (let t = 0; t <= 7000; t += 250) { m.recordAtrial(t); m.update(t, 1000, t < 1000); }
    expect(m.state).toBe('tachycardia');
    expect(m.currentCycleLength(7000)).toBe(250);
    m.update(9000, 1000, false);
    expect(m.state).toBe('terminated');
  });

  it('洞調律（周期 800 ms）は sinus', () => {
    const m = new RhythmMonitor();
    for (let t = 0; t <= 8000; t += 800) { m.recordAtrial(t); m.update(t, -Infinity, false); }
    expect(m.state).toBe('sinus');
  });
});
