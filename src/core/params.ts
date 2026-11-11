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
/**
 * 収集モード（FAM 風、docs/DESIGN.md §9.2）。仮定値（教育用近似）。
 * 壁から wallReachMm 以内の電極が、まわり revealRadiusMm の表面を「収集済み」にする。
 * 収集点は間隔 pointSpacingMm 以上で記録する
 */
export const ACQUISITION = { wallReachMm: 3, revealRadiusMm: 5, pointSpacingMm: 1.5 } as const;

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
  fast: { ahMs: AH_MS, erpMs: 320, decrementMaxMs: 40, decrementTauMs: 60, retroMs: 60, retroErpMs: 200 },
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

/**
 * 通常型 AFL の基質（§5.2）。解剖は拡大した RA（aflRemodeled：RA と三尖弁輪が正常の 1.2 倍）。
 * CTI の伝導速度 0.3 mm/ms は §4.2 の範囲（0.3〜0.5）の下端、CTI の ERP は §4.2 の 230 ms。
 * RA の伝導速度・ERP と稜の横方向の伝導は、目標（周期長 220〜260 ms・興奮間隙 ≧ 20 ms・反時計回り・
 * CS 口からのバーストで誘発）から逆算した仮定値（教育用近似）。このとき周期長 255 ms・興奮間隙 75 ms。
 * 旋回は CTI の ERP（230 ms）より長い周期でしか続かないため、RA の伝導を遅くする必要がある（リモデリング）
 */
export const AFL_SUBSTRATE = {
  raCv: 0.6,
  raErpMs: 180,
  ctiCv: 0.3,
  ctiErpMs: 230,
  /** 分界稜・Eustachian 稜の横方向の伝導速度。0 = 完全な機能的ブロック（遅いが通れる値だと、稜を横切る興奮で回路が崩れる） */
  cristaTransverseCv: 0,
};

/**
 * アブレーション（Phase 5、docs/DESIGN.md §7）。すべて仮定値（教育用近似）。RF の係数は臨床経験に基づく。
 * 各社製品のアルゴリズム（Ablation Index・DirectSense など）とは無関係。
 */
export const ABLATION = {
  /** 通電の時計の倍速（EGM・伝播は実時間のまま） */
  clockSpeeds: [1, 5, 10] as const,
  defaultClockSpeed: 5,
  /**
   * 部位ごとの壁厚 mm（貫壁性 = 病変の深さ / 壁厚）。仮定値（教育用近似）。
   * CTI は一様でなく、三尖弁輪側（前庭部）ctiTv から IVC 側 ctiIvc へ直線的に薄くなる
   */
  wallThicknessMm: { la: 2, pv: 1.5, ra: 2, ctiTv: 5, ctiIvc: 3.5, koch: 2 },
  /** 貫壁性 t < 1 の頂点の viability = 1 − partialSlowing × t（伝導は遅くなるが残る） */
  partialSlowing: 0.7,
  rf: {
    powerRangeW: [25, 50] as const,
    defaultPowerW: 30,
    defaultDurationS: 30,
    maxDurationS: 60,
    /**
     * RF の病変モデルの係数（臨床経験に基づく教育用近似。文献値に差し替えるときはここだけを直す）。
     *  - 量（基準条件の秒数に換算した通電量）：毎秒 (出力 / refPowerW)^powerExp × (接触圧 / refContactG)^contactExp を積算
     *  - 病変指標 = 量 / その部位の目標量 × 100 %（後壁 30 s・前壁 40 s：30 W・20 g で後壁の目標に約 30 秒、前壁の目標に約 40 秒）
     *  - 深さ = saturationDepthMm × (1 − exp(−量 / tauRefS))（時間に対して飽和する。指標 180 % でも深さは 1.8 倍にならない）
     *    基準条件で 30 s：深さ 3.3 mm、40 s：4.0 mm、60 s：5.0 mm
     *  - 病変の半径 = 深さ × radiusPerDepth（指標 100 % で径 6.6〜8 mm）
     */
    dose: { refPowerW: 30, refContactG: 20, powerExp: 1.2, contactExp: 0.7 },
    targetRefS: { posterior: 30, anterior: 40 },
    saturationDepthMm: 6.6,
    tauRefS: 43.3,
    radiusPerDepth: 1,
    /** 接触圧：押し込み量（接触の閾値 2 mm からの距離）0〜1.5 mm を 0〜40 g に対応 */
    contactForceMaxG: 40,
    contactForcePushRangeMm: 1.5,
  },
  localImpedance: { bloodOhm: 100, contactMaxOhm: 40, maxDropOhm: 30 },
  cryo: {
    balloonDiameterMm: 28,
    /** 閉塞度 = 押し付け × (1 − 軸のずれ / misalignLimitDeg) */
    misalignLimitDeg: 30,
    /** この閉塞度以上で PV を一周する帯が完成（未満は閉塞の悪い側に隙間） */
    fullRingOcclusion: 0.8,
    /** 最低温度 = minTempBaseC + minTempSlopeC × 閉塞度 */
    minTempBaseC: -40,
    minTempSlopeC: -20,
    /** 深さ = maxDepthMm × (|最低温度| / 60) × (1 − exp(−時間 / tauS)) */
    maxDepthMm: 3,
    tauS: 60,
    defaultDurationS: 180,
    /** 病変の帯：PV 口から LA 側 antralMm まで、PV 口の外側へ marginMm まで */
    antralMm: 7,
    marginMm: 6,
  },
  pfa: {
    /** 1 回の通電で加わる貫壁性（2 回以上で貫壁性 1） */
    transmuralityPerApplication: 0.5,
    /** バスケット型：PV 口の縁の輪（口の半径 − 2 〜 + 4 mm）、フラワー型：PV 口を覆う円盤（口の半径 + 6 mm まで） */
    basketInnerMm: -2,
    basketOuterMm: 4,
    flowerOuterMm: 6,
    antralMm: 6,
  },
  /** 接合部調律：遅伝導路部位から junctionalRadiusMm 以内で RF 通電中、周期 junctionalClMs で接合部の興奮 */
  junctionalRadiusMm: 5,
  junctionalClMs: [500, 700] as const,
  /** His 部位にこれより近い通電には注意を出す（合併症は扱わない） */
  hisWarningMm: 5,
};
