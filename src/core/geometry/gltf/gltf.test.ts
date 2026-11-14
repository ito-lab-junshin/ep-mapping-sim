import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../ChamberLoader';
import { exportModelToGltf, loadGltfModel } from './GltfLoader';
import { parseGltf } from './gltf';
import { SimulationEngine } from '../../sim/SimulationEngine';
import { SCENARIOS } from '../../arrhythmia';
import { tryInduce, verifyCure } from '../../arrhythmia/common';
import { applyStandardAblation } from '../../research/strategies';
import { totalActivationMs } from '../../research/batch';
import { REGIONS, REGION_ID, type RegionName } from '../regions';
import type { BiatrialModel } from '../parametric/atria';
import type { ArrhythmiaId, Vec3 } from '../../types';
import type { LabelFile } from './labels';

const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const roundTrip = (set: 'normal' | 'afRemodeled' | 'aflRemodeled', withLabels = true) => {
  const src = loadParametricSync(set);
  const { glb, labels } = exportModelToGltf(src);
  // JSON 文字列を通す（ファイルに保存して読み戻すのと同じ）
  const lab = JSON.parse(JSON.stringify(labels)) as LabelFile;
  return { src, ...loadGltfModel(glb, withLabels ? lab : undefined, { name: `往復（${set}）` }), glb };
};

describe('glTF：書き出しと読み込み', () => {
  it('GLB は LA・RA の 2 メッシュで、単位はメートル', () => {
    const { glb } = exportModelToGltf(loadParametricSync('normal'));
    const prims = parseGltf(glb);
    expect(prims.map((p) => p.name)).toEqual(['LA', 'RA']);
    const maxAbs = Math.max(...prims.flatMap((p) => Array.from(p.positions, Math.abs)));
    expect(maxAbs).toBeLessThan(0.2);
  });

  it('往復（ラベル JSON あり）：頂点・三角形・領域・目印・開口の縁・連結が一致し、PV の情報もほぼ同じ', () => {
    const { src, model, estimated } = roundTrip('normal');
    expect(estimated).toBe(false);
    const a = src.mesh, b = model.mesh;
    expect(b.positions.length).toBe(a.positions.length);
    let maxD = 0;
    for (let i = 0; i < a.positions.length; i++) maxD = Math.max(maxD, Math.abs(a.positions[i] - b.positions[i]));
    expect(maxD).toBeLessThan(1e-3);
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
    expect(Array.from(b.regionOfVertex)).toEqual(Array.from(a.regionOfVertex));
    expect(b.parts).toEqual(a.parts);
    for (const k of Object.keys(src.anatomy.anchors) as (keyof BiatrialModel['anatomy']['anchors'])[]) {
      expect(model.anatomy.anchors[k].vertex, k).toBe(src.anatomy.anchors[k].vertex);
    }
    // 開口の縁：パラメトリックは開口の面からの距離で選び、glTF は境界の輪そのもの（1〜2 頂点の違いはある）
    for (const k of ['mitral', 'tricuspid', 'csOs', 'ivc'] as const) {
      const A = new Set(src.anatomy.rims[k]), B = new Set(model.anatomy.rims[k]);
      const inter = [...A].filter((v) => B.has(v)).length;
      expect(inter / new Set([...A, ...B]).size, k).toBeGreaterThan(0.85);
    }
    expect(b.bridges!.map((x) => x.pairs)).toEqual(a.bridges!.map((x) => x.pairs));
    expect(model.anatomy.ctiLengthMm).toBeCloseTo(src.anatomy.ctiLengthMm, 3);
    for (const pv of src.anatomy.la.pvs) {
      const q = model.anatomy.la.pvs.find((x) => x.name === pv.name)!;
      expect(d(q.ostium, pv.ostium), pv.name).toBeLessThan(2.5);
      expect(Math.abs(q.radius - pv.radius) / pv.radius, pv.name).toBeLessThan(0.15);
      expect(q.frame.axis.x * pv.frame.axis.x + q.frame.axis.y * pv.frame.axis.y + q.frame.axis.z * pv.frame.axis.z).toBeGreaterThan(0.97);
    }
    for (const o of ['tricuspid', 'svc', 'ivc'] as const) expect(d(model.anatomy.ra[o].center, src.anatomy.ra[o].center), o).toBeLessThan(2);
    // CS 口：パラメトリックは切断面の軸上の点、glTF は穴の縁の重心（切断面が壁に斜めなので 6 mm ほどずれる）
    expect(d(model.anatomy.ra.csOs.center, src.anatomy.ra.csOs.center)).toBeLessThan(7);
    expect(d(model.anatomy.la.mitral.center, src.anatomy.la.mitral.center)).toBeLessThan(3);
    expect(d(model.anatomy.la.center, src.anatomy.la.center)).toBeLessThan(5);
  });

  it('往復したモデルでも洞調律の両心房の総興奮時間は同じ（±5 %）', () => {
    const { src, model } = roundTrip('normal');
    const a = totalActivationMs(new SimulationEngine(src)), b = totalActivationMs(new SimulationEngine(model));
    expect(Math.abs(b - a) / a).toBeLessThan(0.05);
  });

  const cases: [ArrhythmiaId, 'normal' | 'afRemodeled' | 'aflRemodeled', Parameters<typeof applyStandardAblation>[2], object][] = [
    ['avnrt', 'normal', { energy: 'rf' }, { s1Beats: 4, s2StartMs: 360, observeMs: 1200 }],
    ['wpw', 'normal', { energy: 'rf' }, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 }],
    ['afl_cti', 'aflRemodeled', { energy: 'rf', powerW: 40, durationS: 45 }, { observeMs: 1000 }],
    ['af', 'afRemodeled', { energy: 'pfa', shape: 'basket', applications: 2 }, {}],
  ];
  for (const [id, set, plan, induction] of cases) {
    it(`往復したモデルで ${id}：誘発 → 標準の通電で根治`, () => {
      const { model } = roundTrip(set);
      const sc = SCENARIOS[id];
      const e = new SimulationEngine(model);
      sc.setupSubstrate(e);
      expect(tryInduce(e, sc, induction).induced).toBe(true);
      applyStandardAblation(e, id, plan);
      if (id === 'wpw') e.tick(2500);
      const checks = verifyCure(e, sc, induction);
      expect(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok))).toBe(true);
    }, 300_000);
  }
});

