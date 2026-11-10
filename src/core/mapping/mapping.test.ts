import { describe, it, expect } from 'vitest';
import { effectiveWoi } from './woi';
import { annotate, estimateCycleLength, referenceBeats } from './annotation';
import { omnipolar } from './omnipolar';
import { PointCollection } from './PointCollection';
import { finiteRange, hexToRgb, latColor, voltageColor } from './colorScale';
import { replayPhase, wavefrontIntensity } from './propagationReplay';
import { acquirePoints } from './acquire';
import { RingBuffer } from '../egm/RingBuffer';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { laBodyPointTowards } from '../catheter/catalog';
import { CellularAutomaton } from '../propagation/CellularAutomaton';
import { MAP_DEFAULTS } from '../params';
import type { MapSettings, Vec3 } from '../types';

const SETTINGS: MapSettings = {
  woiBeforeMs: MAP_DEFAULTS.woiBeforeMs, woiAfterMs: MAP_DEFAULTS.woiAfterMs, woiManual: false,
  referenceChannel: MAP_DEFAULTS.referenceChannel, latMethod: 'bipolarPeak',
  fillThresholdMm: MAP_DEFAULTS.fillThresholdMm, voltageScarMv: MAP_DEFAULTS.voltageScarMv, voltageNormalMv: MAP_DEFAULTS.voltageNormalMv,
};

describe('WOI（§6 の規則）', () => {
  it('洞調律では既定（−150〜+100 ms）のまま', () => {
    expect(effectiveWoi(SETTINGS, 'sinus', 800)).toEqual({ beforeMs: -150, afterMs: 100, auto: false });
  });
  it('頻拍で周期長より広ければ「周期長 − 10 ms」の幅に自動で切り替える（CL 250 ms → −130〜+110 ms）', () => {
    expect(effectiveWoi(SETTINGS, 'tachycardia', 250)).toEqual({ beforeMs: -130, afterMs: 110, auto: true });
  });
  it('頻拍でも、手動設定なら切り替えない。既定の幅のほうが狭ければそのまま', () => {
    expect(effectiveWoi({ ...SETTINGS, woiManual: true }, 'tachycardia', 250).auto).toBe(false);
    expect(effectiveWoi(SETTINGS, 'tachycardia', 400).auto).toBe(false);
  });
});

describe('注釈', () => {
  const buf = (f: (t: number) => number, n: number) => { const b = new RingBuffer(n); for (let i = 0; i < n; i++) b.push(f(i * 2)); return b; };
  // 200 ms ごとの鋭い A（幅 4 ms）と、その 100 ms 後の鈍く大きい V（幅 20 ms）
  const sig = (t: number) => {
    const ph = t % 200;
    return 1.0 * Math.exp(-0.5 * ((ph - 50) / 2) ** 2) + 1.5 * Math.exp(-0.5 * ((ph - 150) / 20) ** 2);
  };

  it('基準の拍は鋭い A で取り、鈍く大きい V は拾わない。周期長を推定できる', () => {
    const b = buf(sig, 500); // 0〜998 ms
    const beats = referenceBeats(b, 998, 2);
    for (const t of beats) expect(t % 200).toBeGreaterThanOrEqual(46);
    for (const t of beats) expect(t % 200).toBeLessThanOrEqual(54);
    expect(estimateCycleLength(beats)).toBe(200);
  });

  it('双極の最大振幅・単極の −dV/dt で LAT を取り、平坦なら null', () => {
    const bip = (t: number) => Math.exp(-0.5 * ((t - 30) / 3) ** 2);
    const uni = (t: number) => -Math.tanh((t - 32) / 2);
    const w = { beforeMs: -50, afterMs: 80 };
    expect(annotate(bip, uni, 0, w, 1, 'bipolarPeak').latMs).toBeCloseTo(30, 0);
    // 傾きは隣り合う 2 サンプルの中点の時刻で表すので、サンプル間隔（1 ms）以内で一致すればよい
    expect(Math.abs(annotate(bip, uni, 0, w, 1, 'unipolarDvdt').latMs! - 32)).toBeLessThanOrEqual(1);
    expect(annotate(() => 0, null, 0, w, 1, 'bipolarPeak').latMs).toBeNull();
  });
});

