import type { LearningEvent } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import type { ProtocolSession } from '../pacing/ProtocolSession';
import { circularPv } from './conditions';
import { isolatedPvs } from '../arrhythmia/pv';

/**
 * 終わった刺激プロトコルを学習の出来事にする。
 * lesionCountAtStart：プロトコルを始めたときの病変の数、contact / circPv：始めたときの電極の接触と環状カテーテルの PV
 */
export function protocolEvent(
  engine: SimulationEngine, session: ProtocolSession, lesionCountAtStart: number,
  atStart: { contact: boolean; circPv: string | null; circPvIsolated: boolean },
): LearningEvent {
  const status = session.status === 'induced' || session.status === 'noninducible' ? session.status : 'stopped';
  return {
    kind: 'protocol', time: engine.time, site: session.config.site, status,
    results: session.results.map((r) => ({ couplingMs: r.couplingMs, captured: r.captured, ahMs: r.ahMs })),
    lesionCount: lesionCountAtStart, ...atStart,
  };
}

/** プロトコルを始めるときの電極の状態 */
export function protocolStartState(engine: SimulationEngine, site: Parameters<SimulationEngine['siteTarget']>[0]) {
  const circPv = circularPv(engine);
  return { contact: engine.siteTarget(site).kind !== 'none', circPv, circPvIsolated: !!circPv && isolatedPvs(engine).includes(circPv) };
}
