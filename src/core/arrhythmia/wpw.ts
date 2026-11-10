import type { ArrhythmiaScenario } from '../types';

/**
 * WPW・副伝導路
 * 僧帽弁輪（または三尖弁輪）に副伝導路。洞調律でデルタ波、心房期外刺激で順行性 AVRT を誘発。弁輪上で最早期心室興奮（または逆行性最早期心房興奮）部位を通電
 *
 * TODO(Phase 4): setupSubstrate / tryInduce / isCured を実装する。
 *   仕様は docs/DESIGN.md §5 を参照。
 */
export const wpwScenario: ArrhythmiaScenario = {
  id: 'wpw',
  label: 'WPW・副伝導路',
  chambers: ['LA'],
  anatomy: 'normal',
  setupSubstrate: () => { /* TODO */ },
  tryInduce: () => false,
  isCured: () => false,
  goals: [
    '弁輪に沿った多極カテーテルで最早期部位を探す',
    'AV 融合または V-A 融合を示す部位を見つける',
    '通電後デルタ波消失と非誘発を確認する',
  ],
};
