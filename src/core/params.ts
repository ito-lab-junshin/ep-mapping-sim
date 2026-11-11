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

/**
 * 房室結節の経路・His・心室・副伝導路（Phase 4。docs/DESIGN.md §4.2・§5.3・§5.4 と一致させること）。
 * 既存の値（AH 80 ms、速伝導路 ERP 320 ms、遅伝導路 ERP 200 ms、副伝導路の順行性 ERP 280 ms）以外は仮定値（教育用近似）。
 *
 * 経路の伝導時間 = 基本の AH + 減衰分。減衰分 = decrementMaxMs × exp(−(連結期 − ERP) / decrementTauMs)
 * （ERP に近い早い期外刺激ほど AH が延びる。連結期 < ERP はブロック）
 */
export const AV_NODE = {
  fast: { ahMs: AH_MS, erpMs: 320, decrementMaxMs: 40, decrementTauMs: 60, retroMs: 40, retroErpMs: 200 },
  slow: { ahMs: 200, erpMs: 200, decrementMaxMs: 40, decrementTauMs: 60 },
};
/** His の ERP（His と心室の不応期を分けるため。値は心室 ERP と同じ） */
export const HIS_ERP_MS = VENTRICLE_ERP_MS;
/** 副伝導路（左側自由壁） */
export const ACCESSORY_PATHWAY = {
  /** 心房付着部 ↔ 心室付着部の伝導時間 */
  conductionMs: 15,
  antegradeErpMs: 280,
  retrogradeErpMs: 250,
  /** 心室の興奮開始（QRS 開始）から副伝導路の心室付着部（左室側壁の弁輪部）までの心室内伝導時間。VA ≈ 95 ms（順行性 AVRT の RP > 70 ms）になるよう置いた */
  ventricularDelayMs: 80,
};
/** 刺激（ペーシング）のアーチファクト mV（全チャンネルに 1 サンプル） */
export const PACING_ARTIFACT_MV = 0.8;

/** 刺激プロトコルの既定値（§5.6。教科書的な値） */
export const PROTOCOL = {
  s1Ms: 600,
  s1Beats: 8,
  /** S2 の開始 = S1 − 100 ms、刻み 10 ms、下限 */
  s2StartOffsetMs: 100,
  s2StepMs: 10,
  s2MinMs: 150,
  /** バースト：300 → 200 ms を 10 ms 刻み、各 10 拍 */
  burstFromMs: 300,
  burstToMs: 200,
  burstStepMs: 10,
  burstBeats: 10,
  /** 1 列の刺激が終わってから次の列までの観察時間 ms。仮定値 */
  observeMs: 1500,
};

/** 調律の判定（仮定値・教育用近似）：周期がこれ未満の興奮が、刺激をやめてから sustainMs 以上続けば頻拍 */
export const RHYTHM = {
  tachycardiaClMs: 400,
  sustainMs: 5000,
};

/**
 * WPW シナリオの房室結節の ERP。順行性 AVRT（周期 約 280 ms）で房室結節が伝導でき、
 * かつ副伝導路の順行性 ERP（280 ms）より短い（誘発の窓ができる）ように置いた仮定値（教育用近似）
 */
export const WPW_AV_NODE_ERP_MS = 250;
/** 副伝導路の心房付着部の頂点数（§5.4：1〜3 頂点） */
export const WPW_AP_VERTICES = 2;

/** AF シナリオ（§5.1。値は §4.2 の表と設計書の範囲） */
export const AF_SUBSTRATE = {
  /** 心房筋の ERP の範囲（場所によるばらつき） */
  atrialErpMs: [160, 200] as const,
  /** PV 筋スリーブ */
  pvSleeveCv: 0.5,
  pvSleeveErpMs: 180,
  /** PV トリガーの発火周期 */
  triggerClMs: [150, 250] as const,
  /** ERP のばらつきをなめらかにする回数（斑状の不均一性の大きさ）。仮定値 */
  erpSmoothingIterations: 6,
};
