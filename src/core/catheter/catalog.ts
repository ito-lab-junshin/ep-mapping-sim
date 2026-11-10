import type { Catheter, CatheterKind, ChannelGroup } from '../types';
import { ABLATION_SHAFT_TILT_DEG, ABLATION_TIP_LENGTH_MM, CONTACT_HEIGHT_MM, RING_WIDTH_MM, SPACING_MM } from '../params';
import type { ChamberLandmarks } from '../geometry/landmarks';
import type { Placement } from './placement';

/** カテーテル種別 → EGM チャンネル群 */
export function catheterGroup(kind: CatheterKind): ChannelGroup {
  switch (kind) {
    case 'hra_quadripolar': return 'hra';
    case 'his_quadripolar': return 'his';
    case 'cs_decapolar': return 'cs';
    case 'rv_quadripolar': return 'rv';
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

export interface CatheterSpec {
  catheter: Catheter;
  /** mesh のときの配置と電極レイアウト（arc: 電極間隔、tip: シャフト上のオフセット） */
  placement?: Placement;
  layoutMm?: readonly number[];
  /** 表示順（§6: ECG → HRA → HIS → CS 9-10…1-2 → ABL d/p → RV）に並べたチャンネル */
  channels: { id: string; pair: [number, number] }[];
}

const blank = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: String(i + 1), position: { x: 0, y: 0, z: 0 }, contactVertex: -1, heightMm: 0,
}));

/** CS 挿入深さ deg（中隔＝CS 口から遠位電極までの方位角）の既定値 */
export const CS_DEFAULT_INSERTION_DEG = 110;
export const CS_ELEVATION_DEG = -35;

export function csPlacement(l: ChamberLandmarks, insertionDeg: number, heightMm: number): Placement {
  return {
    kind: 'arc',
    distalAzimuthDeg: l.septalAzimuthDeg + l.posteriorSign * insertionDeg,
    elevationDeg: CS_ELEVATION_DEG,
    proximalSign: (-l.posteriorSign) as 1 | -1,
    heightMm,
  };
}

export function ablPlacement(azimuthDeg: number, elevationDeg: number, heightMm: number): Placement {
  return { kind: 'tip', azimuthDeg, elevationDeg, heightMm, tiltDeg: ABLATION_SHAFT_TILT_DEG };
}

/** 表示中の心腔に応じた Phase 1 のカテーテル一式 */
export function defaultCatheters(l: ChamberLandmarks): CatheterSpec[] {
  const specs: CatheterSpec[] = [];

  // HRA: RA 症例では高位右房（洞結節付近）に置く。LA 症例では表示中の心腔にない。
  const hraMesh = l.hasHra;
  specs.push({
    catheter: { id: 'hra', kind: 'hra_quadripolar', label: 'HRA', electrodes: blank(4), bipoles: [[0, 1], [2, 3]], source: hraMesh ? 'mesh' : 'outside' },
    placement: hraMesh ? { kind: 'arc', distalAzimuthDeg: 160, elevationDeg: 50, proximalSign: 1, heightMm: CONTACT_HEIGHT_MM } : undefined,
    layoutMm: SPACING_MM.quadripolar,
    channels: [{ id: 'HRA 1-2', pair: [0, 1] }, { id: 'HRA 3-4', pair: [2, 3] }],
  });

  // His: Phase 2 で RA 連結後に置き換える仮実装。A・H・V をタイミングから合成する。
  specs.push({
    catheter: { id: 'his', kind: 'his_quadripolar', label: 'HIS', electrodes: blank(4), bipoles: [[0, 1], [2, 3]], source: 'synthetic' },
    channels: [{ id: 'HIS d', pair: [0, 1] }, { id: 'HIS p', pair: [2, 3] }],
  });

  specs.push({
    catheter: { id: 'cs', kind: 'cs_decapolar', label: 'CS', electrodes: blank(10), bipoles: [[8, 9], [6, 7], [4, 5], [2, 3], [0, 1]], source: 'mesh' },
    placement: csPlacement(l, CS_DEFAULT_INSERTION_DEG, CONTACT_HEIGHT_MM),
    layoutMm: SPACING_MM.cs_decapolar,
    channels: [
      { id: 'CS 9-10', pair: [8, 9] }, { id: 'CS 7-8', pair: [6, 7] }, { id: 'CS 5-6', pair: [4, 5] },
      { id: 'CS 3-4', pair: [2, 3] }, { id: 'CS 1-2', pair: [0, 1] },
    ],
  });

  specs.push({
    catheter: { id: 'abl', kind: 'ablation_tip', label: 'ABL', electrodes: blank(4), bipoles: [[0, 1], [2, 3]], source: 'mesh' },
    placement: ablPlacement(l.septalAzimuthDeg + 180, 10, CONTACT_HEIGHT_MM),
    layoutMm: ablationOffsetsMm(),
    channels: [{ id: 'ABL d', pair: [0, 1] }, { id: 'ABL p', pair: [2, 3] }],
  });

  // RV: 心室はメッシュを持たない（§5.5）。QRS 開始に同期した局所 V を合成する。
  specs.push({
    catheter: { id: 'rv', kind: 'rv_quadripolar', label: 'RV', electrodes: blank(4), bipoles: [[0, 1]], source: 'synthetic' },
    channels: [{ id: 'RV 1-2', pair: [0, 1] }],
  });

  return specs;
}
