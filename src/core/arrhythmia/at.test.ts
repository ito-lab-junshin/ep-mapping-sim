import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { atScenario, atFocusVertex, atFocusAblated } from './at';
import { tryInduce, verifyCure } from './common';
import { AT_SUBSTRATE, AV_NODE } from '../params';
import { runEntrainment } from '../pacing/entrainment';
import { REGION_ID } from '../geometry/regions';

/** 巣状の心房頻拍（AT、分界稜）：AT_SUBSTRATE（仮定値） */
const make = () => { const e = new SimulationEngine(loadParametricSync('normal')); atScenario.setupSubstrate(e); return e; };
const induced = () => { const r = tryInduce(make(), atScenario, {}); expect(r.induced).toBe(true); r.engine.tick(2000); return r.engine; };

describe('心房頻拍（巣状 AT）', () => {
  it('巣は RA の分界稜の上。洞調律だけでは始まらず、HRA からのバーストで始まって続く（周期 約 380 ms・房室伝導 1:1）', () => {
    const e = make();
    expect(e.mesh.regionOfVertex[atFocusVertex(e)]).toBe(REGION_ID.crista_terminalis);
    e.tick(5000);
    expect(e.rhythm.state).toBe('sinus');
    const t = induced();
    expect(t.rhythm.state).toBe('tachycardia');
    const cl = t.rhythm.currentCycleLength(t.time)!;
    expect(cl).toBeGreaterThanOrEqual(AT_SUBSTRATE.minClMs - 5);
    expect(cl).toBeLessThanOrEqual(AT_SUBSTRATE.maxClMs + 5);
    const v = t.conduction.vBeats.filter((b) => b.time > t.time - 3000);
    expect(v.length).toBeGreaterThanOrEqual(7);
    expect(v.every((b) => b.source === 'his')).toBe(true);
  }, 120_000);

  it('心房の最早期は巣：1 拍のうちで巣が最も早く、HRA・His 部位・CS 口は後', () => {
    const e = induced();
    const la = e.ca.tissue.lastActivation, f = atFocusVertex(e), a = e.model.anatomy.anchors;
    const ft = la[f];
    for (const v of [a.his.vertex, a.csOs.vertex, a.avNode.vertex]) {
      expect(la[v] - ft).toBeGreaterThan(5);
      expect(la[v] - ft).toBeLessThan(AT_SUBSTRATE.minClMs / 2);
    }
  }, 120_000);

  it('アデノシン負荷：房室結節が止まり心室の拍はなくなるが、心房頻拍は続く', () => {
    const e = induced();
    const t0 = e.time;
    e.ablation.giveAdenosine();
    e.tick(AV_NODE.adenosine.blockMs - 500);
    expect(e.conduction.vBeats.filter((b) => b.time > t0 + 1000 && b.time < e.time)).toHaveLength(0);
    expect(e.time - e.ca.tissue.lastActivation[atFocusVertex(e)]).toBeLessThan(AT_SUBSTRATE.maxClMs + 10);
    e.tick(6000);
    expect(e.rhythm.state).toBe('tachycardia');
  }, 120_000);

  it('エントレインメント（頻拍周期 − 20 ms）：心房は追従し、止めた後は V-A-A-V（巣はリセットされて頻拍が続く）', () => {
    const r = runEntrainment(induced(), 20);
    expect(r.entrained).toBe(true);
    expect(r.response).toBe('VAAV');
  }, 120_000);

  it('巣を焼くと頻拍が止まり、同じプロトコルで非誘発・再伝導なしで根治', () => {
    const e = induced();
    expect(atFocusAblated(e)).toBe(false);
    e.setPlacement('abl', { kind: 'free', point: e.query.position(atFocusVertex(e)), heightMm: 1, rotationDeg: 0 });
    e.ablation.rf = { powerW: 30, durationS: 30 };
    expect(e.ablation.start('rf')).toBeNull();
    e.ablation.speed = 250;
    while (e.ablation.active) e.ablation.step(e.sampleMs);
    expect(atFocusAblated(e)).toBe(true);
    e.tick(8000);
    expect(e.rhythm.state).not.toBe('tachycardia');
    expect(verifyCure(e, atScenario, {}).every((c) => c.ok)).toBe(true);
  }, 300_000);
});
