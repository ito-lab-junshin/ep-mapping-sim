import type { ArrhythmiaId, ArrhythmiaScenario } from '../types';
import { afScenario } from './af';
import { aflCtiCwScenario, aflCtiScenario } from './aflCti';
import { avnrtScenario } from './avnrt';
import { wpwScenario } from './wpw';

export const SCENARIOS: Record<ArrhythmiaId, ArrhythmiaScenario> = {
  af: afScenario,
  afl_cti: aflCtiScenario,
  afl_cti_cw: aflCtiCwScenario,
  avnrt: avnrtScenario,
  wpw: wpwScenario,
};
