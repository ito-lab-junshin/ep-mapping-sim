import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { wpwScenario } from '../arrhythmia/wpw';
import { afScenario } from '../arrhythmia/af';
import { reconnectionCheck } from '../arrhythmia/common';
import { ABLATION } from '../params';
import type { Vec3 } from '../types';

/** 浮腫（可逆的な傷害）と再伝導（docs/DESIGN.md §7） */
const E = ABLATION.edema;
const finish = (e: SimulationEngine) => { e.ablation.speed = 250; while (e.ablation.active) e.ablation.step(e.sampleMs); };
const rf = (e: SimulationEngine, point: Vec3, powerW: number, durationS: number) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW, durationS };
  expect(e.ablation.start('rf')).toBeNull();
  finish(e);
};

describe('浮腫：病変の場', () => {
  const engine = () => new SimulationEngine(loadParametricSync('normal'));

  it('t + r ≧ 1 で伝導遮断。浮腫は処置の時計で exp(−t/τ) で引き、t < 1 は伝導が戻る（再伝導）。t = 1 は戻らない', () => {
    const e = engine();
    const f = e.ablation.field, viab = e.ca.tissue.viability;
    f.raise(10, 0.6); f.raiseEdema(10, 1);
    f.raise(20, 1); f.raiseEdema(20, 1);
    expect(viab[10]).toBe(0);
    expect(viab[20]).toBe(0);
    f.wait(E.waitMin);
    expect(f.edema[10]).toBeCloseTo(Math.exp(-E.waitMin / E.tauMin), 4);
    expect(f.procedureMin).toBeCloseTo(E.waitMin);
    expect(viab[10]).toBeGreaterThan(0); // 0.6 + 0.26 < 1
    expect(viab[20]).toBe(0);
  });

  it('アデノシン負荷のあいだは浮腫の効果を消し（休眠伝導）、終わると戻る。シミュレーション時間 20 秒で自動的に終わる', () => {
    const e = engine();
    const f = e.ablation.field, viab = e.ca.tissue.viability;
    f.raise(10, 0.6); f.raiseEdema(10, 1);
    e.ablation.giveAdenosine();
    expect(viab[10]).toBeGreaterThan(0);
    expect(f.withoutEdema(() => viab[10])).toBeGreaterThan(0);
    e.tick(E.adenosineMs + 100);
    expect(e.ablation.adenosineActive).toBe(false);
    expect(viab[10]).toBeLessThan(f.withoutEdema(() => viab[10]) + 1e-9);
  });

  it('病変の前の組織の値を保つ：もともと伝導しない頂点（瘢痕）は、浮腫が引いても伝導しない', () => {
    const e = engine();
    e.ca.tissue.viability[30] = 0;
    e.ablation.field.raiseEdema(30, 0.5);
    e.ablation.wait(60);
    expect(e.ca.tissue.viability[30]).toBe(0);
  });

  it('RF：病変の範囲は浮腫 1、縁から 3 mm 外側まで浮腫。処置の時計は通電時間（倍速）とシミュレーション時間で進む', () => {
    const e = engine();
    const p = e.model.anatomy.anchors.slowPathway.point;
    rf(e, p, 30, 30);
    const f = e.ablation.field;
    const m = e.ablation.last!;
    const r = m.radiusMm!;
    let inside = 0, margin = 0, outside = 0;
    for (let v = 0; v < f.edema.length; v++) {
      const q = e.query.position(v), d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d < r - 0.5 && f.edema[v] >= 0.99) inside++;
      if (d > r + 0.5 && d < r + E.marginMm - 0.5 && f.edema[v] > 0 && f.edema[v] < 1) margin++;
      if (d > r + E.marginMm + 0.5 && f.edema[v] > 0) outside++;
    }
    expect(inside).toBeGreaterThan(3);
    expect(margin).toBeGreaterThan(3);
    expect(outside).toBe(0);
    expect(f.procedureMin).toBeGreaterThan(0.45); // 30 秒の通電
    const before = f.procedureMin;
    e.tick(6000);
    expect(f.procedureMin - before).toBeCloseTo(0.1, 2);
  });

  it('同じ部位への焼き足し（touch-up）は浮腫で深く入りにくい：浮腫が引いてからの焼き足しより浅い', () => {
    const depthAfter = (waitMin: number) => {
      const e = engine();
      const p = e.model.anatomy.anchors.ctiTv.point; // 壁厚 5 mm（30 W では貫壁しない）
      rf(e, p, 20, 10);
      e.ablation.wait(waitMin);
      const v = e.query.closestPoint(p).vertex;
      const t0 = e.ablation.field.transmurality[v];
      // 焼き足しは強めに（1 回の通電の深さはその通電の量で決まり、前より深い所だけが増える）
      rf(e, p, 30, 30);
      return e.ablation.field.transmurality[v] - t0;
    };
    const early = depthAfter(0), late = depthAfter(90);
    expect(early).toBeLessThan(late);
  });

  it('PFA は浮腫を置かない。クライオは帯と縁に浮腫を置く', () => {
    const e = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(e);
    e.ablation.pfa = { pv: 'LSPV', shape: 'basket' };
    e.ablation.applyPfa();
    expect(e.ablation.field.edemaVertexCount).toBe(0);
    e.ablation.cryo = { ...e.ablation.cryo, pv: 'RSPV', durationS: 60 };
    expect(e.ablation.start('cryo')).toBeNull();
    finish(e);
    expect(e.ablation.field.edemaVertexCount).toBeGreaterThan(20);
  }, 60_000);
});

