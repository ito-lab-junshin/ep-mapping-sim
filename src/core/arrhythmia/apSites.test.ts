import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { AP_SITE_IDS, ANTEROSEPTAL_MIN_HIS_MM, wpwScenario, apSiteOf } from './wpw';
import { scenarioInduction } from './index';
import { tryInduce, verifyCure } from './common';
import { distance } from '../learning/conditions';
import { ABLATION, ACCESSORY_PATHWAY, type ApSite } from '../params';
import type { Vec3 } from '../types';

/** 副伝導路の部位（§5.4：左側自由壁・右側自由壁・後中隔・前中隔） */
const make = (site: ApSite) => {
  const e = new SimulationEngine(loadParametricSync('normal'));
  wpwScenario.setupSubstrate(e, { apSite: site });
  return e;
};
const PROTOCOL = { s1Beats: 4, s2StartMs: 300, observeMs: 1200 };
const finish = (e: SimulationEngine) => { e.ablation.speed = 250; while (e.ablation.active) e.ablation.step(e.sampleMs); };
const rf = (e: SimulationEngine, point: Vec3) => {
  e.setPlacement('abl', { kind: 'free', point, heightMm: 1, rotationDeg: 0 });
  e.ablation.rf = { powerW: 30, durationS: 30 };
  expect(e.ablation.start('rf')).toBeNull();
  e.ablation.step(e.sampleMs);
  const m = e.ablation.metrics();
  finish(e);
  return m;
};

describe('副伝導路の部位：付着部と選択肢', () => {
  it('部位の既定は左側自由壁、未知の値も左側自由壁', () => {
    expect(apSiteOf(undefined)).toBe('leftFreeWall');
    expect(apSiteOf({ apSite: 'xx' as ApSite })).toBe('leftFreeWall');
    expect(make('leftFreeWall').conduction.ap!.site).toBe('leftFreeWall');
  });

  it('付着部：左側自由壁は僧帽弁輪、ほかは三尖弁輪。後中隔は CS 口に、前中隔は His 束に最も近い', () => {
    const lf = make('leftFreeWall'), rfw = make('rightFreeWall'), ps = make('posteroseptal'), as = make('anteroseptal');
    const rims = lf.model.anatomy.rims;
    expect(lf.conduction.ap!.vertices.every((v) => rims.mitral.includes(v))).toBe(true);
    for (const e of [rfw, ps, as]) expect(e.conduction.ap!.vertices.every((v) => rims.tricuspid.includes(v))).toBe(true);
    const x = (e: SimulationEngine) => e.query.position(e.conduction.ap!.vertices[0]).x;
    // 右側自由壁は三尖弁輪の最も右（−x）
    expect(x(rfw)).toBeLessThanOrEqual(Math.min(...rims.tricuspid.map((v) => rfw.query.position(v).x)) + 1e-6);
    const cs = ps.model.anatomy.ra.csOs.center, his = as.model.anatomy.anchors.his.point;
    const d = (e: SimulationEngine, q: Vec3) => Math.min(...e.conduction.ap!.vertices.map((v) => distance(e.query.position(v), q)));
    expect(d(ps, cs)).toBeLessThan(d(as, cs));
    expect(d(as, his)).toBeLessThan(d(ps, his));
    // 前中隔は His 束から少し離すが、付着部で通電すると His 近傍の警告が出る距離
    expect(d(as, his)).toBeGreaterThanOrEqual(ANTEROSEPTAL_MIN_HIS_MM);
    expect(d(as, his)).toBeLessThan(ABLATION.hisWarningMm);
  });

  it('ハロー 20 極：右側・中隔と部位を伏せたときは三尖弁輪に置き、左側自由壁では置かない', () => {
    expect(make('leftFreeWall').catheter('halo')!.placed).toBe(false);
    for (const s of ['rightFreeWall', 'posteroseptal', 'anteroseptal'] as const) expect(make(s).catheter('halo')!.placed).toBe(true);
    const h = new SimulationEngine(loadParametricSync('normal'));
    wpwScenario.setupSubstrate(h, { apSite: 'leftFreeWall', apHidden: true });
    expect(h.catheter('halo')!.placed).toBe(true);
  });

  it('推奨の誘発部位：左側自由壁は CS 遠位、右側自由壁・中隔は HRA', () => {
    expect(scenarioInduction(wpwScenario, { apSite: 'leftFreeWall' }).site).toBe('CS_DIST');
    expect(scenarioInduction(wpwScenario, {}).site).toBe('CS_DIST');
    for (const s of ['rightFreeWall', 'posteroseptal', 'anteroseptal'] as const) expect(scenarioInduction(wpwScenario, { apSite: s }).site).toBe('HRA');
  });

  it('全部位で順行性 AVRT の VA（心室の興奮 → 副伝導路の心房付着部）> 70 ms', () => {
    for (const s of AP_SITE_IDS) expect(ACCESSORY_PATHWAY.sites[s].ventricularDelayMs + ACCESSORY_PATHWAY.conductionMs).toBeGreaterThan(70);
  });
});

