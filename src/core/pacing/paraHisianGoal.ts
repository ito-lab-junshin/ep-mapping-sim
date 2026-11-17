import type { LearningGoal } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';

/**
 * para-Hisian 刺激の学習ゴールと設問（シナリオから読み込むので、arrhythmia/common を読み込まない別のファイルにする：循環読み込みを避ける）
 */

/** 学習の設問の id（answer の question） */
export const PARA_HISIAN_QUESTION = 'para-hisian';

/** 実際の逆行性伝導の経路：途絶えていない副伝導路があれば副伝導路、なければ房室結節 */
export function retrogradeRoute(engine: SimulationEngine): 'node' | 'ap' {
  const ap = engine.conduction.ap;
  return ap && !ap.interrupted ? 'ap' : 'node';
}

/** 学習ゴール（AVNRT・WPW）：para-Hisian 刺激の S-A の変化から、逆行性伝導の経路を答える */
export const paraHisianGoal: LearningGoal = {
  id: 'para-hisian',
  label: 'para-Hisian 刺激で、逆行性伝導の経路（房室結節か副伝導路か）を見分ける',
  hint: '刺激パネルの「para-Hisian 刺激」を行い、高出力（His＋心室を捕捉、狭い QRS）と低出力（心室だけ、広い QRS）で S-A を比べる。房室結節を逆行するなら低出力で S-A が延び、副伝導路を逆行するなら変わらない',
  achieved: ({ events }) => events.some((e) => e.kind === 'answer' && e.question === PARA_HISIAN_QUESTION && e.correct),
};
