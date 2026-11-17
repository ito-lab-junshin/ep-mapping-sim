import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { wpwScenario } from '../arrhythmia/wpw';
import { avnrtScenario } from '../arrhythmia/avnrt';
import { paraHisianResponse, retrogradeRoute, paraHisianGoal, PARA_HISIAN_QUESTION } from './paraHisian';
import { PARA_HISIAN, type ApSite } from '../params';
import { GoalTracker } from '../learning/GoalTracker';

/** para-Hisian 刺激（4-A）：高出力（His＋心室）と低出力（心室だけ）の S-A の比較 */
const wpw = (site: ApSite) => { const e = new SimulationEngine(loadParametricSync('normal')); wpwScenario.setupSubstrate(e, { apSite: site }); return e; };

describe('para-Hisian 刺激', () => {
  it('房室結節だけ（AVNRT）：高出力は狭い QRS・低出力は広い QRS。低出力で S-A が延びる（His を回って逆行する分）。経路は房室結節', () => {
    const e = new SimulationEngine(loadParametricSync('normal')); avnrtScenario.setupSubstrate(e);
    const r = paraHisianResponse(e, avnrtScenario);
    expect(r.high.qrs).toBe('narrow');
    expect(r.low.qrs).toBe('wide');
    expect(r.high.route).toBe('node');
    expect(r.low.route).toBe('node');
    // HRA・His 部位・CS 遠位のどれも、低出力で lowOutputVhMs ほど延びる（心房の興奮順序は同じ）
    for (const k of ['saHraMs', 'saHisMs', 'saCsDistMs'] as const) {
      expect(r.low[k]! - r.high[k]!, k).toBeGreaterThanOrEqual(PARA_HISIAN.lowOutputVhMs - 5);
    }
    expect(retrogradeRoute(e)).toBe('node');
  });

  it.each(['anteroseptal', 'posteroseptal'] as const)('中隔の副伝導路（%s）：低出力でも S-A は変わらない（副伝導路を逆行）', (site) => {
    const r = paraHisianResponse(wpw(site), wpwScenario);
    expect(r.high.route).toBe('ap');
    expect(r.low.route).toBe('ap');
    for (const k of ['saHraMs', 'saHisMs'] as const) expect(Math.abs(r.low[k]! - r.high[k]!), k).toBeLessThanOrEqual(5);
  });

  it('副伝導路の心室付着部までの時間は、中隔が短く側壁が長い（仮定値の関係）', () => {
    const d = PARA_HISIAN.apDelayMs;
    expect(Math.max(d.anteroseptal, d.posteroseptal)).toBeLessThan(Math.min(d.rightFreeWall, d.leftFreeWall));
  });

  it('左側自由壁の副伝導路：中隔（His 部位）は低出力で延びる（房室結節が先に届く）が、CS 遠位は変わらない（副伝導路）', () => {
    const r = paraHisianResponse(wpw('leftFreeWall'), wpwScenario);
    expect(r.low.saHisMs! - r.high.saHisMs!).toBeGreaterThanOrEqual(PARA_HISIAN.lowOutputVhMs - 10);
    expect(Math.abs(r.low.saCsDistMs! - r.high.saCsDistMs!)).toBeLessThanOrEqual(5);
  });

  it('副伝導路を焼くと、房室結節の逆行だけになり、低出力で S-A が延びる。経路の答えも房室結節に変わる', () => {
    const e = wpw('posteroseptal');
    for (const v of e.conduction.ap!.vertices) e.ablation.field.raise(v, 1);
    e.tick(500);
    expect(retrogradeRoute(e)).toBe('node');
    const r = paraHisianResponse(e, wpwScenario);
    expect(r.low.route).toBe('node');
    expect(r.low.saHisMs! - r.high.saHisMs!).toBeGreaterThanOrEqual(PARA_HISIAN.lowOutputVhMs - 5);
  });

  it('学習ゴール：AVNRT・WPW にあり、逆行性伝導の経路を正しく答えると達成', () => {
    expect(avnrtScenario.goals.map((g) => g.id)).toContain('para-hisian');
    expect(wpwScenario.goals.map((g) => g.id)).toContain('para-hisian');
    const e = wpw('anteroseptal');
    const t = new GoalTracker([paraHisianGoal]);
    t.record({ kind: 'answer', time: 0, question: PARA_HISIAN_QUESTION, value: 'node', correct: false });
    t.update(e);
    expect(t.isAchieved('para-hisian')).toBe(false);
    t.record({ kind: 'answer', time: 1, question: PARA_HISIAN_QUESTION, value: 'ap', correct: retrogradeRoute(e) === 'ap' });
    t.update(e);
    expect(t.isAchieved('para-hisian')).toBe(true);
  });
});
