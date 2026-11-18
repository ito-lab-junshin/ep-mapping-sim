import type { LearningGoal } from '../types';

/**
 * エントレインメント（頻拍中の心室刺激、4-B）の学習ゴールと設問（シナリオから読み込むので、arrhythmia/common を読み込まない別のファイル：循環読み込みを避ける）
 */

/** 学習の設問の id（answer の question） */
export const ENTRAINMENT_QUESTION = 'entrainment';

/** 学習ゴール（AVNRT・WPW）：頻拍中の右室刺激の後の PPI − TCL・SA − VA から、AVNRT か AVRT かを答える */
export const entrainmentGoal: LearningGoal = {
  id: 'entrainment',
  label: '頻拍中の右室刺激（エントレインメント）で、AVNRT か AVRT かを見分ける',
  hint: '頻拍を誘発し、刺激パネルの「エントレインメント」で頻拍周期より 20〜40 ms 短く右室から刺激する。止めた後の PPI − TCL と SA − VA を目安と比べる',
  achieved: ({ events }) => events.some((e) => e.kind === 'answer' && e.question === ENTRAINMENT_QUESTION && e.correct),
};
