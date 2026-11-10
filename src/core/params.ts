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
  farFieldV: { hra: 0.08, cs: 0.6, abl: 0.3, map: 0.05 },
  /** His 4 極（d = 1-2、p = 3-4）の H・V。A はメッシュから φ モデルで計算する */
  his: { d: { h: 0.35, v: 1.0 }, p: { h: 0.15, v: 0.6 } },
  /** RV 心尖の局所 V（QRS 開始から 15 ms） */
  rv: { v: 3.0, delayMs: 15 },
} as const;

/**
 * 心房の伝導速度 mm/ms（docs/DESIGN.md §4.2 と一致させること）。
 * 一般心房筋 1.0 mm/ms は、体表 ECG の P 波幅の目標（normal 120 ms 未満。心電図の P 波正常上限）を
 * 満たすよう調整した教育用近似。このとき normal で P 波幅 約 106 ms、全頂点の興奮終了 約 121 ms。
 */
export const CONDUCTION = {
  /** 一般心房筋 */
  atrialCv: 1.0,
  /**
   * 分界稜の長軸方向（上下）の伝導速度。0 = 異方性なし。
   * 洞調律では優先伝導路を入れない方針。Phase 4 の通常型 AFL の基質で、分界稜の横方向の遅い伝導
   * （機能的ブロック線）を作るときに異方性を設定する（§5.2）
   */
  cristaLongitudinalCv: 0,
  /** Bachmann 束の LA 側の帯の長軸方向。0 = 異方性なし（優先伝導路は入れない方針） */
  bachmannLongitudinalCv: 0,
  /** 心房間の連結。優先伝導路を入れない方針のため、いずれも一般心房筋と同じ */
  bridgeCv: { bachmann: 1.0, fossa_rim: 1.0, cs_musculature: 1.0 },
};

/**
 * マップ（Phase 3）の既定値。いずれも UI で変更でき、仮定値（教育用近似）。
 * docs/DESIGN.md §4.2・§6・§8.2 と一致させること。
 */
export const MAP_DEFAULTS = {
  /** 補間の到達距離（fill threshold 相当）mm と範囲 */
  fillThresholdMm: 10,
  fillThresholdRangeMm: [5, 30] as const,
  /** 関心窓（WOI）：基準チャンネルの興奮からの範囲 ms */
  woiBeforeMs: -150,
  woiAfterMs: 100,
  /** ボルテージ閾値 mV：心房の双極電位で広く用いられる慣用値（出典未確認の仮定値） */
  voltageScarMv: 0.1,
  voltageNormalMv: 0.5,
  /** 基準チャンネル */
  referenceChannel: 'CS 9-10',
  /** 単極電位の履歴の長さ ms（LAT の −dV/dt 用） */
  unipolarHistoryMs: 1500,
  /** 自動取得で、既存の点からこの距離 mm 以内なら取り直さない */
  autoMinSpacingMm: 1.5,
};
