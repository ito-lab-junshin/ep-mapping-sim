import type { ArrhythmiaId, ArrhythmiaScenario, CaseOptions, InductionMethod } from '../types';
import { afScenario } from './af';
import { aflCtiCwScenario, aflCtiScenario } from './aflCti';
import { avnrtScenario } from './avnrt';
import { wpwScenario } from './wpw';
import { atScenario } from './at';

export const SCENARIOS: Record<ArrhythmiaId, ArrhythmiaScenario> = {
  af: afScenario,
  afl_cti: aflCtiScenario,
  afl_cti_cw: aflCtiCwScenario,
  avnrt: avnrtScenario,
  wpw: wpwScenario,
  at: atScenario,
};

/** シナリオの推奨の誘発法（症例の選択肢を反映。WPW は副伝導路の部位で刺激部位が変わる） */
export function scenarioInduction(s: ArrhythmiaScenario, options?: CaseOptions): InductionMethod {
  return s.inductionFor ? s.inductionFor(options ?? {}) : s.induction;
}
