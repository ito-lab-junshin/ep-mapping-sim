import type { GoalContext, LearningEvent, Vec3 } from '../types';
import type { SimulationEngine, PacingSite } from '../sim/SimulationEngine';
import { PV_NAMES, PV_OSTIUM, PV_SLEEVE, REGIONS, type PvName } from '../geometry/regions';

/**
 * 学習ゴールの判定に使う共通の条件（軽い計算だけ。複製したエンジンを走らせる判定は使わない）。
 */

export type ProtocolEvent = Extract<LearningEvent, { kind: 'protocol' }>;

/** 刺激プロトコルの出来事 */
export function protocolEvents(ctx: GoalContext, sites?: PacingSite[]): ProtocolEvent[] {
  return ctx.events.filter((e): e is ProtocolEvent => e.kind === 'protocol' && (!sites || sites.includes(e.site)));
}

/** 最後の通電より後に行った刺激プロトコル（病変が 1 つ以上あるとき） */
export function protocolsAfterLastLesion(ctx: GoalContext, sites?: PacingSite[]): ProtocolEvent[] {
  const n = ctx.engine.lesions.length;
  return n > 0 ? protocolEvents(ctx, sites).filter((e) => e.lesionCount === n) : [];
}

/** 環状カテーテルが入っている PV：接触している電極の過半数が、ひとつの PV のスリーブか口にある */
export function circularPv(engine: SimulationEngine): PvName | null {
  const c = engine.catheter('circ');
  if (!c?.placed) return null;
  const count = new Map<PvName, number>();
  let contact = 0;
  for (const e of c.electrodes) {
    if (e.contactVertex < 0) continue;
    contact++;
    const r = REGIONS[engine.mesh.regionOfVertex[e.contactVertex]];
    const pv = PV_NAMES.find((p) => r === PV_SLEEVE[p] || r === PV_OSTIUM[p]);
    if (pv) count.set(pv, (count.get(pv) ?? 0) + 1);
  }
  let best: PvName | null = null, bestN = 0;
  for (const [pv, n] of count) if (n > bestN) { best = pv; bestN = n; }
  return best && bestN >= 3 && bestN * 2 > contact ? best : null;
}

/** 頂点のうち、直近 windowMs 以内に興奮したものの数 */
export function recentlyActivated(engine: SimulationEngine, vertices: number[], windowMs: number): number {
  const la = engine.ca.tissue.lastActivation;
  return vertices.filter((v) => la[v] >= 0 && engine.time - la[v] <= windowMs).length;
}

export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
