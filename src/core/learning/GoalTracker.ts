import type { GoalContext, LearningEvent, LearningGoal, MapPoint } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';

/**
 * 学習ゴールの達成を追う（docs/DESIGN.md §11）。UI が出来事（刺激プロトコルの終了・設問への回答）を記録し、
 * 一定の間隔で update を呼ぶ。一度達成したゴールは、その後に条件が崩れても達成のまま残す。
 */
export class GoalTracker {
  readonly events: LearningEvent[] = [];
  /** ゴールの id → 達成した時刻（シミュレーション時刻 ms） */
  readonly achievedAt = new Map<string, number>();

  constructor(readonly goals: LearningGoal[]) {}

  record(e: LearningEvent) { this.events.push(e); }

  context(engine: SimulationEngine, points: readonly MapPoint[]): GoalContext {
    return { engine, points, events: this.events };
  }

  /** 未達成のゴールを判定し、新しく達成したゴールの id を返す */
  update(engine: SimulationEngine, points: readonly MapPoint[] = []): string[] {
    const ctx = this.context(engine, points);
    const out: string[] = [];
    for (const g of this.goals) {
      if (this.achievedAt.has(g.id)) continue;
      if (g.achieved(ctx)) { this.achievedAt.set(g.id, engine.time); out.push(g.id); }
    }
    return out;
  }

  isAchieved(id: string) { return this.achievedAt.has(id); }

  get allAchieved() { return this.goals.every((g) => this.achievedAt.has(g.id)); }
}
