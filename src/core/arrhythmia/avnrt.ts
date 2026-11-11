import type { ArrhythmiaScenario } from '../types';
import { slowPathway } from '../conduction/AvNode';

/**
 * AVNRT（遅伝導路、通常型。docs/DESIGN.md §5.3）
 *  - 基質：Koch 三角の前上方（房室結節）に速伝導路、後下方（CS 口と三尖弁輪の間）に遅伝導路の入口を置く。
 *    速伝導路：AH 80 ms・ERP 320 ms（逆行 40 ms・逆行 ERP 200 ms）、遅伝導路：AH 200 ms・ERP 200 ms（§4.2）
 *  - 誘発：HRA からの S1-S2。S2 が速伝導路の ERP に入ると遅伝導路を下行（AH ジャンプ ≧ 50 ms）し、
 *    速伝導路を逆行してエコー → 頻拍（slow-fast）
 *  - 根治：遅伝導路の入口に病変 → 同じプロトコルで非誘発（速伝導路は保たれる）
 */
export const avnrtScenario: ArrhythmiaScenario = {
  id: 'avnrt',
  label: 'AVNRT（遅伝導路）',
  chambers: ['RA'],
  anatomy: 'normal',
  induction: { kind: 'extrastimulus', site: 'HRA' },
  setupSubstrate(engine) {
    const c = engine.conduction;
    c.pathways = c.pathways.slice(0, 1);
    c.pathways.push(slowPathway(engine.model.anatomy.anchors.slowPathway.vertex));
  },
  structuralChecks(engine) {
    const v = engine.model.anatomy.anchors.slowPathway.vertex;
    return [{ id: 'slow-pathway-lesion', label: '遅伝導路の部位（Koch 三角の後下方）に病変がある', ok: engine.ca.tissue.viability[v] <= 0 }];
  },
  energies: ['rf'],
  goals: [
    'His 束電位を記録し Koch 三角の範囲を把握する',
    '期外刺激で AH jump を確認する',
    '遅伝導路（CS 口と三尖弁輪の間）で通電し接合部調律を確認する',
    '同じプロトコルで非誘発を確認する',
  ],
};
