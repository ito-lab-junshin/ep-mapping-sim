import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { avnrtScenario } from '../arrhythmia/avnrt';
import { wpwScenario } from '../arrhythmia/wpw';
import { tryInduce } from '../arrhythmia/common';
import type { ArrhythmiaScenario } from '../types';
import type { ApSite } from '../params';
import { ENTRAINMENT_CRITERIA, entrainmentGoal, runEntrainment, tachycardiaMechanism, ENTRAINMENT_QUESTION } from './entrainment';
import { GoalTracker } from '../learning/GoalTracker';

/** エントレインメント（4-B）：頻拍中の右室刺激の後の PPI − TCL・SA − VA */
const tachy = (sc: ArrhythmiaScenario, apSite?: ApSite) => {
  const e0 = new SimulationEngine(loadParametricSync('normal'));
  sc.setupSubstrate(e0, apSite ? { apSite } : undefined);
  const e = tryInduce(e0, sc, { s1Beats: 4, s2StartMs: 300, observeMs: 1200 }).engine;
  e.tick(3000);
  return e;
};

describe('エントレインメント', () => {
  it('AVNRT（頻拍周期 − 40 ms）：刺激で頻拍が止まる（既知の限界。SA・PPI は出さない）', () => {
    const r = runEntrainment(tachy(avnrtScenario), 40);
    expect(r.response).toBe('terminated');
    expect(r.saMinusVaMs).toBeNull();
    expect(r.ppiMinusTclMs).toBeNull();
  }, 120_000);

  it('AVNRT（頻拍周期 − 20 ms）：心房が追従し V-A-V。PPI − TCL・SA − VA はどちらも目安を超える', () => {
    const r = runEntrainment(tachy(avnrtScenario), 20);
    expect(r.entrained).toBe(true);
    expect(r.response).toBe('VAV');
    expect(r.ppiMinusTclMs!).toBeGreaterThan(ENTRAINMENT_CRITERIA.ppiMinusTclMs);
    expect(r.saMinusVaMs!).toBeGreaterThan(ENTRAINMENT_CRITERIA.saMinusVaMs);
  }, 120_000);

  it.each(['leftFreeWall', 'rightFreeWall'] as const)('自由壁の副伝導路の AVRT（%s、− 20 ms）：追従し V-A-V。PPI − TCL・SA − VA はどちらも目安以下', (site) => {
    const r = runEntrainment(tachy(wpwScenario, site), 20);
    expect(r.entrained).toBe(true);
    expect(r.response).toBe('VAV');
    expect(r.ppiMinusTclMs!).toBeLessThan(ENTRAINMENT_CRITERIA.ppiMinusTclMs);
    expect(r.saMinusVaMs!).toBeLessThan(ENTRAINMENT_CRITERIA.saMinusVaMs);
  }, 120_000);

  it('設問の正解とゴール：AVNRT は AVNRT、WPW は AVRT。正しく答えるとゴール達成', () => {
    expect(tachycardiaMechanism('avnrt')).toBe('avnrt');
    expect(tachycardiaMechanism('wpw')).toBe('avrt');
    expect(tachycardiaMechanism('at')).toBe('at');
    expect(avnrtScenario.goals).toContain(entrainmentGoal);
    expect(wpwScenario.goals).toContain(entrainmentGoal);
    expect(avnrtScenario.maneuvers).toContain('entrainment');
    const e = new SimulationEngine(loadParametricSync('normal'));
    const t = new GoalTracker([entrainmentGoal]);
    t.record({ kind: 'answer', time: 0, question: ENTRAINMENT_QUESTION, value: 'avrt', correct: false });
    t.update(e);
    expect(t.isAchieved('entrainment')).toBe(false);
    t.record({ kind: 'answer', time: 0, question: ENTRAINMENT_QUESTION, value: 'avnrt', correct: true });
    t.update(e);
    expect(t.isAchieved('entrainment')).toBe(true);
  });
});
