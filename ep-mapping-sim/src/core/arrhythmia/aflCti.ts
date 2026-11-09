import type { ArrhythmiaScenario } from '../types';

/**
 * 通常型心房粗動（CTI）
 * 三尖弁輪を反時計方向に旋回するリエントリー。CTI は伝導が遅く、ここに両方向性ブロックラインを完成させれば根治
 *
 * TODO(Phase 4): setupSubstrate / tryInduce / isCured を実装する。
 *   仕様は docs/DESIGN.md §5 を参照。
 */
export const aflCtiScenario: ArrhythmiaScenario = {
  id: 'afl_cti',
  label: '通常型心房粗動（CTI）',
  chambers: ['RA'],
  setupSubstrate: () => { /* TODO */ },
  tryInduce: () => false,
  isCured: () => false,
  goals: [
    'CS 近位→遠位の活性化順序とハロー電極で旋回方向を確認する',
    'CTI に三尖弁輪から下大静脈まで連続線を引く',
    'CS 口ペーシングで両方向性ブロックを確認する',
  ],
};
