import { describe, it, expect } from 'vitest';
import { buildBiatrialModel } from './atria';
import { boundaryEdgeVertices } from './meshOps';
import { REGIONS, REGION_ID, PV_NAMES, PV_OSTIUM, PV_SLEEVE, verticesInRegion, type RegionName } from '../regions';
import { CellularAutomaton } from '../../propagation/CellularAutomaton';
import { AFL_CTI_MIN_MM, CTI_LENGTH_RANGE_MM, DIMENSION_SETS } from './dimensions';
import { dot, sub, v3 } from './sdf';

const normal = buildBiatrialModel('normal');
const af = buildBiatrialModel('afRemodeled');
const { mesh, anatomy } = normal;
const P = (m: typeof mesh, v: number) => v3(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);

describe('パラメトリック両心房メッシュ', () => {
  it('すべての領域ラベルに頂点がある', () => {
    for (const r of REGIONS) expect(verticesInRegion(mesh.regionOfVertex, r).length, r).toBeGreaterThan(0);
  });

  it('辺の長さがほぼ均一（中央値 1.5〜2.5 mm、最大 < 4 mm）', () => {
    const p = mesh.positions, idx = mesh.indices;
    const el: number[] = [];
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      el.push(Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]));
    }
    el.sort((x, y) => x - y);
    expect(el[el.length >> 1]).toBeGreaterThan(1.5);
    expect(el[el.length >> 1]).toBeLessThan(2.5);
    expect(el[el.length - 1]).toBeLessThan(4);
  });

  it('穴は弁輪・静脈の端・CS 口にだけある', () => {
    const allowed: RegionName[] = [...Object.values(PV_SLEEVE), 'mitral_annulus', 'tricuspid_annulus', 'cs_os', 'svc', 'ivc', 'his_region', 'av_node', 'slow_pathway', 'cti'];
    const ids = new Set(allowed.map((r) => REGION_ID[r]));
    const b = boundaryEdgeVertices({ positions: mesh.positions, indices: mesh.indices });
    for (const v of b) expect(ids.has(mesh.regionOfVertex[v]), REGIONS[mesh.regionOfVertex[v]]).toBe(true);
  });

  it('LA と RA は互いに食い込まない（最短距離 > 2 mm）', () => {
    const [la, ra] = mesh.parts!;
    let min = Infinity;
    for (let a = la.vertexStart; a < la.vertexStart + la.vertexCount; a += 3) {
      for (let b = ra.vertexStart; b < ra.vertexStart + ra.vertexCount; b += 3) {
        const d = Math.hypot(mesh.positions[3 * a] - mesh.positions[3 * b], mesh.positions[3 * a + 1] - mesh.positions[3 * b + 1], mesh.positions[3 * a + 2] - mesh.positions[3 * b + 2]);
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThan(2);
  });

  it('CTI 長が目安の範囲に入る', () => {
    expect(anatomy.ctiLengthMm).toBeGreaterThan(CTI_LENGTH_RANGE_MM[0]);
    expect(anatomy.ctiLengthMm).toBeLessThan(CTI_LENGTH_RANGE_MM[1]);
  });

  it('Koch 三角：His 部位は三尖弁輪の縁、遅伝導路部位は CS 口と三尖弁輪の間', () => {
    const his = anatomy.anchors.his.point, slow = anatomy.anchors.slowPathway.point, cs = anatomy.ra.csOs.center;
    const d = (a: typeof his, b: typeof his) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(d(slow, cs)).toBeLessThan(d(his, cs));
    // 房室結節は His 部位と CS 口の間
    const av = anatomy.anchors.avNode.point;
    expect(d(av, cs)).toBeLessThan(d(his, cs));
    expect(d(av, his)).toBeLessThan(d(his, cs));
  });
});

/** PV スリーブの中ほどの断面の上下径・前後径 */
function sleeveSection(model: typeof normal, name: (typeof PV_NAMES)[number]) {
  const pv = model.anatomy.la.pvs.find((p) => p.name === name)!;
  const vs = verticesInRegion(model.mesh.regionOfVertex, PV_SLEEVE[name]).map((v) => P(model.mesh, v))
    .filter((p) => Math.abs(dot(sub(p, pv.ostium), pv.frame.axis) - 8) < 1.5);
  const span = (dir: typeof pv.frame.u) => {
    const s = vs.map((p) => dot(sub(p, pv.ostium), dir));
    return Math.max(...s) - Math.min(...s);
  };
  return { si: span(pv.frame.u), ap: span(pv.frame.v) };
}

describe('PV 口と寸法セット', () => {
  it('PV は 4 本が別々に開口し、断面は上下径が長軸の楕円で、寸法表の値に近い', () => {
    for (const name of PV_NAMES) {
      const s = sleeveSection(normal, name);
      const target = DIMENSION_SETS.normal.pv[name];
      expect(s.si, name).toBeGreaterThan(s.ap);
      expect(Math.abs(s.si - target.si) / target.si, name).toBeLessThan(0.2);
      expect(Math.abs(s.ap - target.ap) / target.ap, name).toBeLessThan(0.25);
    }
  });

  it('AF リモデリングでは PV 口と LA 前後径が大きい', () => {
    for (const name of PV_NAMES) expect(sleeveSection(af, name).si).toBeGreaterThan(sleeveSection(normal, name).si);
    const apSpan = (model: typeof normal) => {
      const la = model.mesh.parts![0];
      let lo = Infinity, hi = -Infinity;
      for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
        const r = REGIONS[model.mesh.regionOfVertex[v]];
        if (r.includes('pv') || r === 'laa') continue;
        const z = model.mesh.positions[3 * v + 2];
        lo = Math.min(lo, z); hi = Math.max(hi, z);
      }
      return hi - lo;
    };
    expect(apSpan(af) - apSpan(normal)).toBeGreaterThan(4);
  });
});

