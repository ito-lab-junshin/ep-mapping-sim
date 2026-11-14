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
  eng.conduction.blocked = true;
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
    // 双極電位は波面の向きで小さくなりうる（卵円窩縁から LA に入った波面は CS の並びに斜めに進む）。平坦でなければよい
    for (const id of ['CS 9-10', 'CS 5-6', 'CS 1-2']) expect(peakAmp(eng, id)).toBeGreaterThan(0.3);
  });

  it('CS を浅くすると遠位電極の興奮が早くなる（位置で波形が変わる）', () => {
    const deep = atrialOnly(300);
    const shallow = new SimulationEngine(model);
    shallow.conduction.blocked = true;
    shallow.setPlacement('cs', { kind: 'path', s: 30, heightMm: 0 });
    shallow.tick(300);
    expect(atrialPeak(deep, 'CS 1-2') - atrialPeak(shallow, 'CS 1-2')).toBeGreaterThan(10);
  });

  it('His の H は房室結節部位の興奮 + AH、RV の V は + AH + HV の後', () => {
    const eng = new SimulationEngine(model);
    eng.tick(400);
    const c = eng.conduction;
    const tA = c.aTimes[0];
    // 1 拍目は前の拍がないので減衰伝導なし
    expect(c.hTimes[0]).toBeCloseTo(tA + AH_MS);
    expect(c.vTimes[0]).toBeCloseTo(tA + AH_MS + HV_MS);
    expect(peakTime(eng, ch(eng, 'RV 1-2'), 0)).toBeGreaterThan(c.vTimes[0]);
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
    eng.conduction.blocked = true;
    eng.tick(300);
    const cs = ['CS 9-10', 'CS 1-2'].map((id) => atrialPeak(eng, id));
    expect(cs[1]).toBeGreaterThan(cs[0]);
  });
});

describe('P 波幅（§4.2：一般心房筋の伝導速度の調整目標）', () => {
  it('normal の体表 ECG II の P 波幅は 120 ms 未満', () => {
    const eng = atrialOnly(300);
    const ii = ch(eng, 'II').buffer;
    let first = -1, last = -1;
    for (let i = 0; i < ii.length; i++) if (Math.abs(ii.at(i)) > 0.005) { if (first < 0) first = i; last = i; }
    const width = (last - first) * eng.sampleMs;
    expect(width).toBeGreaterThan(70);
    expect(width).toBeLessThan(120);
  });
});

describe('刺激・洞結節・焦点（Phase 4）', () => {
  it('HRA を 600 ms で刺激すると捕捉され、洞結節はリセットされて自発発火しない。全チャンネルに刺激アーチファクトが出る', () => {
    const eng = new SimulationEngine(model);
    eng.tick(100);
    const times = [200, 800, 1400, 2000];
    eng.pace('HRA', times);
    eng.tick(2300);
    const sinus = eng.sinusVertex;
    // 最後の洞結節の興奮は最後の刺激の直後（刺激による捕捉）
    expect(eng.ca.tissue.lastActivation[sinus]).toBeGreaterThan(2000);
    expect(eng.ca.tissue.lastActivation[sinus]).toBeLessThan(2060);
    // 刺激の時刻の付近で II にアーチファクト
    const ii = ch(eng, 'II').buffer;
    const at = (t: number) => ii.at(ii.length - 1 - Math.round((eng.time - t) / eng.sampleMs));
    expect(Math.max(at(2000), at(2002))).toBeGreaterThan(0.5);
  });

  it('異所性興奮の焦点は周期 minCl〜maxCl ms で発火する', () => {
    const eng = new SimulationEngine(model);
    eng.sinusEnabled = false;
    const v = model.anatomy.anchors.sinusNode.vertex;
    eng.addFocus(v, 300, 300, 7);
    eng.tick(1000);
    expect(eng.ca.tissue.lastActivation[v]).toBeGreaterThan(850);
  });

  it('RV 刺激で心室が興奮し、房室結節を逆行して心房へ戻る（求心性：房室結節の付近が最早、CS は近位から遠位）', () => {
    const eng = new SimulationEngine(model);
    eng.sinusEnabled = false;
    eng.pace('RV', [100]);
    eng.tick(400);
    expect(eng.conduction.vBeats.map((b) => b.source)).toEqual(['pace']);
    const la = eng.ca.tissue.lastActivation;
    let first = Infinity, firstV = -1;
    la.forEach((t, v) => { if (t >= 0 && t < first) { first = t; firstV = v; } });
    expect(first - 100).toBeGreaterThan(120); expect(first - 100).toBeLessThan(140);
    expect(firstV).toBe(eng.avNodeVertex);
    const cs = eng.catheter('cs')!;
    const t = (i: number) => la[eng.query.closestPoint(cs.electrodes[i].position).vertex];
    expect(t(9)).toBeLessThan(t(0));
  });
});

describe('洞調律の V1 の P 波', () => {
  it('前半陽性・後半陰性の二相性（RA が後上方 → 前下方、LA が後方へ興奮）', () => {
    const eng = new SimulationEngine(model);
    eng.conduction.blocked = true;
    const v1: number[] = [];
    for (let i = 0; i < 90; i++) { eng.stepOnce(); v1.push(eng.ecg.atrial('V1')); }
    const pos = v1.indexOf(Math.max(...v1)), neg = v1.indexOf(Math.min(...v1));
    expect(Math.max(...v1)).toBeGreaterThan(0.03);
    expect(Math.min(...v1)).toBeLessThan(-0.03);
    expect(pos).toBeLessThan(neg);
  });
});