describe('方向非依存 EGM', () => {
  it('波面の向きを変えても電位がほぼ一定（通常の双極は大きく変わる）', () => {
    const wave = (t: number) => Math.exp(-0.5 * ((t - 50) / 3) ** 2) - Math.exp(-0.5 * ((t - 56) / 3) ** 2);
    const ts = Array.from({ length: 100 }, (_, i) => i);
    const omni: number[] = [], bip: number[] = [];
    for (const deg of [0, 30, 60, 90]) {
      const a = (deg * Math.PI) / 180;
      const b1 = ts.map((t) => Math.cos(a) * wave(t)), b2 = ts.map((t) => Math.sin(a) * wave(t));
      omni.push(omnipolar(b1, b2).voltageMv);
      bip.push(Math.max(...b1) - Math.min(...b1));
    }
    expect(Math.max(...omni) / Math.min(...omni)).toBeLessThan(1.05);
    expect(Math.max(...bip) / Math.min(...bip)).toBeGreaterThan(5);
  });
});

describe('点の補間', () => {
  const model = loadParametricSync('normal');
  const mesh = model.mesh;
  const truth = (() => {
    const ca = new CellularAutomaton(mesh);
    ca.stimulate(model.anatomy.anchors.sinusNode.vertex);
    for (let i = 0; i < 80; i++) ca.step(2);
    return ca.tissue.lastActivation;
  })();
  const P = (v: number): Vec3 => ({ x: mesh.positions[3 * v], y: mesh.positions[3 * v + 1], z: mesh.positions[3 * v + 2] });
  const collect = (count: number) => {
    const pc = new PointCollection(mesh);
    const n = mesh.positions.length / 3;
    for (let k = 0; k < count; k++) {
      const v = Math.floor(((k * 7919) % count) * (n / count)); // 決定的にばらまく
      pc.add({ position: P(v), vertex: v, latMs: truth[v], voltageMv: 1, catheterId: 'ms', signal: 'bipolar', referenceTime: 0 });
    }
    return pc;
  };
  const err = (pc: PointCollection, fill: number) => {
    const lat = pc.interpolate('lat', fill);
    let s = 0, k = 0, nodata = 0;
    lat.forEach((x, v) => { if (Number.isNaN(x)) nodata++; else { s += Math.abs(x - truth[v]); k++; } });
    return { mean: s / k, nodata };
  };

  it('到達距離を小さくすると「データなし」の頂点が増える', () => {
    const pc = collect(60);
    expect(err(pc, 5).nodata).toBeGreaterThan(err(pc, 20).nodata);
  });

  it('点を増やすと、補間した LAT と正解の誤差が小さくなる', () => {
    expect(err(collect(400), 15).mean).toBeLessThan(err(collect(40), 15).mean);
  });
});

describe('色（テーマの色の並びを使う）', () => {
  const ramp = ['#ffffff', '#ff0000', '#0000ff'];
  it('LAT：最早は ramp の先頭（EnSite 風なら白）、最遅は末尾', () => {
    expect(latColor(10, 10, 110, ramp)).toEqual([1, 1, 1]);
    expect(latColor(110, 10, 110, ramp)).toEqual(hexToRgb('#0000ff'));
  });
  it('ボルテージ：0.1 mV 未満は瘢痕色、0.5 mV 以上は ramp の末尾（正常）', () => {
    expect(voltageColor(0.05, 0.1, 0.5, ramp, '#808080')).toEqual(hexToRgb('#808080'));
    expect(voltageColor(2.0, 0.1, 0.5, ramp, '#808080')).toEqual(hexToRgb('#0000ff'));
  });
  it('NaN を除いた範囲', () => {
    expect(finiteRange([Number.NaN, 3, -1])).toEqual({ min: -1, max: 3 });
    expect(finiteRange([Number.NaN])).toBeNull();
  });
});

describe('伝播アニメーション', () => {
  it('再生位置は LAT の範囲を繰り返し、波面は直前の頂点ほど明るい', () => {
    const ph = replayPhase(400, 0, 100, 30, 1);
    expect(ph).toBeGreaterThanOrEqual(0);
    expect(ph).toBeLessThan(130);
    expect(wavefrontIntensity(50, 55)).toBe(1);
    expect(wavefrontIntensity(50, 45)).toBe(0);
    expect(wavefrontIntensity(0, 100)).toBe(0);
  });
});

