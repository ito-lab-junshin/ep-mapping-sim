import { describe, it, expect } from 'vitest';
import { PRESET_LA, PRESET_RA } from '../geometry/presetChambers';
import { SimulationEngine } from './SimulationEngine';
import { csPlacement } from '../catheter/catalog';
import { AH_MS, HV_MS } from '../params';
import type { EgmChannel } from '../types';

/** バッファ中の |値| 最大の時刻 ms（直近 windowMs の範囲） */
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

/** 心室遠隔成分の前（心房成分だけ）で最大になる時刻 */
function atrialPeak(eng: SimulationEngine, id: string) {
  const ch = eng.channels.find((c) => c.id === id)!;
  return peakTime(eng, ch, 0);
}

function runAtrialOnly(eng: SimulationEngine, ms: number) {
  // 心室成分を混ぜずに心房の順序だけを見る
  eng.av.params.ahMs = 10_000;
  eng.tick(ms);
}

describe('SimulationEngine（LA・洞調律）', () => {
  it('CS は近位から遠位の順に興奮する（CS 9-10 → 1-2）', () => {
    const eng = new SimulationEngine(PRESET_LA());
    runAtrialOnly(eng, 200);
    const order = ['CS 9-10', 'CS 7-8', 'CS 5-6', 'CS 3-4', 'CS 1-2'].map((id) => atrialPeak(eng, id));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    // どの双極も平坦にならない（衝突部位に置いていない）
    for (const ch of eng.channels.filter((c) => c.group === 'cs')) {
      let m = 0;
      for (let i = 0; i < ch.buffer.length; i++) m = Math.max(m, Math.abs(ch.buffer.at(i)));
      expect(m).toBeGreaterThan(0.5);
    }
  });

  it('CS を深く入れると遠位電極の興奮が遅くなる（位置で波形が変わる）', () => {
    const shallow = new SimulationEngine(PRESET_LA());
    const deep = new SimulationEngine(PRESET_LA());
    shallow.setPlacement('cs', csPlacement(shallow.landmarks, 70, 1));
    deep.setPlacement('cs', csPlacement(deep.landmarks, 160, 1));
    runAtrialOnly(shallow, 200);
    runAtrialOnly(deep, 200);
    expect(atrialPeak(deep, 'CS 1-2') - atrialPeak(shallow, 'CS 1-2')).toBeGreaterThan(15);
  });

  it('CS を壁から離すと双極電位の振幅が下がる', () => {
    const amp = (h: number) => {
      const eng = new SimulationEngine(PRESET_LA());
      eng.setPlacement('cs', csPlacement(eng.landmarks, 110, h));
      runAtrialOnly(eng, 200);
      const b = eng.channels.find((c) => c.id === 'CS 5-6')!.buffer;
      let m = 0;
      for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b.at(i)));
      return m;
    };
    const contact = amp(1), far = amp(10);
    expect(contact).toBeGreaterThan(0.5);
    expect(far).toBeLessThan(contact * 0.3);
  });

  it('His の H は房室結節部位の興奮 + AH、RV の V は + AH + HV の後に出る', () => {
    const eng = new SimulationEngine(PRESET_LA());
    eng.tick(400);
    const tA = eng.av.aTimes[0];
    expect(eng.av.hTimes[0]).toBeCloseTo(tA + AH_MS);
    expect(eng.av.vTimes[0]).toBeCloseTo(tA + AH_MS + HV_MS);
    const rv = eng.channels.find((c) => c.id === 'RV 1-2')!;
    expect(peakTime(eng, rv, 0)).toBeGreaterThan(eng.av.vTimes[0]);
  });

  it('LA 症例の HRA は心腔外（平坦）', () => {
    const eng = new SimulationEngine(PRESET_LA());
    eng.tick(300);
    expect(eng.catheter('hra')!.source).toBe('outside');
    const b = eng.channels.find((c) => c.id === 'HRA 1-2')!.buffer;
    for (let i = 0; i < b.length; i++) expect(b.at(i)).toBe(0);
  });

  it('体表 ECG：P 波は心房の最早活性化で始まり、QRS は心室興奮の後', () => {
    const eng = new SimulationEngine(PRESET_LA());
    eng.tick(600);
    const ii = eng.channels.find((c) => c.id === 'II')!.buffer;
    let firstNonZero = -1;
    for (let i = 0; i < ii.length; i++) if (Math.abs(ii.at(i)) > 1e-3) { firstNonZero = (i + 1) * eng.sampleMs; break; }
    expect(firstNonZero).toBeGreaterThan(0);
    expect(firstNonZero).toBeLessThanOrEqual(6); // 洞刺激 t=0 の直後
    const qrsPeak = peakTime(eng, eng.channels.find((c) => c.id === 'II')!, eng.av.vTimes[0] - 10);
    expect(qrsPeak).toBeGreaterThan(eng.av.vTimes[0]);
    expect(qrsPeak).toBeLessThan(eng.av.vTimes[0] + 90);
  });

  it('1 秒ぶんのシミュレーションが実時間より十分速い', () => {
    const eng = new SimulationEngine(PRESET_LA());
    const t0 = performance.now();
    eng.tick(1000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('SimulationEngine（RA）', () => {
  it('RA 症例では HRA がメッシュ上にあり、HRA が CS より先に興奮する', () => {
    const eng = new SimulationEngine(PRESET_RA());
    expect(eng.catheter('hra')!.source).toBe('mesh');
    runAtrialOnly(eng, 250);
    expect(atrialPeak(eng, 'HRA 1-2')).toBeLessThan(atrialPeak(eng, 'CS 9-10'));
  });
});
