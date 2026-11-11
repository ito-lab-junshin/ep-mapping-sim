import type { ArrhythmiaScenario } from '../types';
import { slowPathway } from '../conduction/AvNode';
import { distance, protocolEvents, protocolsAfterLastLesion } from '../learning/conditions';

/**
 * AVNRT（遅伝導路、通常型。docs/DESIGN.md §5.3）
 *  - 基質：Koch 三角の前上方（房室結節）に速伝導路、後下方（CS 口と三尖弁輪の間）に遅伝導路の入口を置く。
 *    速伝導路：AH 80 ms・ERP 320 ms（逆行 40 ms・逆行 ERP 200 ms）、遅伝導路：AH 200 ms・ERP 200 ms（§4.2）
 *  - 誘発：HRA からの S1-S2。S2 が速伝導路の ERP に入ると遅伝導路を下行（AH ジャンプ ≧ 50 ms）し、
 *    速伝導路を逆行してエコー → 頻拍（slow-fast）
 *  - 根治：遅伝導路の入口に病変 → 同じプロトコルで非誘発（速伝導路は保たれる）
 */
/** 連続する 2 列の AH の差が 50 ms 以上 */
export function hasAhJump(results: { captured: boolean; ahMs: number | null }[]): boolean {
  const ah = results.filter((r) => r.captured && r.ahMs !== null).map((r) => r.ahMs!);
  return ah.some((x, i) => i > 0 && x - ah[i - 1] >= 50);
}

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
    {
      id: 'his', label: 'His 束電位を記録し Koch 三角の範囲を把握する',
      hint: 'His カテーテルの遠位を三尖弁輪の His 部位に接触させる',
      achieved: ({ engine }) => {
        const h = engine.catheter('his');
        const e = h?.placed ? h.electrodes[0] : null;
        return !!e && e.contactVertex >= 0 && distance(e.position, engine.model.anatomy.anchors.his.point) <= 6;
      },
    },
    {
      id: 'ah-jump', label: '期外刺激で AH jump（≧ 50 ms）を確認する',
      hint: 'HRA または CS から S1-S2 を行い、S2 を短くしたときに AH が 50 ms 以上延びる点を探す',
      achieved: (ctx) => protocolEvents(ctx).some((e) => hasAhJump(e.results)),
    },
    {
      id: 'junctional', label: '遅伝導路（CS 口と三尖弁輪の間）で通電し接合部調律を確認する',
      hint: 'ABL を CS 口の前方・三尖弁輪の近く（Koch 三角の後下方）に置いて RF 通電する',
      achieved: ({ engine }) => !!engine.ablation.active?.last.junctional || !!engine.ablation.last?.junctional,
    },
    {
      id: 'noninducible', label: '同じプロトコルで非誘発を確認する',
      hint: '通電の後に、もう一度期外刺激を行う',
      achieved: (ctx) => protocolsAfterLastLesion(ctx).some((e) => e.status === 'noninducible')
        && ctx.engine.ca.tissue.viability[ctx.engine.model.anatomy.anchors.slowPathway.vertex] <= 0,
    },
  ],
};