describe('glTF：領域ラベルの半自動推定', () => {
  const keyRegions: RegionName[] = ['lspv_sleeve', 'lipv_sleeve', 'rspv_sleeve', 'ripv_sleeve', 'mitral_annulus', 'tricuspid_annulus', 'cti', 'cs_os', 'svc', 'ivc'];

  it('ラベルなし：開口から PV・弁輪・CS 口・大静脈・CTI を推定し（主要な領域の 80 % 以上、CTI は 65 %・CS 口は 55 % 以上が一致）、目印は 6 mm（洞結節は 8 mm）以内', () => {
    const { src, model, estimated } = roundTrip('normal', false);
    expect(estimated).toBe(true);
    for (const r of keyRegions) {
      const truth = Array.from(src.mesh.regionOfVertex).map((x, v) => (x === REGION_ID[r] ? v : -1)).filter((v) => v >= 0);
      const hit = truth.filter((v) => model.mesh.regionOfVertex[v] === REGION_ID[r]).length;
      // CTI は IVC の付け根の推定が 3〜4 mm 深くなるため、CS 口の帯は縁の半径（4.7 mm）がパラメトリックの公称値（6 mm）より
      // 小さいため一致が下がる。CS 口の帯を広げると CTI を削ってしまうので広げない（JSON での手直しを前提とする）
      const min = r === 'cti' ? 0.65 : r === 'cs_os' ? 0.55 : 0.8;
      expect(hit / truth.length, `${r} ${hit}/${truth.length}`).toBeGreaterThan(min);
    }
    // 洞結節は RA の中心から見た向きで決めるため、中心の推定（範囲の中点）のずれが効いて 8 mm まで許す
    for (const k of ['his', 'slowPathway', 'avNode', 'csOs', 'ctiTv', 'ctiIvc', 'sinusNode'] as const) {
      expect(d(model.anatomy.anchors[k].point, src.anatomy.anchors[k].point), k).toBeLessThan(k === 'sinusNode' ? 8 : 6);
    }
  });

  it('ラベルなしで推定したモデルでも AFL（反時計回り）が誘発でき、CTI の線で根治する', () => {
    const { model } = roundTrip('aflRemodeled', false);
    const sc = SCENARIOS.afl_cti;
    const e = new SimulationEngine(model);
    sc.setupSubstrate(e);
    expect(tryInduce(e, sc, { observeMs: 1000 }).induced).toBe(true);
    applyStandardAblation(e, 'afl_cti', { energy: 'rf', powerW: 40, durationS: 45 });
    expect(verifyCure(e, sc, { observeMs: 1000 }).every((c) => c.ok)).toBe(true);
  }, 300_000);

  it('JSON の一部の指定（頂点 index → 領域名）が推定を上書きする。知らない領域名はエラー', () => {
    const src = loadParametricSync('normal');
    const { glb } = exportModelToGltf(src);
    const laa = Array.from(src.mesh.regionOfVertex).map((x, v) => (x === REGION_ID.laa ? v : -1)).filter((v) => v >= 0);
    const labels: LabelFile = { format: 'ep-mapping-sim/labels', version: 1, regions: Object.fromEntries(laa.map((v) => [String(v), 'laa' as RegionName])) };
    const { model, estimated } = loadGltfModel(glb, labels);
    expect(estimated).toBe(true);
    expect(laa.every((v) => model.mesh.regionOfVertex[v] === REGION_ID.laa)).toBe(true);
    expect(() => loadGltfModel(glb, { format: 'ep-mapping-sim/labels', version: 1, regions: { '0': 'nowhere' as RegionName } })).toThrow();
    void REGIONS;
  });
});
