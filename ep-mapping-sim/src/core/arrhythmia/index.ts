import type { ArrhythmiaId, ArrhythmiaScenario } from '../types';
import { afScenario } from './af';
import { aflCtiScenario } from './aflCti';
import { avnrtScenario } from './avnrt';
import { wpwScenario } from './wpw';

export const SCENARIOS: Record<ArrhythmiaId, ArrhythmiaScenario> = {
  af: afScenario,
  afl_cti: aflCtiScenario,
  avnrt: avnrtScenario,
  wpw: wpwScenario,
};
