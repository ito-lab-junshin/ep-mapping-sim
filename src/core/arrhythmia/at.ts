import { entrainmentGoal } from '../pacing/entrainmentGoal';
import type { ArrhythmiaScenario } from '../types';
import { distance, protocolEvents, protocolsAfterLastLesion } from '../learning/conditions';
import { reconnectionGoal } from './common';
import { AT_SUBSTRATE, AV_NODE } from '../params';
import type { SimulationEngine } from '../sim/SimulationEngine';

/** 巣状 AT の巣の頂点：RA の分界稜の線の中ほどに最も近い RA の頂点 */
export function atFocusVertex(engine: SimulationEngine): number {
  const line = engine.model.anatomy.lines.crista, ra = engine.mesh.parts![1];
  const mid = line[Math.floor(line.length / 2)];
  const cand: number[] = [];
  for (let v = ra.vertexStart; v < ra.vertexStart + ra.vertexCount; v++) cand.push(v);
  return engine.query.closestPoint(mid, cand).vertex;
}

/** 巣が焼けている（巣の頂点が興奮しない） */
export function atFocusAblated(engine: SimulationEngine): boolean {
  return engine.ca.tissue.viability[atFocusVertex(engine)] <= 0;
}

/**
 * 巣状の心房頻拍（AT。docs/DESIGN.md §5）
 *  - 基質：RA の分界稜の中ほどに巣（周期 380 ms ± 10 ms、外からの興奮でリセット）。triggered activity として、
 *    HRA からのバースト（連結期 300 ms 以下で 2 回続けて巣が興奮）で発火を始める（AT_SUBSTRATE、仮定値）
 *  - 房室伝導は 1:1（速伝導路）。逆行伝導は AVNRT の症例と同じ良い逆行（頻拍中の心室刺激で V-A-A-V が出る）
 *  - アデノシン負荷は房室結節だけを止める（房室ブロックでも頻拍は続く。臨床ではアデノシンで止まる巣状 AT もある）
 *  - 根治：巣の頂点を焼く → 同じプロトコルで非誘発
 */
export const atScenario: ArrhythmiaScenario = {
  id: 'at',
  label: '心房頻拍（巣状 AT、分界稜）',
  chambers: ['RA'],
  anatomy: 'normal',
  induction: { kind: 'burst', site: 'HRA' },
  setupSubstrate(engine) {
    const c = engine.conduction;
    c.pathways = c.pathways.slice(0, 1);
    const ra = AV_NODE.retrograde.avnrt;
    c.pathways[0].params = { ...c.pathways[0].params, retroRecoveryMs: ra.recoveryMs, retroDecrementMaxMs: ra.decrementMaxMs, retroDecrementTauMs: ra.decrementTauMs };
    engine.foci = engine.foci.filter((f) => !f.resetOnCapture);
    engine.addResettableFocus(atFocusVertex(engine), AT_SUBSTRATE.minClMs, AT_SUBSTRATE.maxClMs, AT_SUBSTRATE.triggerCouplingMs, 7);
  },
  structuralChecks(engine) {
    return [{ id: 'at-focus', label: '心房頻拍の巣（心房の最早期部位）を焼いた', ok: atFocusAblated(engine) }];
  },
  energies: ['rf'],
  maneuvers: ['entrainment'],
  goals: [
    {
      id: 'induced', label: 'HRA からのバーストで心房頻拍を誘発する',
      hint: '刺激パネルの方法を「バースト」、部位を「HRA」にして刺激する',
      achieved: (ctx) => protocolEvents(ctx).some((e) => e.status === 'induced'),
    },
    {
      id: 'earliest', label: '頻拍中に LAT マップを取り、心房の最早期部位（巣）を見つける',
      hint: '頻拍中に RA の壁を広く 5 点以上取得する。最早期の点から興奮が同心円状に広がる',
      achieved: ({ engine, points }) => {
        const lat = points.filter((p) => p.latMs !== null);
        if (lat.length < 5) return false;
        const first = lat.reduce((a, b) => (b.latMs! < a.latMs! ? b : a));
        return distance(engine.query.position(atFocusVertex(engine)), first.position) <= 10;
      },
    },
    {
      id: 'focus-ablation', label: '最早期部位で通電し、巣を焼く',
      hint: '最早期の部位に ABL を置いて RF 通電する（分界稜の近く。洞結節・右横隔神経に近い部位では注意）',
      achieved: ({ engine }) => atFocusAblated(engine),
    },
    {
      id: 'noninducible', label: '同じプロトコルで非誘発を確認する',
      hint: '通電の後に、もう一度 HRA からバーストを行う',
      achieved: (ctx) => protocolsAfterLastLesion(ctx).some((e) => e.status === 'noninducible') && atFocusAblated(ctx.engine),
    },
    entrainmentGoal,
    reconnectionGoal(() => atScenario),
  ],
};
