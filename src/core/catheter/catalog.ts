import type { Catheter, CatheterKind, ChannelGroup, Electrode } from '../types';
import type { BiatrialModel } from '../geometry/parametric/atria';
import { ABLATION_TIP_LENGTH_MM, CIRCULAR, CONTACT_HEIGHT_MM, GRID, MULTISPLINE, RING_WIDTH_MM, SPACING_MM } from '../params';
import { dot, norm, sub, v3 } from '../geometry/parametric/sdf';
import { REGION_ID } from '../geometry/regions';
import type { Vec3 } from '../types';
import type { GuidedPathId } from './guidedPaths';
import type { Placement } from './placement';

/** カテーテル種別 → EGM チャンネル群 */
export function catheterGroup(kind: CatheterKind): ChannelGroup {
  switch (kind) {
    case 'hra_quadripolar': return 'hra';
    case 'his_quadripolar': return 'his';
    case 'cs_decapolar': return 'cs';
    case 'halo_20': return 'halo';
    case 'rv_quadripolar': return 'rv';
    case 'circular_mapping': case 'multispline': case 'grid': return 'map';
    default: return 'abl';
  }
}

/** アブレーションカテーテルの電極中心のシャフト上の位置 mm（先端電極の中心 = 0） */
export function ablationOffsetsMm(): number[] {
  const [g1, g2, g3] = SPACING_MM.ablation_tip;
  const tipC = ABLATION_TIP_LENGTH_MM / 2;
  const r2 = ABLATION_TIP_LENGTH_MM + g1 + RING_WIDTH_MM / 2;
  const r3 = r2 + RING_WIDTH_MM + g2;
  const r4 = r3 + RING_WIDTH_MM + g3;
  return [0, r2 - tipC, r3 - tipC, r4 - tipC];
}

/** テーマの機能フラグで出し分けるカテーテル */
export type CatheterFeature = 'multisplineCatheter' | 'hdGridLikeCatheter';

export interface CatheterSpec {
  catheter: Catheter;
  mode: 'path' | 'free' | 'synthetic';
  pathId?: GuidedPathId;
  /** path：電極間隔、free（ABL）：シャフト上のオフセット */
  layoutMm?: readonly number[];
  placement: Placement | null;
  channels: { id: string; pair: [number, number] }[];
  /** この機能フラグが有効なテーマでだけ使える */
  requires?: CatheterFeature;
}

const blank = (n: number): Electrode[] => Array.from({ length: n }, (_, i) => ({
  id: String(i + 1), position: { x: 0, y: 0, z: 0 }, contactVertex: -1, heightMm: Infinity,
}));

function cath(id: string, kind: CatheterKind, label: string, n: number, bipoles: [number, number][], source: Catheter['source'] = 'mesh'): Catheter {
  return { id, kind, label, electrodes: blank(n), bipoles, source, placed: false };
}

/** 隣り合う電極の双極 1-2, 2-3, …（環状） */
const consecutive = (n: number): [number, number][] => Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);

/**
 * Phase 2 のカテーテル一式（§10。クライオバルーン・PFA は Phase 5）。
 * 表示順（§6）：ECG → HRA → HIS → CS 9-10…1-2 → 環状／多極 → ABL d/p → RV
 */
