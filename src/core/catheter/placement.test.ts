import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { MeshQuery } from '../geometry/MeshQuery';
import { buildGuidedPaths, nearestS, pointAt } from './guidedPaths';
import { placeFree, placeOnPath } from './placement';
import { ablationOffsetsMm, laBodyPointTowards } from './catalog';
import { CIRCULAR, CONTACT_THRESHOLD_MM, SPACING_MM } from '../params';
import { PV_SLEEVE, REGIONS, verticesInRegion } from '../geometry/regions';
import { dist, scale } from '../geometry/parametric/sdf';

const model = loadParametricSync('normal');
const q = new MeshQuery(model.mesh);
const paths = buildGuidedPaths(model, q);
const at = (v: number) => q.position(v);

describe('経路カテーテル（CS・His・HRA）', () => {
  it('CS：電極はすべて経路上にあり、近位は CS 口、遠位は僧帽弁輪の側壁寄り', () => {
    const es = placeOnPath(q, paths.cs, SPACING_MM.cs_decapolar, { s: paths.cs.defaultS, heightMm: 0 });
    for (const e of es) expect(dist(e.position, pointAt(paths.cs, nearestS(paths.cs, e.position)))).toBeLessThan(0.01);
    const os = model.anatomy.ra.csOs.center;
    expect(dist(es[9].position, os)).toBeLessThan(dist(es[0].position, os));
    // 大半の電極は LA の心外膜側 2 mm 以内（局所の LA 電位を記録できる）
    expect(es.filter((e) => e.heightMm <= CONTACT_THRESHOLD_MM).length).toBeGreaterThanOrEqual(7);
  });

  it('His：遠位電極は His 部位の近く、近位電極は弁輪から心房中隔側へ並ぶ', () => {
    const away = scale(model.anatomy.ra.tricuspid.axis, -1);
    const es = placeOnPath(q, paths.his, SPACING_MM.quadripolar, { s: 0, heightMm: 1 }, away);
    expect(dist(es[0].position, model.anatomy.anchors.his.point)).toBeLessThan(6);
    for (const e of es) expect(e.contactVertex).toBeGreaterThanOrEqual(0);
  });

  it('HRA：押し込み量 1 mm で接触、6 mm で非接触', () => {
    const near = placeOnPath(q, paths.hra, SPACING_MM.quadripolar, { s: paths.hra.defaultS, heightMm: 1 });
    const far = placeOnPath(q, paths.hra, SPACING_MM.quadripolar, { s: paths.hra.defaultS, heightMm: 6 });
    for (const e of near) expect(e.contactVertex).toBeGreaterThanOrEqual(0);
    for (const e of far) expect(e.contactVertex).toBe(-1);
  });
});

describe('自由配置カテーテル（ABL・環状・多極）', () => {
  const lateral = laBodyPointTowards(model, { x: 1, y: -0.35, z: 0 });

  it('ABL：先端だけ接触し、表面から外れない', () => {
    const es = placeFree(q, model, 'ablation_tip', { point: lateral, heightMm: 1, rotationDeg: 0 }, ablationOffsetsMm());
    expect(es[0].contactVertex).toBeGreaterThanOrEqual(0);
    expect(es[0].heightMm).toBeCloseTo(1, 0);
    expect(es[3].contactVertex).toBe(-1);
  });

  it('環状：PV 内に置くと PV を一周し、径が PV より小さいと非接触になる', () => {
    const sleeve = verticesInRegion(model.mesh.regionOfVertex, PV_SLEEVE.LSPV);
    const point = at(sleeve[Math.floor(sleeve.length / 2)]);
    const big = placeFree(q, model, 'circular_mapping', { point, heightMm: 0.5, rotationDeg: 0, diameterMm: 25 }, []);
    expect(big.length).toBe(CIRCULAR.electrodes);
    expect(big.filter((e) => e.contactVertex >= 0).length).toBeGreaterThanOrEqual(8);
    for (const e of big.filter((x) => x.contactVertex >= 0)) {
      const r = REGIONS[model.mesh.regionOfVertex[e.contactVertex]];
      expect(['lspv_sleeve', 'lspv_ostium']).toContain(r);
    }
    const small = placeFree(q, model, 'circular_mapping', { point, heightMm: 0.5, rotationDeg: 0, diameterMm: 6 }, []);
    expect(small.every((e) => e.contactVertex < 0)).toBe(true);
  });

  it('多極スプライン・グリッド：開口から離れた壁（LA 後壁）に広げると、押し込めば全電極が接触する', () => {
    const posterior = laBodyPointTowards(model, { x: 0.3, y: 0.2, z: -1 });
    for (const kind of ['multispline', 'grid'] as const) {
      const es = placeFree(q, model, kind, { point: posterior, heightMm: 1, rotationDeg: 0 }, []);
      expect(es.every((e) => e.contactVertex >= 0), kind).toBe(true);
      const lifted = placeFree(q, model, kind, { point: posterior, heightMm: 5, rotationDeg: 0 }, []);
      expect(lifted.every((e) => e.contactVertex < 0), kind).toBe(true);
    }
  });
});

describe('既定配置', () => {
  it('ABL の既定位置は LA 本体の側壁で、先端だけが接触する', async () => {
    const { defaultCatheters } = await import('./catalog');
    const abl = defaultCatheters(model).find((s) => s.catheter.id === 'abl')!;
    const p = abl.placement!;
    if (p.kind !== 'free') throw new Error('abl must be free');
    const es = placeFree(q, model, 'ablation_tip', p, ablationOffsetsMm());
    expect(es.map((e) => e.contactVertex >= 0)).toEqual([true, false, false, false]);
  });
});

describe('開口（弁輪）にかかる配置', () => {
  it('僧帽弁輪の縁に置いた多極・グリッドの電極は重ならず、開口の上の電極は非接触になる', () => {
    const rimV = model.anatomy.rims.mitral[0];
    const point = q.position(rimV);
    for (const kind of ['multispline', 'grid'] as const) {
      const es = placeFree(q, model, kind, { point, heightMm: 1, rotationDeg: 0 }, []);
      // どの 2 電極も 0.5 mm 以上離れている
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
        expect(dist(es[i].position, es[j].position), `${kind} ${i}-${j}`).toBeGreaterThan(0.5);
      }
      expect(es.some((e) => e.contactVertex < 0), kind).toBe(true);
    }
  });
});
