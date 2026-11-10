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

/** Phase 2 で追加したカテーテル寸法（すべて仮定値・教育用近似） */
export const CIRCULAR = {
  electrodes: 10,
  defaultDiameterMm: 20,
  diameterRangeMm: [15, 25] as const,
};
/** 多極スプライン（PentaRay 風）：5 本 × 4 電極。中心からの距離 mm（電極間隔 2-6-2） */
export const MULTISPLINE = { splines: 5, offsetsMm: [4, 6, 12, 14] as const };
/** グリッド型（HD Grid 風）：4 × 4 電極、等間隔 */
export const GRID = { rows: 4, cols: 4, spacingMm: 3 };
/** CS 電極の心外膜側へのずれ（CS 内腔の位置）と、弁輪から心房側への距離 mm */
export const CS_PATH = { epicardialOffsetMm: 1.5, aboveAnnulusMm: 3, defaultInsertionMm: 46 };

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
  /** His 4 極（d = 1-2、p = 3-4）の H・V。A はメッシュから φ モデルで計算する */
  his: { d: { h: 0.35, v: 1.0 }, p: { h: 0.15, v: 0.6 } },
  /** RV 心尖の局所 V（QRS 開始から 15 ms） */
  rv: { v: 3.0, delayMs: 15 },
} as const;

/**
 * 優先伝導路と心房間の連結の伝導速度 mm/ms。
 * P 波幅の目標値から逆算した仮定値（教育用近似）：洞結節刺激から両心房の全頂点が興奮し終わるまで
 * normal 90〜110 ms・afRemodeled 110〜130 ms、体表 ECG の P 波幅 < 120 ms（心電図の P 波正常上限）。
 * docs/DESIGN.md §4.2 の表と一致させること。
 */
export const CONDUCTION = {
  /** 一般心房筋（§4.2 の既定値） */
  atrialCv: 0.8,
  /**
   * 分界稜の長軸方向（上下）。横方向は一般心房筋と同じ。0 = 等方性（優先伝導路なし）。
   * 保留中：目標値（normal 90〜110 ms）は一般心房筋 0.8 mm/ms のままでは満たせないため、
   * 値はユーザーの判断待ち（暫定で無効）
   */
  cristaLongitudinalCv: 0,
  /** Bachmann 束の LA 側の帯の長軸方向（左右）。0 = 等方性。保留中（同上） */
  bachmannLongitudinalCv: 0,
  /** 心房間の連結（予定：Bachmann 束が最も速く、卵円窩縁・CS 筋束はそれより遅い）。保留中のため一般心房筋と同じ */
  bridgeCv: { bachmann: 0.8, fossa_rim: 0.8, cs_musculature: 0.8 },
};