describe.each(['rightFreeWall', 'posteroseptal', 'anteroseptal'] as const)('副伝導路の部位：%s', (site) => {
  it('洞調律：副伝導路から心室が先に興奮し（デルタ波・部位つき）、PR < 120 ms', () => {
    const e = make(site);
    e.tick(2000);
    const beat = e.conduction.vBeats.filter((b) => b.time > 800)[0];
    expect(beat.source).toBe('ap');
    expect(beat.apSite).toBe(site);
    expect(beat.hisArrival! - beat.time).toBeGreaterThan(20);
    expect(beat.time - 800).toBeLessThan(120);
  });

  it('RV 刺激：副伝導路を逆行し、心房の最早期は付着部（房室結節の逆行より早い）', () => {
    const e = make(site);
    e.sinusEnabled = false;
    e.pace('RV', [100]);
    e.tick(500);
    const la = e.ca.tissue.lastActivation;
    let first = -1;
    for (let v = 0; v < la.length; v++) if (la[v] > 0 && (first < 0 || la[v] < la[first])) first = v;
    const ap = e.conduction.ap!.vertices;
    expect(Math.min(...ap.map((v) => distance(e.query.position(v), e.query.position(first))))).toBeLessThan(5);
    const exits = [...e.conduction.exitLog].sort((a, b) => a.time - b.time);
    expect(exits[0].via).toBe('ap');
  });

  it('推奨の部位からの S1-S2 で順行性 AVRT（His 経由で下行、副伝導路を逆行）、根治は付着部への RF', () => {
    const e = make(site);
    const r = tryInduce(e, wpwScenario, PROTOCOL);
    expect(r.induced).toBe(true);
    expect(r.session!.config.site).toBe('HRA');
    const t = r.engine;
    expect(t.conduction.vBeats.slice(-3).every((b) => b.source === 'his')).toBe(true);
    expect(t.conduction.exitLog.slice(-2).every((x) => x.via === 'ap')).toBe(true);
    const cl = t.rhythm.currentCycleLength(t.time)!;
    expect(cl).toBeGreaterThan(240);
    expect(cl).toBeLessThan(400);

    const ap = e.conduction.ap!.vertices;
    const m = rf(e, e.query.position(ap[Math.floor(ap.length / 2)]));
    // 前中隔では His 近傍の警告が出る（合併症は再現しない）
    if (site === 'anteroseptal') expect(m?.message ?? '').toContain('His');
    else expect(m?.message).toBeUndefined();
    e.tick(2500);
    const checks = verifyCure(e, wpwScenario, PROTOCOL);
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
  }, 240_000);
});

describe('WPW の根治の基準：デルタ波の消失', () => {
  it('順行性 AVRT（頻拍）中は、拍が His 経由でも「デルタ波が消えた」にしない', () => {
    const e = make('leftFreeWall');
    const r = tryInduce(e, wpwScenario, PROTOCOL);
    expect(r.induced).toBe(true);
    const t = r.engine;
    expect(t.rhythm.state).toBe('tachycardia');
    expect(t.conduction.vBeats.slice(-3).every((b) => b.source === 'his')).toBe(true);
    expect(wpwScenario.structuralChecks(t).find((c) => c.id === 'no-delta')!.ok).toBe(false);
  }, 120_000);
});

describe('WPW：副伝導路は 1 本の束（付着部の 1 点で途絶える）', () => {
  it('心房側の付着部の 1 頂点だけが焼けても、デルタ波が消え、RV 刺激で副伝導路を逆行せず、非誘発', () => {
    const e = make('leftFreeWall');
    const ap = e.conduction.ap!.vertices;
    e.ablation.field.raise(ap[0], 1);
    expect(e.ca.tissue.viability[ap[1]]).toBeGreaterThan(0);
    e.tick(2500);
    expect(e.conduction.ap!.interrupted).toBe(true);
    expect(e.conduction.vBeats.filter((b) => b.time > 1000).every((b) => b.source === 'his')).toBe(true);
    const checks = verifyCure(e, wpwScenario, PROTOCOL);
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
  }, 120_000);

  it('AVRT 中の RF 通電では「頻拍が止まるときにカテーテルがずれやすい」注意が出る', () => {
    const r = tryInduce(make('leftFreeWall'), wpwScenario, PROTOCOL);
    const e = r.engine;
    expect(e.rhythm.state).toBe('tachycardia');
    const ap = e.conduction.ap!.vertices;
    e.setPlacement('abl', { kind: 'free', point: e.query.position(ap[0]), heightMm: 1, rotationDeg: 0 });
    expect(e.ablation.start('rf')).toBeNull();
    e.ablation.step(e.sampleMs);
    expect(e.ablation.metrics()?.message ?? '').toContain('AVRT 中の通電');
  }, 120_000);
});