describe('カテーテルからの点の取得', () => {
  const model = loadParametricSync('normal');
  const run = (kind: 'ms' | 'grid' | 'circ', dir: Vec3, setup?: (e: SimulationEngine) => void) => {
    const eng = new SimulationEngine(model);
    setup?.(eng);
    eng.setPlacement(kind, { kind: 'free', point: laBodyPointTowards(model, dir), heightMm: 1, rotationDeg: 0 });
    eng.tick(1500);
    return { eng, r: acquirePoints(eng, kind, SETTINGS, { omnipolar: kind === 'grid', rhythm: 'sinus' }) };
  };
  const truthAt = (eng: SimulationEngine, v: number, near: number) => {
    let act = eng.ca.tissue.lastActivation[v];
    while (act > near + 300) act -= eng.sinusCycleMs;
    return act;
  };

  it('基準は CS 9-10 の A（心室の遠隔電位ではない）で、LAT は活性化時刻と ±5 ms 以内', () => {
    for (const kind of ['ms', 'grid', 'circ'] as const) {
      const { eng, r } = run(kind, { x: 0.3, y: 0.2, z: -1 });
      expect(r.points.length, kind).toBeGreaterThan(5);
      // 基準の A：洞結節の刺激から 150 ms 以内
      expect((r.referenceTime! % eng.sinusCycleMs)).toBeLessThan(150);
      for (const p of r.points) {
        expect(p.latMs).not.toBeNull();
        expect(Math.abs(p.referenceTime + p.latMs! - truthAt(eng, p.vertex, p.referenceTime + p.latMs!)), kind).toBeLessThan(5);
      }
    }
  });

  it('病変（viability = 0）の上で取得した点は 0.1 mV 未満', () => {
    const center = laBodyPointTowards(model, { x: 0.3, y: 0.2, z: -1 });
    const { r } = run('ms', { x: 0.3, y: 0.2, z: -1 }, (eng) => {
      const p = model.mesh.positions;
      for (let v = 0; v < p.length / 3; v++) {
        if (Math.hypot(p[3 * v] - center.x, p[3 * v + 1] - center.y, p[3 * v + 2] - center.z) < 22) eng.ca.tissue.viability[v] = 0;
      }
    });
    expect(r.points.length).toBeGreaterThan(0);
    for (const p of r.points) expect(p.voltageMv).toBeLessThan(0.1);
  });

  it('接触していなければ点は取れない', () => {
    const eng = new SimulationEngine(model);
    eng.setPlacement('ms', { kind: 'free', point: laBodyPointTowards(model, { x: 1, y: 0, z: 0 }), heightMm: 6, rotationDeg: 0 });
    eng.tick(1500);
    const r = acquirePoints(eng, 'ms', SETTINGS, { omnipolar: false, rhythm: 'sinus' });
    expect(r.points.length).toBe(0);
    expect(r.reason).toBe('no-contact');
  });

  it('多数の部位で取得した LAT マップの最早期は洞結節の近く', () => {
    const pc = new PointCollection(model.mesh);
    const [la, ra] = [model.anatomy.la.center, model.anatomy.ra.center];
    const q = new SimulationEngine(model).query;
    const dirs: Vec3[] = [];
    for (const y of [-0.5, 0.5]) for (let k = 0; k < 6; k++) dirs.push({ x: Math.cos((k * Math.PI) / 3), y, z: Math.sin((k * Math.PI) / 3) });
    for (const center of [la, ra]) for (const d of dirs) {
      const target = q.closestPoint({ x: center.x + d.x * 60, y: center.y + d.y * 60, z: center.z + d.z * 60 }).point;
      const eng = new SimulationEngine(model);
      eng.setPlacement('ms', { kind: 'free', point: target, heightMm: 1, rotationDeg: 0 });
      eng.tick(1000); // 2 拍目（800 ms）の基準の A と WOI が記録し終わる
      for (const p of acquirePoints(eng, 'ms', SETTINGS, { omnipolar: false, rhythm: 'sinus' }).points) pc.add(p);
    }
    const lat = pc.interpolate('lat', 30);
    let best = -1, bestLat = Infinity;
    lat.forEach((x, v) => { if (!Number.isNaN(x) && x < bestLat) { bestLat = x; best = v; } });
    const s = model.anatomy.anchors.sinusNode.point;
    const d = Math.hypot(model.mesh.positions[3 * best] - s.x, model.mesh.positions[3 * best + 1] - s.y, model.mesh.positions[3 * best + 2] - s.z);
    expect(d).toBeLessThan(25);
  }, 60_000);
});
