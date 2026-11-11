import type { ArrhythmiaScenario } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { WPW_AP_VERTICES, WPW_AV_NODE_ERP_MS } from '../params';
import { distance, protocolsAfterLastLesion } from '../learning/conditions';

/** 副伝導路の心房付着部：僧帽弁輪の縁のうち最も側方（左側自由壁）の頂点 */
export function accessoryPathwayVertices(engine: SimulationEngine): number[] {
  const p = engine.mesh.positions;
  return [...engine.model.anatomy.rims.mitral].sort((a, b) => p[3 * b] - p[3 * a]).slice(0, WPW_AP_VERTICES);
}

/**
 * WPW・副伝導路（左側自由壁。docs/DESIGN.md §5.4）
 *  - 基質：僧帽弁輪の側方に副伝導路（順行性 ERP 280 ms・逆行性 ERP 250 ms・伝導 15 ms）。
 *    洞調律では心室が副伝導路から先に興奮し（デルタ波・短い PR）、His 経由の興奮と融合する
 *  - 誘発：CS 遠位からの S1-S2。S2 が副伝導路の順行性 ERP に入ると房室結節だけを下行し、
 *    副伝導路を逆行して順行性 AVRT（心室刺激でも可）
 *  - 根治：副伝導路の頂点が病変 → デルタ波が消え、同じプロトコルで非誘発
 */
/** 副伝導路の心房付着部がすべて焼けている */
export function apAblated(engine: SimulationEngine): boolean {
  const ap = engine.conduction.ap;
  return !!ap && ap.vertices.every((v) => engine.ca.tissue.viability[v] <= 0);
}

export const wpwScenario: ArrhythmiaScenario = {
  id: 'wpw',
  label: 'WPW・副伝導路',
  chambers: ['LA'],
  anatomy: 'normal',
  // 左側副伝導路は CS 遠位（副伝導路の近く）から刺激する。HRA からの S2 では、房室結節を下行して
  // 副伝導路を逆行した興奮が LA 側方に戻ったとき、そこがまだ S2 の不応期にあり、エコーが止まってしまう
  induction: { kind: 'extrastimulus', site: 'CS_DIST' },
  setupSubstrate(engine) {
    const c = engine.conduction;
    c.pathways = c.pathways.slice(0, 1);
    c.pathways[0].params = { ...c.pathways[0].params, erpMs: WPW_AV_NODE_ERP_MS };
    c.setAccessoryPathway(accessoryPathwayVertices(engine));
  },
  structuralChecks(engine) {
    const ap = engine.conduction.ap;
    const ok = !!ap && ap.vertices.every((v) => engine.ca.tissue.viability[v] <= 0);
    const recent = engine.conduction.vBeats.filter((b) => b.source !== 'pace').slice(-3);
    const noDelta = recent.length > 0 && recent.every((b) => b.source === 'his');
    return [
      { id: 'ap-lesion', label: '副伝導路の部位（僧帽弁輪の側方）に病変がある', ok },
      { id: 'no-delta', label: 'デルタ波が消えた（直近の拍が His 経由だけ）', ok: noDelta },
    ];
  },
  energies: ['rf'],
  goals: [
    {
      id: 'earliest', label: '僧帽弁輪に沿ってマップを取り、心房の最早期部位（副伝導路）を見つける',
      hint: 'RV 刺激または頻拍中（副伝導路を逆行）に、僧帽弁輪の側方を中心に 5 点以上取得する。最早期の点が副伝導路の近くになる',
      achieved: ({ engine, points }) => {
        const ap = engine.conduction.ap;
        const lat = points.filter((p) => p.latMs !== null);
        if (!ap || lat.length < 5) return false;
        const first = lat.reduce((a, b) => (b.latMs! < a.latMs! ? b : a));
        return ap.vertices.some((v) => distance(engine.query.position(v), first.position) <= 10);
      },
    },
    {
      id: 'ap-ablation', label: 'AV（または VA）融合部位で通電し、副伝導路を焼く',
      hint: '最早期の部位に ABL を置いて RF 通電する',
      achieved: ({ engine }) => apAblated(engine),
    },
    {
      id: 'delta-gone', label: 'デルタ波の消失と非誘発を確認する',
      hint: '洞調律でデルタ波が消えたことを見て、もう一度期外刺激を行う',
      achieved: (ctx) => apAblated(ctx.engine) && protocolsAfterLastLesion(ctx).some((e) => e.status === 'noninducible'),
    },
  ],
};
