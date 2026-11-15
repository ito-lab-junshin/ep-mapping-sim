import type { ArrhythmiaScenario, CaseOptions, CureCheck, LearningGoal, SurfaceMesh } from '../types';
import { ABLATION } from '../params';
import { SimulationEngine } from '../sim/SimulationEngine';
import { defaultProtocol, runProtocol, type ProtocolConfig, type ProtocolSession } from '../pacing/ProtocolSession';

/**
 * 同じ解剖・基質・病変をもつエンジンの複製（誘発や根治の確認を、表示中のエンジンを乱さずに行う）。
 */
export function cloneWithSubstrate(engine: SimulationEngine, scenario: ArrhythmiaScenario): SimulationEngine {
  const c = new SimulationEngine(engine.model);
  scenario.setupSubstrate(c, engine.caseOptions);
  c.caseOptions = { ...engine.caseOptions };
  const src = engine.ca.tissue, dst = c.ca.tissue;
  dst.viability.set(src.viability);
  dst.voltage.set(src.voltage);
  c.lesions = [...engine.lesions];
  return c;
}

/** シナリオの誘発プロトコル（§5.6 の既定値）。overrides でテスト用に短くできる */
export function inductionProtocol(scenario: ArrhythmiaScenario, overrides: Partial<ProtocolConfig> = {}, options?: CaseOptions): ProtocolConfig | null {
  const m = scenario.inductionFor ? scenario.inductionFor(options ?? {}) : scenario.induction;
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
  const cfg = inductionProtocol(scenario, overrides, engine.caseOptions);
  if (!cfg) {
    c.tick(settleMs);
    return { induced: c.rhythm.state === 'tachycardia', session: null, engine: c };
  }
  const session = runProtocol(c, cfg);
  return { induced: session.status === 'induced', session, engine: c };
}

/**
 * 再伝導の確認（浮腫・再伝導）：浮腫を除いた状態（恒久的な病変だけ）で、構造的な基準をすべて満たすか。
 * 待機時間で浮腫が引いた後、またはアデノシン負荷で休眠伝導が見えたときと同じ状態
 */
export function reconnectionCheck(engine: SimulationEngine, scenario: ArrhythmiaScenario): CureCheck {
  const ok = engine.ablation.field.withoutEdema(() => scenario.structuralChecks(engine).every((c) => c.ok));
  return { id: 'no-reconnection', label: '待機・アデノシン負荷で再伝導がない（浮腫を除いた病変だけで基準を満たす）', ok };
}

/**
 * 根治の判定：構造的な基準（通電の直後＝浮腫を含む）+ 再伝導がない（浮腫を除く）+ 同じプロトコルで非誘発（浮腫を除いた状態で確かめる）
 */
export function verifyCure(engine: SimulationEngine, scenario: ArrhythmiaScenario, overrides: Partial<ProtocolConfig> = {}): CureCheck[] {
  const checks = scenario.structuralChecks(engine);
  checks.push(reconnectionCheck(engine, scenario));
  const r = engine.ablation.field.withoutEdema(() => tryInduce(engine, scenario, overrides));
  checks.push({ id: 'noninducible', label: '同じプロトコルで非誘発（浮腫が引いた状態）', ok: !r.induced });
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

/**
 * 学習ゴール（全症例、浮腫・再伝導）：最後の通電の後に、待機時間（既定 20 分以上、通算）かアデノシン負荷で再伝導を確かめ、
 * 再伝導がない（浮腫を除いた病変だけで構造的な基準を満たす）。再伝導があれば焼き足して、もう一度確かめる
 */
export function reconnectionGoal(scenario: () => ArrhythmiaScenario): LearningGoal {
  return {
    id: 'reconnection', label: '待機時間かアデノシン負荷で再伝導がないことを確かめる（あれば焼き足す）',
    hint: `通電の直後は浮腫で伝導が止まって見えることがある。通電欄の「待機（${ABLATION.edema.waitMin} 分）」か「アデノシン負荷」の後に、もう一度隔離・ブロックを確かめる`,
    achieved: ({ engine, events }) => {
      const n = engine.lesions.length;
      if (!n) return false;
      const waited = events.filter((e) => e.kind === 'wait' && e.lesionCount === n).reduce((a, e) => a + (e.kind === 'wait' ? e.minutes : 0), 0);
      const adenosine = events.some((e) => e.kind === 'adenosine' && e.lesionCount === n);
      if (waited < ABLATION.edema.waitMin && !adenosine) return false;
      return reconnectionCheck(engine, scenario()).ok;
    },
  };
}