describe('再伝導：症例', () => {
  it('WPW：浅い RF で副伝導路は直後にブロック（デルタ波が消える）、20 分の待機で伝導が戻る（再伝導）。根治の基準も再伝導で ✗', () => {
    const e = new SimulationEngine(loadParametricSync('normal'));
    wpwScenario.setupSubstrate(e);
    const ap = e.conduction.ap!.vertices;
    // 付着部の 2 頂点の中点に、浅い通電（25 W・15 秒）
    const a = e.query.position(ap[0]), b = e.query.position(ap[1]);
    rf(e, e.query.closestPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }).point, 25, 15);
    const t = Math.max(...ap.map((v) => e.ablation.field.transmurality[v]));
    expect(t, '浅い病変').toBeLessThan(0.7);
    e.tick(2500);
    const beats = () => e.conduction.vBeats.filter((b) => b.source !== 'pace').slice(-2);
    expect(beats().every((b) => b.source === 'his'), '直後はデルタ波なし').toBe(true);
    expect(wpwScenario.structuralChecks(e).every((c) => c.ok)).toBe(true);
    expect(reconnectionCheck(e, wpwScenario).ok).toBe(false);
    e.ablation.wait(E.waitMin);
    e.tick(2500);
    expect(beats().some((b) => b.source === 'ap'), '待機後にデルタ波が再出現').toBe(true);
  }, 60_000);
});

describe('クライオの浮腫と Time to isolation（浮腫は深さと同じ育ち方）', () => {
  const freeze = (pv: 'LSPV' | 'RSPV', push01: number, durationS = 180) => {
    const e = new SimulationEngine(loadParametricSync('afRemodeled'));
    afScenario.setupSubstrate(e);
    e.ablation.cryo = { ...e.ablation.cryo, pv, push01, misalignDeg: 0, durationS };
    expect(e.ablation.start('cryo')).toBeNull();
    e.ablation.speed = 250;
    let tti: number | null | undefined = null;
    while (e.ablation.active) { e.ablation.step(e.sampleMs); tti = e.ablation.metrics()?.timeToIsolationS ?? tti; }
    return { e, tti };
  };
  const maxEdema = (e: SimulationEngine) => e.ablation.field.edema.reduce((m, x) => Math.max(m, x), 0);

  it('閉塞度 1・0.8 の Time to isolation は数十秒（開始直後ではない）。0.7 では隔離されない', () => {
    for (const push of [1, 0.8]) {
      const { tti } = freeze('LSPV', push);
      expect(tti, `閉塞度 ${push}`).not.toBeNull();
      expect(tti!).toBeGreaterThan(15);
      expect(tti!).toBeLessThan(45);
    }
    expect(freeze('LSPV', 0.7).tti).toBeNull();
  }, 120_000);

  it('60 秒（設定の最短）の冷凍の浮腫は約 0.63（1 − e⁻¹）、180 秒では 0.9 以上', () => {
    const short = maxEdema(freeze('RSPV', 1, 60).e);
    expect(short).toBeGreaterThan(0.55);
    expect(short).toBeLessThan(0.7);
    expect(maxEdema(freeze('RSPV', 1, 180).e)).toBeGreaterThan(0.9);
  }, 120_000);
});