export function defaultCatheters(model: BiatrialModel): CatheterSpec[] {
  const specs: CatheterSpec[] = [];

  specs.push({
    catheter: cath('hra', 'hra_quadripolar', 'HRA', 4, [[0, 1], [2, 3]]),
    mode: 'path', pathId: 'hra', layoutMm: SPACING_MM.quadripolar,
    placement: { kind: 'path', s: Number.NaN, heightMm: CONTACT_HEIGHT_MM },
    channels: [{ id: 'HRA 1-2', pair: [0, 1] }, { id: 'HRA 3-4', pair: [2, 3] }],
  });

  // His：A はメッシュ（Koch 三角）から φ モデルで計算し、H・V は房室伝導のタイミングから合成する
  specs.push({
    catheter: cath('his', 'his_quadripolar', 'HIS', 4, [[0, 1], [2, 3]]),
    mode: 'path', pathId: 'his', layoutMm: SPACING_MM.quadripolar,
    placement: { kind: 'path', s: Number.NaN, heightMm: CONTACT_HEIGHT_MM },
    channels: [{ id: 'HIS d', pair: [0, 1] }, { id: 'HIS p', pair: [2, 3] }],
  });

  specs.push({
    catheter: cath('cs', 'cs_decapolar', 'CS', 10, [[8, 9], [6, 7], [4, 5], [2, 3], [0, 1]]),
    mode: 'path', pathId: 'cs', layoutMm: SPACING_MM.cs_decapolar,
    placement: { kind: 'path', s: Number.NaN, heightMm: 0 },
    channels: [
      { id: 'CS 9-10', pair: [8, 9] }, { id: 'CS 7-8', pair: [6, 7] }, { id: 'CS 5-6', pair: [4, 5] },
      { id: 'CS 3-4', pair: [2, 3] }, { id: 'CS 1-2', pair: [0, 1] },
    ],
  });

  // ハロー 20 極：三尖弁輪の側壁に沿って置く（遠位 1-2 が CTI の側壁側、近位 19-20 が前上方）。
  // 既定では置かない（AFL の症例で置く）
  const halo: [number, number][] = Array.from({ length: 10 }, (_, i) => [2 * i, 2 * i + 1]);
  specs.push({
    catheter: cath('halo', 'halo_20', 'ハロー（Halo 20 極）', 20, halo.slice().reverse()),
    mode: 'path', pathId: 'halo', layoutMm: SPACING_MM.halo_20, placement: null,
    channels: halo.slice().reverse().map(([a, b]) => ({ id: `H ${a + 1}-${b + 1}`, pair: [a, b] as [number, number] })),
  });

  const ring = consecutive(CIRCULAR.electrodes);
  specs.push({
    catheter: cath('circ', 'circular_mapping', '環状', CIRCULAR.electrodes, ring),
    mode: 'free', placement: null,
    channels: ring.map(([a, b]) => ({ id: `CIRC ${a + 1}-${b + 1}`, pair: [a, b] as [number, number] })),
  });

  const ms: [number, number][] = [];
  const msCh: CatheterSpec['channels'] = [];
  for (let s = 0; s < MULTISPLINE.splines; s++) {
    const base = s * MULTISPLINE.offsetsMm.length;
    const L = String.fromCharCode(65 + s);
    ms.push([base, base + 1], [base + 2, base + 3]);
    msCh.push({ id: `MS ${L}1-2`, pair: [base, base + 1] }, { id: `MS ${L}3-4`, pair: [base + 2, base + 3] });
  }
  specs.push({
    catheter: cath('ms', 'multispline', '多極スプライン', MULTISPLINE.splines * MULTISPLINE.offsetsMm.length, ms),
    mode: 'free', placement: null, channels: msCh, requires: 'multisplineCatheter',
  });

  const grid: [number, number][] = [];
  const gridCh: CatheterSpec['channels'] = [];
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols - 1; c++) {
    const a = r * GRID.cols + c;
    const L = String.fromCharCode(65 + r);
    grid.push([a, a + 1]);
    gridCh.push({ id: `GRID ${L}${c + 1}-${c + 2}`, pair: [a, a + 1] });
  }
  specs.push({
    catheter: cath('grid', 'grid', 'グリッド', GRID.rows * GRID.cols, grid),
    mode: 'free', placement: null, channels: gridCh, requires: 'hdGridLikeCatheter',
  });

  // ABL：既定では LA 本体の側壁（左心耳・PV を避ける）に置く
  const lateral = laBodyPointTowards(model, v3(1, -0.35, 0));
  specs.push({
    catheter: cath('abl', 'ablation_tip', 'ABL', 4, [[0, 1], [2, 3]]),
    mode: 'free', layoutMm: ablationOffsetsMm(),
    placement: { kind: 'free', point: lateral, heightMm: CONTACT_HEIGHT_MM, rotationDeg: 0 },
    channels: [{ id: 'ABL d', pair: [0, 1] }, { id: 'ABL p', pair: [2, 3] }],
  });

  // RV：心室はメッシュを持たない（§5.5）。QRS 開始に同期した局所 V を合成する
  const rv = cath('rv', 'rv_quadripolar', 'RV', 4, [[0, 1]], 'synthetic');
  rv.placed = true;
  specs.push({ catheter: rv, mode: 'synthetic', placement: null, channels: [{ id: 'RV 1-2', pair: [0, 1] }] });

  return specs;
}

/** LA 本体（左心耳・PV・弁輪以外）で、LA 中心から見て dir の方向にある表面の点 */
export function laBodyPointTowards(model: BiatrialModel, dir: Vec3): Vec3 {
  const body = new Set(['la_body', 'la_anterior', 'la_posterior', 'la_roof', 'la_septum'].map((r) => REGION_ID[r as keyof typeof REGION_ID]));
  const c = model.anatomy.la.center;
  const d = norm(dir);
  const p = model.mesh.positions;
  let best = 0, bestDot = -Infinity;
  for (let v = 0; v < p.length / 3; v++) {
    if (!body.has(model.mesh.regionOfVertex[v])) continue;
    const q = norm(sub(v3(p[3 * v], p[3 * v + 1], p[3 * v + 2]), c));
    const s = dot(q, d);
    if (s > bestDot) { bestDot = s; best = v; }
  }
  return v3(p[3 * best], p[3 * best + 1], p[3 * best + 2]);
}
