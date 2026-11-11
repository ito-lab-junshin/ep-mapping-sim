import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario, laBody, sleeveVertices } from '../arrhythmia/af';
import { separated } from '../arrhythmia/common';
import { contactForceG, lesionIndexPct, localImpedanceOhm, rfDepthMm, rfRadiusMm } from './rf';
import { cryoOcclusion } from './cryo';
import { pvCoord } from './pvGeometry';
import { verticesInRegion } from '../geometry/regions';
import { ABLATION } from '../params';

const afEngine = () => { const e = new SimulationEngine(loadParametricSync('afRemodeled')); afScenario.setupSubstrate(e); return e; };
const isolated = (e: SimulationEngine, pv: 'LSPV' | 'RSPV' | 'LIPV' | 'RIPV') => separated(e.mesh, e.ca.tissue.viability, laBody(e), new Set(sleeveVertices(e, pv)));
/** 通電の時計を進める（エンジンを進めずに、状態機械だけ） */
const runAblation = (e: SimulationEngine, seconds: number) => {
  const steps = Math.ceil((seconds * 1000) / (e.sampleMs * e.ablation.speed));
  for (let i = 0; i < steps && e.ablation.active; i++) e.ablation.step(e.sampleMs);
};

describe('RF の病変モデル（§7）', () => {
  it('出力・時間・接触が大きいほど病変が大きく深い（半径 2〜8 mm）', () => {
    expect(rfRadiusMm(40, 30, 20)).toBeGreaterThan(rfRadiusMm(25, 30, 20));
    expect(rfRadiusMm(30, 40, 20)).toBeGreaterThan(rfRadiusMm(30, 10, 20));
    expect(rfRadiusMm(30, 30, 30)).toBeGreaterThan(rfRadiusMm(30, 30, 5));
    expect(rfRadiusMm(50, 60, 40)).toBeLessThanOrEqual(8);
    expect(rfRadiusMm(25, 10, 5)).toBeGreaterThan(2);
  });

  it('同じ通電でも壁厚 4 mm の CTI では貫壁性に届きにくい（病変指標が小さい）', () => {
    // 30 W・20 秒・10 g（LA では十分、厚い CTI では不足）
    const d = rfDepthMm(rfRadiusMm(30, 20, 10));
    expect(lesionIndexPct(d, ABLATION.wallThicknessMm.la)).toBeGreaterThan(100);
    expect(lesionIndexPct(d, ABLATION.wallThicknessMm.cti)).toBeLessThan(100);
  });

  it('接触圧は押し込むほど大きく、非接触は 0。局所インピーダンスは接触で上がり、病変の形成で下がる', () => {
    expect(contactForceG(3)).toBe(0);
    expect(contactForceG(0.5)).toBeGreaterThan(contactForceG(1.5));
    const blood = localImpedanceOhm(0, 0).value, contact = localImpedanceOhm(30, 0).value, burned = localImpedanceOhm(30, 1);
    expect(contact).toBeGreaterThan(blood);
    expect(burned.value).toBeLessThan(contact);
    expect(burned.drop).toBe(ABLATION.localImpedance.maxDropOhm);
  });
});

describe('通電の状態機械', () => {
  it('RF：先端が接触していなければ始められない。接触して通電すると貫壁性の病変ができ、タグが残る', () => {
    const e = afEngine();
    e.setPlacement('abl', { kind: 'free', point: e.catheter('abl')!.electrodes[0].position, heightMm: 6, rotationDeg: 0 });
    expect(e.ablation.start('rf')).not.toBeNull();
    const spec = e.spec('abl')!;
    if (spec.placement?.kind === 'free') e.setPlacement('abl', { ...spec.placement, heightMm: 1 });
    expect(e.ablation.start('rf')).toBeNull();
    runAblation(e, 40);
    expect(e.ablation.active).toBeNull();
    expect(e.lesions.length).toBe(1);
    expect(e.lesions[0].tags.lesionIndexPct).toBeGreaterThan(100);
    const blocked = Array.from(e.ablation.field.transmurality).filter((t) => t >= 1).length;
    expect(blocked).toBeGreaterThan(5);
  });

  it('浅い病変（貫壁性 < 1）は伝導を遅くするが遮断しない', () => {
    const e = afEngine();
    const v = laBody(e)[100];
    e.ablation.field.raise(v, 0.5);
    expect(e.ca.tissue.viability[v]).toBeCloseTo(1 - ABLATION.partialSlowing * 0.5);
    e.ablation.field.raise(v, 1);
    expect(e.ca.tissue.viability[v]).toBe(0);
    expect(e.ca.tissue.voltage[v]).toBe(0);
  });
});

