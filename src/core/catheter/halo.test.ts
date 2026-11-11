import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { aflCtiScenario } from '../arrhythmia/aflCti';
import { afScenario, laBody, sleeveVertices } from '../arrhythmia/af';
import { tryInduce } from '../arrhythmia/common';
import { REGIONS } from '../geometry/regions';
import type { PacingSite } from '../sim/SimulationEngine';

describe('ハロー 20 極（三尖弁輪）', () => {
  const afl = () => { const e = new SimulationEngine(loadParametricSync('aflRemodeled')); aflCtiScenario.setupSubstrate(e); return e; };

  it('AFL の症例では三尖弁輪に沿って置かれ、ほぼすべての電極が弁輪（遠位は CTI の側壁側）に接触する。ほかの症例では置かれない', () => {
    const e = afl();
    const h = e.catheter('halo')!;
    expect(h.placed).toBe(true);
    const regions = h.electrodes.map((x) => REGIONS[e.mesh.regionOfVertex[e.query.closestPoint(x.position).vertex]]);
    expect(h.electrodes.filter((x) => x.contactVertex >= 0).length).toBeGreaterThanOrEqual(18);
    expect(regions.filter((r) => r === 'tricuspid_annulus' || r === 'cti').length).toBeGreaterThanOrEqual(18);
    expect(e.channels.filter((c) => c.group === 'halo').map((c) => c.id)[0]).toBe('H 19-20');
    const normal = new SimulationEngine(loadParametricSync('normal'));
    expect(normal.catheter('halo')!.placed).toBe(false);
  });

  /** 頻拍中の 1 周期で、CS 口の興奮を基準にした各電極の最初の興奮時刻 */
  const haloTimes = (site: PacingSite) => {
    const r = tryInduce(afl(), aflCtiScenario, { site, observeMs: 1000 });
    expect(r.induced, site).toBe(true);
    const e = r.engine, cl = e.rhythm.currentCycleLength(e.time)!;
    const csOs = e.model.anatomy.anchors.csOs.vertex;
    const v = e.catheter('halo')!.electrodes.map((x) => e.query.closestPoint(x.position).vertex);
    const t0 = e.time, first = new Map<number, number>();
    let tcs = -1;
    for (let i = 0; i < Math.ceil((2 * cl) / e.sampleMs); i++) {
      e.stepOnce();
      if (tcs < 0 && e.ca.tissue.lastActivation[csOs] > t0) tcs = e.ca.tissue.lastActivation[csOs];
      if (tcs >= 0) v.forEach((x, k) => { const la = e.ca.tissue.lastActivation[x]; if (!first.has(k) && la >= tcs) first.set(k, la - tcs); });
    }
    return [0, 4, 8, 12, 16, 19].map((k) => first.get(k)!);
  };

  it('CS 口からのバースト：反時計回り（側壁を下行：H 19-20 → H 1-2 の順）', () => {
    const t = haloTimes('CS_OS');
    for (let i = 1; i < t.length; i++) expect(t[i], t.join(' ')).toBeLessThan(t[i - 1]);
  }, 300_000);

  it('低位外側 RA からのバースト：時計回り（側壁を上行：H 1-2 → H 19-20 の順）', () => {
    const t = haloTimes('LOW_LATERAL_RA');
    for (let i = 1; i < t.length; i++) expect(t[i], t.join(' ')).toBeGreaterThan(t[i - 1]);
  }, 300_000);
});

describe('環状カテーテルからの刺激（exit block の確認）', () => {
  const af = () => { const e = new SimulationEngine(loadParametricSync('afRemodeled')); afScenario.setupSubstrate(e); e.foci.length = 0; e.sinusEnabled = false; return e; };
  const inPv = (e: SimulationEngine) => {
    const pv = e.model.anatomy.la.pvs.find((p) => p.name === 'LSPV')!;
    const f = pv.frame;
    // PV の中（口から 6 mm 奥）に、環状カテーテルを PV の太さに合わせて置く
    const c = { x: pv.ostium.x + f.axis.x * 6, y: pv.ostium.y + f.axis.y * 6, z: pv.ostium.z + f.axis.z * 6 };
    e.setPlacement('circ', { kind: 'free', point: c, heightMm: 1, rotationDeg: 0, diameterMm: 15 });
  };
  const paceAndSee = (e: SimulationEngine) => {
    const t0 = e.time;
    e.pace('CIRC', [t0 + 10]);
    e.tick(300);
    const body = laBody(e).filter((_, i) => i % 50 === 0);
    const sleeve = sleeveVertices(e, 'LSPV');
    return {
      laCaptured: body.some((v) => e.ca.tissue.lastActivation[v] > t0),
      sleeveCaptured: sleeve.some((v) => e.ca.tissue.lastActivation[v] > t0),
    };
  };

  it('隔離前：PV 内から刺激すると LA に伝わる', () => {
    const e = af(); inPv(e);
    expect(e.catheter('circ')!.electrodes[0].contactVertex).toBeGreaterThanOrEqual(0);
    const r = paceAndSee(e);
    expect(r.sleeveCaptured).toBe(true);
    expect(r.laCaptured).toBe(true);
  });

  it('隔離後：PV 内は局所で捕捉されるが LA に伝わらない（exit block）', () => {
    const e = af(); inPv(e);
    e.ablation.pfa = { pv: 'LSPV', shape: 'flower' };
    e.ablation.applyPfa(); e.ablation.applyPfa();
    const r = paceAndSee(e);
    expect(r.sleeveCaptured).toBe(true);
    expect(r.laCaptured).toBe(false);
  });

  it('電極が壁に接触していなければ捕捉しない', () => {
    const e = af(); inPv(e);
    const p = e.spec('circ')!.placement!;
    if (p.kind === 'free') e.setPlacement('circ', { ...p, diameterMm: 15, heightMm: 8 });
    expect(e.siteTarget('CIRC').kind).toBe('none');
    const r = paceAndSee(e);
    expect(r.sleeveCaptured).toBe(false);
    expect(r.laCaptured).toBe(false);
  });
});
