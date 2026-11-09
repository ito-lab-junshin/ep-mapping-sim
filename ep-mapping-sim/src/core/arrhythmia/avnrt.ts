import type { ArrhythmiaScenario } from '../types';

/**
 * AVNRT（遅伝導路）
 * Koch 三角の後下方に遅伝導路、前上方に速伝導路。心房期外刺激で jump と echo を起こし頻拍を誘発。遅伝導路の修飾（接合部調律の出現）で非誘発化
 *
 * TODO(Phase 4): setupSubstrate / tryInduce / isCured を実装する。
 *   仕様は docs/DESIGN.md §5 を参照。
 */
export const avnrtScenario: ArrhythmiaScenario = {
  id: 'avnrt',
  label: 'AVNRT（遅伝導路）',
  chambers: ['RA'],
  setupSubstrate: () => { /* TODO */ },
  tryInduce: () => false,
  isCured: () => false,
  goals: [
    'His 束電位を記録し Koch 三角の範囲を把握する',
    '期外刺激で AH jump を確認する',
    '遅伝導路（CS 口と三尖弁輪の間）で通電し接合部調律を確認する',
  ],
};
