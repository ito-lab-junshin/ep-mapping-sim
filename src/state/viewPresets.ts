/**
 * 3D の視点のプリセット（実機の慣習の呼び名。QA の所見 6・7：PV の後ろ側が見えない）。
 * 座標は +x = 患者の左、+y = 頭側、+z = 前方。カメラは注視点からこの向きに置く（LAO 45°・RAO 30°）
 */
export const VIEW_PRESETS = {
  AP: { label: 'AP', dir: [0, 0, 1] },
  PA: { label: 'PA', dir: [0, 0, -1] },
  LAO: { label: 'LAO', dir: [Math.SQRT1_2, 0, Math.SQRT1_2] },
  RAO: { label: 'RAO', dir: [-0.5, 0, Math.sqrt(3) / 2] },
  LL: { label: 'LL', dir: [1, 0, 0] },
  RL: { label: 'RL', dir: [-1, 0, 0] },
  SUP: { label: '上', dir: [0, 1, 0.02] },
} as const satisfies Record<string, { label: string; dir: readonly [number, number, number] }>;
export type ViewPresetName = keyof typeof VIEW_PRESETS;
export const VIEW_PRESET_NAMES = Object.keys(VIEW_PRESETS) as ViewPresetName[];
