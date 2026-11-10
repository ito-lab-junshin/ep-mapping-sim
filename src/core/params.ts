/**
 * Phase 1 で新設した電気生理・カテーテルのパラメータ。
 * すべて教育用近似（docs/DESIGN.md §4.2「Phase 1 で追加した値」と一致させること）。
 * 研究用途ではシナリオ側で上書きする。
 */

/** 洞調律・房室伝導・心室（教育用近似） */
export const SINUS_CYCLE_MS = 800;   // 洞周期（75 bpm）
export const AH_MS = 80;             // 房室結節部位の心房興奮 → His（正常 50〜120 ms）
export const HV_MS = 45;             // His → 心室興奮開始（正常 35〜55 ms）
export const QRS_MS = 90;            // QRS 幅
export const QT_MS = 380;            // QRS 開始 → T 波終末
export const VENTRICLE_ERP_MS = 250; // 心室 ERP（1 コンパートメント）

/** 電極間隔 mm（電極中心間の近似。教育用近似） */
export const SPACING_MM = {
  cs_decapolar: [2, 8, 2, 8, 2, 8, 2, 8, 2],
  quadripolar: [5, 5, 5],          // His／HRA／RV
  ablation_tip: [1, 6, 2],         // 先端 3.5 mm
} as const;
export const ABLATION_TIP_LENGTH_MM = 3.5;
export const RING_WIDTH_MM = 1;            // リング電極の幅
export const ABLATION_SHAFT_TILT_DEG = 45; // 壁に対するアブレーションカテーテルの傾き

/** 心内膜面からの距離 mm（教育用近似） */
export const CONTACT_HEIGHT_MM = 1;      // 接触時の既定
export const CONTACT_THRESHOLD_MM = 2;   // これ以下を「接触」と判定
export const NONCONTACT_HEIGHT_MM = 5;   // 非接触の目安（≧ 5 mm）

/** 内部サンプリング間隔 ms（セルオートマトンの刻みと同じ 500 Hz） */
export const SAMPLE_MS = 2;

/** EGM パネル表示（画面上の目安） */
export const PX_PER_MM = 3.78;           // 96 dpi 相当の CSS px
export const EGM_HISTORY_MS = 15000;     // 25 mm/s でも画面幅以上を保持

/** EGM テンプレート振幅 mV（合成成分。教育用近似） */
export const TEMPLATE_AMPLITUDE_MV = {
  /** 心房カテーテルの双極に乗る心室遠隔電位 */
  farFieldV: { hra: 0.08, cs: 0.6, abl: 0.3 },
  /** His 4 極（d = 1-2、p = 3-4） */
  his: { d: { a: 0.3, h: 0.35, v: 1.0 }, p: { a: 0.8, h: 0.15, v: 0.6 } },
  /** RV 心尖の局所 V（QRS 開始から 15 ms） */
  rv: { v: 3.0, delayMs: 15 },
} as const;
