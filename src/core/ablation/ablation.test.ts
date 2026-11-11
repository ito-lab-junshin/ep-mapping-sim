import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { afScenario, laBody, sleeveVertices } from '../arrhythmia/af';
import { separated } from '../arrhythmia/common';
import { contactForceG, lesionIndexPct, localImpedanceOhm, rfDoseRate, rfLesion } from './rf';
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

describe('RF の病変モデル（§7、臨床経験に基づく教育用近似）', () => {
  /** 指標 100 % に達するまでの秒数（一定の出力・接触圧） */
  const timeTo100 = (p: number, cf: number, target: 'posterior' | 'anterior') => ABLATION.rf.targetRefS[target] / rfDoseRate(p, cf);

  it('30 W・20 g で後壁の目標に約 30 秒、前壁の目標に約 40 秒。接触圧 27 g なら速く、10 g なら遅い', () => {
    expect(timeTo100(30, 20, 'posterior')).toBeCloseTo(30, 5);
    expect(timeTo100(30, 20, 'anterior')).toBeCloseTo(40, 5);
    expect(lesionIndexPct(rfLesion(30, 20, 30).dose, 'posterior')).toBeCloseTo(100, 5);
    expect(timeTo100(30, 27, 'posterior')).toBeLessThan(28);
    expect(timeTo100(30, 10, 'posterior')).toBeGreaterThan(40);
    expect(timeTo100(40, 20, 'posterior')).toBeLessThan(25);
  });

  it('指標 100 % の病変は径 6〜8 mm・深さ 3〜4 mm で、LA（2 mm）は貫壁、CTI の弁輪側（5 mm）は未貫壁', () => {
    for (const [t, target] of [[30, 'posterior'], [40, 'anterior']] as const) {
      const l = rfLesion(30, 20, t);
      expect(lesionIndexPct(l.dose, target)).toBeCloseTo(100, 5);
      expect(l.depthMm).toBeGreaterThanOrEqual(3); expect(l.depthMm).toBeLessThanOrEqual(4);
      expect(2 * l.radiusMm).toBeGreaterThanOrEqual(6); expect(2 * l.radiusMm).toBeLessThanOrEqual(8);
      expect(l.depthMm).toBeGreaterThan(ABLATION.wallThicknessMm.la);
      expect(l.depthMm).toBeLessThan(ABLATION.wallThicknessMm.ctiTv);
    }
  });

  it('病変は時間に対して飽和する：指標 180 % でも深さは 1.8 倍にならない', () => {
    const at100 = rfLesion(30, 20, 30), at180 = rfLesion(30, 20, 54);
    expect(lesionIndexPct(at180.dose, 'posterior')).toBeCloseTo(180, 5);
    expect(at180.depthMm / at100.depthMm).toBeLessThan(1.5);
    expect(rfLesion(50, 40, 600).depthMm).toBeLessThanOrEqual(ABLATION.rf.saturationDepthMm);
  });

  it('CTI の弁輪側（5 mm）は 30 W・20 g では 60 秒でも貫壁しにくく、40 W か接触圧を上げた長時間通電で貫壁する', () => {
    const tv = ABLATION.wallThicknessMm.ctiTv, ivc = ABLATION.wallThicknessMm.ctiIvc;
    expect(rfLesion(30, 20, 30).depthMm).toBeLessThan(ivc);  // 30 秒では IVC 側も未貫壁
    expect(rfLesion(30, 20, 40).depthMm).toBeGreaterThan(ivc); // 40 秒で IVC 側は貫壁
    expect(rfLesion(30, 20, 60).depthMm).toBeLessThan(tv);
    expect(rfLesion(40, 20, 45).depthMm).toBeGreaterThan(tv);
    expect(rfLesion(30, 30, 60).depthMm).toBeGreaterThan(tv);
  });

  it('接触圧は押し込むほど大きく、非接触は 0（病変は育たない）。局所インピーダンスは接触で上がり、病変の形成で下がる', () => {
    expect(contactForceG(3)).toBe(0);
    expect(rfDoseRate(30, 0)).toBe(0);
    expect(contactForceG(0.5)).toBeGreaterThan(contactForceG(1.5));
    const blood = localImpedanceOhm(0, 0).value, contact = localImpedanceOhm(30, 0).value, burned = localImpedanceOhm(30, 1);
    expect(contact).toBeGreaterThan(blood);
    expect(burned.value).toBeLessThan(contact);
    expect(burned.drop).toBe(ABLATION.localImpedance.maxDropOhm);
  });
});

describe('部位の性質（壁厚・目標の区分）', () => {
  it('CTI の壁厚は三尖弁輪側 5 mm から IVC 側 3.5 mm へ薄くなり、LA の後壁は後壁の目標、天蓋は前壁の目標', () => {
    const e = new SimulationEngine(loadParametricSync('aflRemodeled'));
    const s = e.ablation.sites, a = e.model.anatomy.anchors;
    const near = (pt: { x: number; y: number; z: number }) => e.query.closestPoint(pt, verticesInRegion(e.mesh.regionOfVertex, 'cti')).vertex;
    expect(s.wallMm[near(a.ctiTv.point)]).toBeGreaterThan(4.6);
    expect(s.wallMm[near(a.ctiIvc.point)]).toBeLessThan(3.9);
    const post = verticesInRegion(e.mesh.regionOfVertex, 'la_posterior'), roof = verticesInRegion(e.mesh.regionOfVertex, 'la_roof');
    expect(post.filter((v) => s.target[v] === 'posterior').length / post.length).toBeGreaterThan(0.9);
    expect(roof.every((v) => s.target[v] === 'anterior')).toBe(true);
    expect(s.target[a.slowPathway.vertex]).toBe('posterior');
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
    expect(e.lesions[0].tags.lesionIndexPct).toBeGreaterThan(50);
    expect(e.lesions[0].tags.transmuralityPct).toBe(100);
    expect(e.lesions[0].transmurality).toBe(1);
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
