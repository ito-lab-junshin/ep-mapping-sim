import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from './SimulationEngine';
import { AH_MS, HV_MS } from '../params';
import type { EgmChannel } from '../types';
import { laBodyPointTowards } from '../catheter/catalog';

const model = loadParametricSync('normal');

/** バッファ中の |値| 最大の時刻 ms（fromMs 以降） */
function peakTime(eng: SimulationEngine, ch: EgmChannel, fromMs: number): number {
  const b = ch.buffer;
  const t0 = eng.time - (b.length - 1) * eng.sampleMs;
  let best = -1, bestV = -Infinity;
  for (let i = 0; i < b.length; i++) {
    const t = t0 + i * eng.sampleMs;
    if (t < fromMs) continue;
    const v = Math.abs(b.at(i));
    if (v > bestV) { bestV = v; best = t; }
  }
  return best;
}
const ch = (eng: SimulationEngine, id: string) => eng.channels.find((c) => c.id === id)!;
const atrialPeak = (eng: SimulationEngine, id: string) => peakTime(eng, ch(eng, id), 0);
const peakAmp = (eng: SimulationEngine, id: string) => {
  const b = ch(eng, id).buffer;
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b.at(i)));
  return m;
};

/** 心室成分を混ぜずに心房の順序だけを見る */
function atrialOnly(ms: number) {
  const eng = new SimulationEngine(model);
  eng.av.params.ahMs = 10_000;
  eng.tick(ms);
  return eng;
}

describe('SimulationEngine（両心房・洞調律）', () => {
  it('HRA が最早、次に His の A、CS は近位から遠位の順', () => {
    const eng = atrialOnly(300);
    const hra = Math.min(atrialPeak(eng, 'HRA 1-2'), atrialPeak(eng, 'HRA 3-4'));
    const his = atrialPeak(eng, 'HIS p');
    const cs = ['CS 9-10', 'CS 7-8', 'CS 5-6', 'CS 3-4', 'CS 1-2'].map((id) => atrialPeak(eng, id));
    expect(hra).toBeLessThan(his);
    expect(his).toBeLessThan(cs[0]);
    for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    for (const id of ['CS 9-10', 'CS 5-6', 'CS 1-2']) expect(peakAmp(eng, id)).toBeGreaterThan(0.5);
  });

  it('CS を浅くすると遠位電極の興奮が早くなる（位置で波形が変わる）', () => {
    const deep = atrialOnly(300);
    const shallow = new SimulationEngine(model);
    shallow.av.params.ahMs = 10_000;
    shallow.setPlacement('cs', { kind: 'path', s: 30, heightMm: 0 });
    shallow.tick(300);
    expect(atrialPeak(deep, 'CS 1-2') - atrialPeak(shallow, 'CS 1-2')).toBeGreaterThan(10);
  });

  it('His の H は房室結節部位の興奮 + AH、RV の V は + AH + HV の後', () => {
    const eng = new SimulationEngine(model);
    eng.tick(400);
    const tA = eng.av.aTimes[0];
    expect(eng.av.hTimes[0]).toBeCloseTo(tA + AH_MS);
    expect(eng.av.vTimes[0]).toBeCloseTo(tA + AH_MS + HV_MS);
    expect(peakTime(eng, ch(eng, 'RV 1-2'), 0)).toBeGreaterThan(eng.av.vTimes[0]);
  });

  it('自由配置カテーテルは置くまで平坦、置くと信号が出て、外すと再び平坦', () => {
    const eng = new SimulationEngine(model);
    expect(eng.catheter('circ')!.placed).toBe(false);
    eng.tick(300);
    expect(peakAmp(eng, 'CIRC 1-2')).toBe(0);
    const v0 = eng.placementVersion;
    eng.setPlacement('ms', { kind: 'free', point: laBodyPointTowards(model, { x: 1, y: -0.35, z: 0 }), heightMm: 1, rotationDeg: 0 });
    expect(eng.placementVersion).toBe(v0 + 1);
    eng.tick(800);
    // 双極電位は波面の向きで小さくなりうるので、全スプラインの最大で見る
    const ms = eng.channels.filter((c) => c.catheterId === 'ms').map((c) => peakAmp(eng, c.id));
    expect(Math.max(...ms)).toBeGreaterThan(0.5);
    eng.setPlacement('ms', null);
    expect(eng.catheter('ms')!.placed).toBe(false);
  });

  it('経路カテーテルは 3D 上の点へドラッグできる', () => {
    const eng = new SimulationEngine(model);
    const target = eng.paths.cs.points[eng.paths.cs.points.length - 3];
    eng.dragOnPath('cs', target);
    const p = eng.spec('cs')!.placement;
    expect(p?.kind === 'path' && p.s).toBeGreaterThan(eng.paths.cs.length - 10);
  });

  it('1 秒ぶんのシミュレーションが 250 ms 未満で終わる', () => {
    const eng = new SimulationEngine(model);
    eng.tick(500);
    const t0 = performance.now();
    eng.tick(1000);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe('寸法セット', () => {
  it('AF シナリオ用（afRemodeled）でも同じ順序で興奮する', () => {
    const eng = new SimulationEngine(loadParametricSync('afRemodeled'));
    eng.av.params.ahMs = 10_000;
    eng.tick(300);
    const cs = ['CS 9-10', 'CS 1-2'].map((id) => atrialPeak(eng, id));
    expect(cs[1]).toBeGreaterThan(cs[0]);
  });
});
