import type { ArrhythmiaScenario, CaseOptions, InductionMethod, LearningGoal } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { AP_SITE_IDS, WPW_AP_VERTICES, WPW_AV_NODE_ERP_MS, type ApSite } from '../params';
import { distance, protocolsAfterLastLesion } from '../learning/conditions';
import { reconnectionGoal } from './common';

/** 副伝導路の部位の表示名と、心房付着部の説明（§5.4） */
export const AP_SITES: Record<ApSite, { label: string; where: string }> = {
  leftFreeWall: { label: '左側自由壁', where: '僧帽弁輪の側方' },
  rightFreeWall: { label: '右側自由壁', where: '三尖弁輪の側方' },
  posteroseptal: { label: '後中隔', where: 'CS 口の近くの三尖弁輪（中隔の後方）' },
  anteroseptal: { label: '前中隔', where: 'His 束の近くの三尖弁輪（中隔の前上方）' },
};
export { AP_SITE_IDS };

/**
 * 前中隔の副伝導路の付着部を、His 束の頂点からこの距離 mm 以上離す（仮定値）。
 * His 近傍の警告（ABLATION.hisWarningMm = 5 mm）は付着部で通電すると出る距離
 */
export const ANTEROSEPTAL_MIN_HIS_MM = 3;

export function apSiteOf(options?: CaseOptions): ApSite {
  const s = options?.apSite;
  return s && AP_SITE_IDS.includes(s) ? s : 'leftFreeWall';
}

/** 副伝導路の心房付着部の頂点（部位ごと） */
export function accessoryPathwayVertices(engine: SimulationEngine, site: ApSite = 'leftFreeWall'): number[] {
  const p = engine.mesh.positions;
  const a = engine.model.anatomy;
  const n = WPW_AP_VERTICES;
  /** 弁輪 rim のうち q に最も近い頂点（min mm 以上離す）と、その頂点に近い弁輪の頂点（付着部をひとかたまりにする） */
  const near = (rim: number[], q: { x: number; y: number; z: number }, min = 0) => {
    const seed = rim
      .map((v) => ({ v, d: distance(engine.query.position(v), q) }))
      .filter((x) => x.d >= min)
      .reduce((m, x) => (x.d < m.d ? x : m)).v;
    const s = engine.query.position(seed);
    return rim
      .filter((v) => distance(engine.query.position(v), q) >= min)
      .sort((u, w) => distance(engine.query.position(u), s) - distance(engine.query.position(w), s))
      .slice(0, n);
  };
  switch (site) {
    // 僧帽弁輪の縁のうち最も側方（+x = 左）
    case 'leftFreeWall': return [...a.rims.mitral].sort((u, w) => p[3 * w] - p[3 * u]).slice(0, n);
    // 三尖弁輪の縁のうち最も側方（−x = 右）
    case 'rightFreeWall': return [...a.rims.tricuspid].sort((u, w) => p[3 * u] - p[3 * w]).slice(0, n);
    // 三尖弁輪の縁のうち CS 口に最も近い所
    case 'posteroseptal': return near(a.rims.tricuspid, a.ra.csOs.center);
    // 三尖弁輪の縁のうち His 束の頂点に近い所（ANTEROSEPTAL_MIN_HIS_MM 以上離す）
    case 'anteroseptal': return near(a.rims.tricuspid, a.anchors.his.point, ANTEROSEPTAL_MIN_HIS_MM);
  }
}

/**
 * 部位ごとの推奨の誘発部位（§5.6）。S2 で付着部の心房が興奮してから、房室結節 → 心室 → 副伝導路を通って
 * 興奮が付着部に戻るまでの時間が、付着部の周りの心房の不応期より長くないとエコーが止まる。
 *  - 左側自由壁：CS 遠位（HRA からでは、LA 側方の興奮が遅れて不応期のうちに戻ってくる）
 *  - 右側自由壁・中隔：HRA（CS 近位・遠位からでは続かなかった。試算の結果）
 */
const INDUCTION: Record<ApSite, InductionMethod> = {
  leftFreeWall: { kind: 'extrastimulus', site: 'CS_DIST' },
  rightFreeWall: { kind: 'extrastimulus', site: 'HRA' },
  posteroseptal: { kind: 'extrastimulus', site: 'HRA' },
  anteroseptal: { kind: 'extrastimulus', site: 'HRA' },
};

/** 副伝導路が途絶えた（心房付着部のどれかが焼けた） */
export function apAblated(engine: SimulationEngine): boolean {
  // 副伝導路は 1 本の束なので、付着部のどれか 1 点が焼ければ伝導は途絶える（先生と決定）
  const ap = engine.conduction.ap;
  return !!ap && ap.vertices.some((v) => engine.ca.tissue.viability[v] <= 0);
}