describe('3 エネルギーで病変の形が違う（同じ LSPV）', () => {
  it('RF は点状、クライオは前庭部の帯、PFA バスケットは口の縁の輪、フラワーは口を覆う円盤', () => {
    const shape = (energy: 'rf' | 'cryo' | 'basket' | 'flower') => {
      const e = afEngine();
      const pv = e.model.anatomy.la.pvs.find((p) => p.name === 'LSPV')!;
      if (energy === 'rf') {
        e.setPlacement('abl', { kind: 'free', point: pv.ostium, heightMm: 1, rotationDeg: 0 });
        e.ablation.start('rf'); runAblation(e, 40);
      } else if (energy === 'cryo') {
        e.ablation.cryo = { ...e.ablation.cryo, pv: 'LSPV', push01: 1, misalignDeg: 0 };
        e.ablation.start('cryo'); runAblation(e, 200);
      } else {
        e.ablation.pfa = { pv: 'LSPV', shape: energy };
        e.ablation.applyPfa(); e.ablation.applyPfa();
      }
      const lesion = Array.from(e.ablation.field.transmurality).map((t, v) => (t >= 1 ? v : -1)).filter((v) => v >= 0);
      const c = lesion.map((v) => pvCoord(e.mesh, pv, v));
      const angles = new Set(c.map((x) => Math.floor(x.angleDeg / 30)));
      return { n: lesion.length, angles: angles.size, maxRadial: Math.max(...c.map((x) => x.radial)), isolated: isolated(e, 'LSPV') };
    };
    const rf = shape('rf'), cryo = shape('cryo'), basket = shape('basket'), flower = shape('flower');
    // RF：一点（一周しない）、隔離しない
    expect(rf.angles).toBeLessThan(12);
    expect(rf.isolated).toBe(false);
    // クライオ・PFA：一周して隔離
    for (const x of [cryo, basket, flower]) { expect(x.angles).toBe(12); expect(x.isolated).toBe(true); }
    // フラワーは口を覆う円盤で、バスケットの輪より広い
    expect(flower.n).toBeGreaterThan(basket.n);
    // クライオの帯は RF の点より広い
    expect(cryo.n).toBeGreaterThan(rf.n * 2);
  }, 120_000);
});

describe('クライオ', () => {
  it('閉塞が十分なら通電中に PV が隔離され、time-to-isolation が出る。閉塞が悪いと隙間が残る', () => {
    expect(cryoOcclusion(1, 0)).toBe(1);
    expect(cryoOcclusion(1, 15)).toBeCloseTo(0.5);
    const good = afEngine();
    good.ablation.cryo = { ...good.ablation.cryo, pv: 'RSPV', push01: 1, misalignDeg: 0 };
    good.ablation.start('cryo'); runAblation(good, 200);
    expect(good.ablation.last!.timeToIsolationS).not.toBeNull();
    expect(good.ablation.last!.timeToIsolationS!).toBeLessThan(180);
    expect(isolated(good, 'RSPV')).toBe(true);
    const poor = afEngine();
    poor.ablation.cryo = { ...poor.ablation.cryo, pv: 'RSPV', push01: 0.6, misalignDeg: 10 };
    poor.ablation.start('cryo'); runAblation(poor, 200);
    expect(poor.ablation.last!.timeToIsolationS).toBeNull();
    expect(isolated(poor, 'RSPV')).toBe(false);
  }, 120_000);
});

describe('PFA', () => {
  it('1 回では浅く（貫壁性 0.5）隔離されず、2 回で隔離される', () => {
    const e = afEngine();
    e.ablation.pfa = { pv: 'LIPV', shape: 'basket' };
    e.ablation.applyPfa();
    expect(isolated(e, 'LIPV')).toBe(false);
    e.ablation.applyPfa();
    expect(isolated(e, 'LIPV')).toBe(true);
    expect(e.lesions.filter((l) => l.energy === 'pfa').map((l) => l.tags.applications)).toEqual([1, 2]);
  });
});

describe('接合部調律', () => {
  it('遅伝導路部位で RF 通電中に周期 500〜700 ms の接合部の興奮が出て、離れた部位では出ない', () => {
    const run = (near: boolean) => {
      const e = new SimulationEngine(loadParametricSync('normal'));
      e.sinusCycleMs = 1500; // 洞調律を遅くして接合部の興奮を見やすくする
      const target = near ? e.model.anatomy.anchors.slowPathway.point : e.query.position(verticesInRegion(e.mesh.regionOfVertex, 'la_posterior')[0]);
      e.setPlacement('abl', { kind: 'free', point: target, heightMm: 1, rotationDeg: 0 });
      e.ablation.speed = 1;
      e.ablation.rf.durationS = 10;
      expect(e.ablation.start('rf')).toBeNull();
      e.tick(3000);
      const fast = e.conduction.exitLog.filter((x) => x.via === 'fast').map((x) => x.time);
      return { fast, junctional: e.ablation.metrics()!.junctional };
    };
    const near = run(true), far = run(false);
    expect(near.junctional).toBe(true);
    expect(near.fast.length).toBeGreaterThanOrEqual(3);
    const iv = near.fast.slice(1).map((t, i) => t - near.fast[i]);
    for (const x of iv) { expect(x).toBeGreaterThanOrEqual(480); expect(x).toBeLessThanOrEqual(720); }
    expect(far.fast.length).toBe(0);
  }, 60_000);
});
