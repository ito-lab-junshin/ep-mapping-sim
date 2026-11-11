import type { ArrhythmiaScenario, CureCheck, SurfaceMesh } from '../types';
import { SimulationEngine } from '../sim/SimulationEngine';
import { defaultProtocol, runProtocol, type ProtocolConfig, type ProtocolSession } from '../pacing/ProtocolSession';

/**
 * 同じ解剖・基質・病変をもつエンジンの複製（誘発や根治の確認を、表示中のエンジンを乱さずに行う）。
 */
export function cloneWithSubstrate(engine: SimulationEngine, scenario: ArrhythmiaScenario): SimulationEngine {
  const c = new SimulationEngine(engine.model);
  scenario.setupSubstrate(c);
  const src = engine.ca.tissue, dst = c.ca.tissue;
  dst.viability.set(src.viability);
  dst.voltage.set(src.voltage);
  c.lesions = [...engine.lesions];
  return c;
}

/** シナリオの誘発プロトコル（§5.6 の既定値）。overrides でテスト用に短くできる */
export function inductionProtocol(scenario: ArrhythmiaScenario, overrides: Partial<ProtocolConfig> = {}): ProtocolConfig | null {
  const m = scenario.induction;
  if (m.kind === 'spontaneous') return null;
  return { ...defaultProtocol(m.kind, m.site), ...overrides };
}

export interface InductionResult {
  induced: boolean;
  session: ProtocolSession | null;
  engine: SimulationEngine;
}

/**
 * 誘発を試す（複製したエンジンで）。spontaneous のシナリオは、刺激なしで settleMs 進めて頻拍になるかを見る。
 */
export function tryInduce(engine: SimulationEngine, scenario: ArrhythmiaScenario, overrides: Partial<ProtocolConfig> = {}, settleMs = 7000): InductionResult {
  const c = cloneWithSubstrate(engine, scenario);
  const cfg = inductionProtocol(scenario, overrides);
  if (!cfg) {
    c.tick(settleMs);
    return { induced: c.rhythm.state === 'tachycardia', session: null, engine: c };
  }
  const session = runProtocol(c, cfg);
  return { induced: session.status === 'induced', session, engine: c };
}

/** 根治の判定：構造的な基準 + 同じプロトコルで非誘発 */
export function verifyCure(engine: SimulationEngine, scenario: ArrhythmiaScenario, overrides: Partial<ProtocolConfig> = {}): CureCheck[] {
  const checks = scenario.structuralChecks(engine);
  const r = tryInduce(engine, scenario, overrides);
  checks.push({ id: 'noninducible', label: '同じプロトコルで非誘発', ok: !r.induced });
  return checks;
}

/**
 * 病変（viability = 0）で隔てられているか：seeds から、生きている頂点（viability > 0）だけを
 * メッシュの辺でたどって targets のどれかに届くか。届かなければ true（ブロック）。
 * 心房間の連結（bridges）は通らない。
 */
export function separated(mesh: SurfaceMesh, viability: Float32Array, seeds: number[], targets: Set<number>): boolean {
  const seen = new Uint8Array(viability.length);
  const stack: number[] = [];
  for (const s of seeds) if (viability[s] > 0) { seen[s] = 1; stack.push(s); }
  while (stack.length) {
    const v = stack.pop()!;
    if (targets.has(v)) return false;
    for (const u of mesh.neighbors[v]) {
      if (seen[u] || viability[u] <= 0) continue;
      seen[u] = 1;
      stack.push(u);
    }
  }
  return true;
}