describe('両心房の伝播', () => {
  it('洞結節を刺激すると、心房間の連結を通って両心房のすべての頂点に興奮が届く', () => {
    const ca = new CellularAutomaton(mesh);
    ca.stimulate(anatomy.anchors.sinusNode.vertex);
    for (let i = 0; i < 200; i++) ca.step(2);
    const n = mesh.positions.length / 3;
    let reached = 0;
    for (let v = 0; v < n; v++) if (ca.tissue.lastActivation[v] >= 0) reached++;
    expect(reached).toBe(n);
  });

  it('LA の興奮は心房間の連結で決まる：最早の入り口の連結を切ると LA の最早興奮が遅れ、すべて切ると LA は興奮しない', () => {
    const la = mesh.parts![0];
    const run = (keep: (name: string) => boolean) => {
      const m = { ...mesh, bridges: mesh.bridges!.filter((b) => keep(b.name)) };
      const ca = new CellularAutomaton(m);
      ca.stimulate(anatomy.anchors.sinusNode.vertex);
      for (let i = 0; i < 200; i++) ca.step(2);
      let first = Infinity, at = -1;
      for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
        const t = ca.tissue.lastActivation[v];
        if (t >= 0 && t < first) { first = t; at = v; }
      }
      return { first, at };
    };
    const all = run(() => true);
    // 最早に興奮した LA の頂点に最も近い連結（= 最早の入り口）
    const P = (v: number) => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]];
    const d = (a: number, b: number) => Math.hypot(...P(a).map((x, k) => x - P(b)[k]));
    const entry = mesh.bridges!.reduce((best, b) => {
      const dist = Math.min(...b.pairs.map(([, lv]) => d(lv, all.at)));
      return dist < best.dist ? { name: b.name, dist } : best;
    }, { name: '', dist: Infinity }).name;
    expect(run((n) => n !== entry).first).toBeGreaterThan(all.first);
    expect(run(() => false).first).toBe(Infinity);
  });

  it('PV 口を一周する病変があると PV スリーブに興奮が入らない（隔離）', () => {
    const ca = new CellularAutomaton(mesh);
    for (const v of verticesInRegion(mesh.regionOfVertex, PV_OSTIUM.LSPV)) ca.tissue.viability[v] = 0;
    ca.stimulate(anatomy.anchors.sinusNode.vertex);
    for (let i = 0; i < 200; i++) ca.step(2);
    const sleeve = verticesInRegion(mesh.regionOfVertex, PV_SLEEVE.LSPV);
    expect(sleeve.every((v) => ca.tissue.lastActivation[v] < 0)).toBe(true);
    // 他の PV には届く
    const other = verticesInRegion(mesh.regionOfVertex, PV_SLEEVE.RSPV);
    expect(other.every((v) => ca.tissue.lastActivation[v] >= 0)).toBe(true);
  });
});

describe('AFL 用の拡大した RA（aflRemodeled）', () => {
  const afl = buildBiatrialModel('aflRemodeled');
  it('RA と三尖弁輪が normal より大きく、LA と食い込まず、CTI 長が目安の範囲', () => {
    const raCount = (m: typeof normal) => m.mesh.parts![1].vertexCount;
    expect(raCount(afl)).toBeGreaterThan(raCount(normal));
    expect(afl.anatomy.ra.tricuspid.radius).toBeGreaterThan(normal.anatomy.ra.tricuspid.radius);
    const [la, ra] = afl.mesh.parts!;
    let min = Infinity;
    for (let a = la.vertexStart; a < la.vertexStart + la.vertexCount; a += 3) {
      for (let b = ra.vertexStart; b < ra.vertexStart + ra.vertexCount; b += 3) {
        const d = Math.hypot(afl.mesh.positions[3 * a] - afl.mesh.positions[3 * b], afl.mesh.positions[3 * a + 1] - afl.mesh.positions[3 * b + 1], afl.mesh.positions[3 * a + 2] - afl.mesh.positions[3 * b + 2]);
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThan(2);
    expect(afl.anatomy.ctiLengthMm).toBeGreaterThanOrEqual(AFL_CTI_MIN_MM);
    expect(afl.anatomy.ctiLengthMm).toBeLessThan(CTI_LENGTH_RANGE_MM[1]);
  });

  it('分界稜（SVC → IVC）と Eustachian 稜（IVC → CS 口）の線と領域がある', () => {
    expect(afl.anatomy.lines.crista.length).toBeGreaterThan(5);
    expect(afl.anatomy.lines.eustachian.length).toBeGreaterThan(5);
    expect(verticesInRegion(afl.mesh.regionOfVertex, 'eustachian_ridge').length).toBeGreaterThan(0);
  });
});

describe('右心耳（RAA）', () => {
  it('3 つの寸法セットすべてに右心耳があり、三尖弁輪・SVC の開口と重ならない', () => {
    for (const m of [normal, af, buildBiatrialModel('aflRemodeled')]) {
      const raa = verticesInRegion(m.mesh.regionOfVertex, 'raa');
      expect(raa.length).toBeGreaterThan(100);
      const b = boundaryEdgeVertices({ positions: m.mesh.positions, indices: m.mesh.indices });
      expect(raa.filter((v) => b.has(v)).length).toBe(0);
    }
  });
});
