import type { ArrhythmiaScenario } from '../types';

/**
 * 心房細動（PVI）
 * PV 内のトリガー（高頻度発火）と心房筋の短い不応期を設定。4 本の PV を電気的に隔離（entrance/exit block）できれば根治
 *
 * TODO(Phase 4): setupSubstrate / tryInduce / isCured を実装する。
 *   仕様は docs/DESIGN.md §5 を参照。
 */
export const afScenario: ArrhythmiaScenario = {
  id: 'af',
  label: '心房細動（PVI）',
  chambers: ['LA'],
  anatomy: 'afRemodeled',
  setupSubstrate: () => { /* TODO */ },
  tryInduce: () => false,
  isCured: () => false,
  goals: [
    '環状カテーテルで PV 電位を記録する',
    'PV 口周囲に連続した病変で隔離する',
    '隔離後に PV 内ペーシングで exit block を確認する',
  ],
};