/** 体表 ECG（デルタ波）から副伝導路の部位を推定する設問の id（answer の question） */
export const AP_SITE_QUESTION = 'ap-site';

const goals: LearningGoal[] = [
  {
    id: 'ap-site', label: '体表 ECG のデルタ波の極性から、副伝導路の部位を推定する',
    hint: '体表 ECG を 12 誘導にし、洞調律のデルタ波の極性（I・aVL・下壁誘導・V1、移行帯）を見て答える。正解すると達成',
    // 部位を伏せたときだけの設問
    applies: ({ engine }) => !!engine.caseOptions.apHidden,
    achieved: ({ events }) => events.some((e) => e.kind === 'answer' && e.question === AP_SITE_QUESTION && e.correct),
  },
  {
    id: 'earliest', label: '弁輪に沿ってマップを取り、心房の最早期部位（副伝導路）を見つける',
    hint: 'RV 刺激または頻拍中（副伝導路を逆行）に、推定した部位の弁輪（左側は CS・僧帽弁輪、右側・中隔は三尖弁輪）を中心に 5 点以上取得する。最早期の点が副伝導路の近くになる',
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
    hint: '最早期の部位に ABL を置いて RF 通電する（前中隔では His 電位に注意）',
    achieved: ({ engine }) => apAblated(engine),
  },
  {
    id: 'delta-gone', label: 'デルタ波の消失と非誘発を確認する',
    hint: '洞調律でデルタ波が消えたことを見て、もう一度期外刺激を行う',
    achieved: (ctx) => apAblated(ctx.engine) && protocolsAfterLastLesion(ctx).some((e) => e.status === 'noninducible'),
  },
];

/**
 * WPW・副伝導路（docs/DESIGN.md §5.4）。部位は左側自由壁（既定）・右側自由壁・後中隔・前中隔
 *  - 基質：弁輪の部位に副伝導路（順行性 ERP 280 ms・逆行性 ERP 250 ms・伝導 15 ms）。
 *    洞調律では心室が副伝導路から先に興奮し（デルタ波・短い PR）、His 経由の興奮と融合する
 *  - 誘発：副伝導路の近くの心房からの S1-S2。S2 が副伝導路の順行性 ERP に入ると房室結節だけを下行し、
 *    副伝導路を逆行して順行性 AVRT（心室刺激でも可）
 *  - 根治：副伝導路の頂点が病変 → デルタ波が消え、同じプロトコルで非誘発
 *  - 右側・中隔（と部位を伏せたとき）は三尖弁輪にハロー 20 極を置く
 */
export const wpwScenario: ArrhythmiaScenario = {
  id: 'wpw',
  label: 'WPW・副伝導路',
  chambers: ['LA'],
  anatomy: 'normal',
  induction: INDUCTION.leftFreeWall,
  inductionFor: (options) => INDUCTION[apSiteOf(options)],
  setupSubstrate(engine, options) {
    const site = apSiteOf(options);
    engine.caseOptions = { ...engine.caseOptions, ...options, apSite: site };
    const c = engine.conduction;
    c.pathways = c.pathways.slice(0, 1);
    c.pathways[0].params = { ...c.pathways[0].params, erpMs: WPW_AV_NODE_ERP_MS };
    c.setAccessoryPathway(accessoryPathwayVertices(engine, site), site);
    // 右側・中隔の副伝導路（と部位を伏せたとき）は、三尖弁輪のマッピングにハロー 20 極を置く
    if (site !== 'leftFreeWall' || engine.caseOptions.apHidden) {
      engine.setPlacement('halo', { kind: 'path', s: engine.paths.halo.defaultS, heightMm: 1 });
    }
  },
  structuralChecks(engine) {
    const ap = engine.conduction.ap;
    const recent = engine.conduction.vBeats.filter((b) => b.source !== 'pace').slice(-3);
    // 順行性 AVRT の拍も His 経由なので、頻拍・刺激中は「デルタ波が消えた」と判定しない（QA で見つかった判定の抜け）
    const sinus = engine.rhythm.state !== 'tachycardia' && engine.rhythm.state !== 'pacing';
    const noDelta = sinus && recent.length > 0 && recent.every((b) => b.source === 'his');
    return [
      { id: 'ap-lesion', label: '副伝導路の部位に病変がある', ok: apAblated(engine) && !!ap },
      { id: 'no-delta', label: 'デルタ波が消えた（洞調律の直近の拍が His 経由だけ）', ok: noDelta },
    ];
  },
  energies: ['rf'],
  goals: [...goals, reconnectionGoal(() => wpwScenario)],
};
