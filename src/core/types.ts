/**
 * シミュレータ全体で共有する型定義。
 * ここを変更するときは docs/DESIGN.md の「データモデル」も更新すること。
 */

/** 3D マッピングシステム（UI テーマ＋固有機能の切り替え単位） */
export type MappingSystemId = 'carto' | 'ensite' | 'opal';

/** 不整脈シナリオ */
export type ArrhythmiaId = 'af' | 'afl_cti' | 'avnrt' | 'wpw';

/** 心腔（BIATRIAL = LA と RA を連結した 1 つのメッシュ） */
export type ChamberId = 'LA' | 'RA' | 'LV' | 'RV' | 'CS' | 'BIATRIAL';

/** アブレーションのエネルギー */
export type EnergyId = 'rf' | 'cryo' | 'pfa';

/** ジオメトリー作成モード */
export type GeometryMode = 'acquire' | 'preset';

export interface Vec3 { x: number; y: number; z: number }

/** EGM パネルのチャンネル群（並び順・配色の単位） */
export type ChannelGroup = 'ecg' | 'hra' | 'his' | 'cs' | 'map' | 'abl' | 'rv';

/** 体表 ECG の誘導数（12 誘導は Phase 7） */
export type EcgLeadCount = 1 | 3 | 12;

/** 体表 ECG の誘導（Phase 1 は I・II・V1） */
export type EcgLead = 'I' | 'II' | 'V1';

/**
 * 心臓表面メッシュ。頂点ごとに電気生理パラメータを持ち、
 * セルオートマトンの「セル」= 頂点 として扱う。
 */
export interface SurfaceMesh {
  chamber: ChamberId;
  positions: Float32Array;   // [x0,y0,z0, x1,y1,z1, ...] 単位 mm
  indices: Uint32Array;      // 三角形インデックス
  neighbors: Int32Array[];   // 頂点ごとの隣接頂点リスト（伝播計算用）
  /** 解剖ラベル（PV 口、CTI、Koch 三角、弁輪など）。頂点 → ラベル ID */
  regionOfVertex: Uint8Array;
  regionNames: string[];
  /** 複数の心腔をまとめたメッシュの内訳（頂点・三角形の範囲） */
  parts?: MeshPart[];
  /** 心房間の連結（三角形をもたない隣接辺。伝播にだけ効く） */
  bridges?: InterAtrialBridge[];
}

export interface MeshPart {
  chamber: ChamberId;
  vertexStart: number;
  vertexCount: number;
  /** indices 配列内の開始位置と長さ（三角形数 × 3） */
  indexStart: number;
  indexCount: number;
}

export interface InterAtrialBridge {
  name: 'bachmann' | 'fossa_rim' | 'cs_musculature';
  /** [RA の頂点, LA の頂点] の組 */
  pairs: [number, number][];
}

/** 頂点ごとの電気生理状態（セルオートマトン） */
export interface TissueState {
  /** 0=静止, 1=興奮(絶対不応), 2=相対不応 */
  phase: Uint8Array;
  /** 現 phase に入ってからの経過時間 ms */
  timer: Float32Array;
  /** 最新の活性化時刻 ms（活性化マップ用） */
  lastActivation: Float32Array;
  /** 伝導速度 mm/ms（部位・線維化・病変で変化） */
  conductionVelocity: Float32Array;
  /** 有効不応期 ms */
  erp: Float32Array;
  /** 組織の生存度 0〜1（0 = 完全病変、伝導しない） */
  viability: Float32Array;
  /** 双極電位の振幅スケール mV（ボルテージマップ用） */
  voltage: Float32Array;
}

/** カテーテルの種類 */
export type CatheterKind =
  | 'cs_decapolar'      // CS 10 極
  | 'his_quadripolar'   // His 4 極
  | 'rv_quadripolar'    // RV 4 極
  | 'hra_quadripolar'   // 高位右房 4 極
  | 'circular_mapping'  // 環状マッピング（Lasso 風）
  | 'multispline'       // 多極（PentaRay 風）
  | 'grid'              // グリッド型（HD Grid 風）
  | 'ablation_tip'      // アブレーション先端（RF）
  | 'cryo_balloon'      // クライオバルーン
  | 'pfa_basket';       // PFA バスケット／フラワー

export interface Electrode {
  id: string;
  position: Vec3;
  /** 接触している頂点 index（-1 = 非接触、血中） */
  contactVertex: number;
  /** 心内膜面からの距離 mm（≦ 2 mm で接触とみなす） */
  heightMm: number;
}

/**
 * カテーテルの信号源。
 *  - mesh: 心房メッシュ上に置かれ、φ モデルで EGM を計算する（His は H・V を合成で加える）
 *  - synthetic: 房室伝導モデルのタイミングからテンプレート合成（RV。心室はメッシュを持たない）
 */
export type CatheterSource = 'mesh' | 'synthetic';

export interface Catheter {
  id: string;
  kind: CatheterKind;
  label: string;
  electrodes: Electrode[];
  /** 対になる双極チャンネル（電極 index の組） */
  bipoles: [number, number][];
  source: CatheterSource;
  /** 置かれているか（自由配置のカテーテルは置くまで EGM を出さない） */
  placed: boolean;
}

/** 固定長リングバッファ（実装は core/egm/RingBuffer.ts） */
export interface SampleBuffer {
  readonly capacity: number;
  readonly length: number;
  push(x: number): void;
  /** 古い順の i 番目（0 = 最古） */
  at(i: number): number;
  clear(): void;
}

/** 心内心電図 1 チャンネル（体表 ECG もここに含める） */
export interface EgmChannel {
  id: string;         // 例: "CS 9-10", "ABL d", "HIS p", "II"
  /** 体表 ECG は 'ecg' */
  catheterId: string;
  group: ChannelGroup;
  mode: 'bipolar' | 'unipolar' | 'surface';
  /** 直近 N サンプル（mV）。サンプル間隔は SimulationEngine.sampleMs */
  buffer: SampleBuffer;
  /** チャンネル固有の倍率（表示ゲインに掛ける） */
  gain: number;
}

/** 病変（アブレーションの結果） */
export interface Lesion {
  id: string;
  energy: EnergyId;
  centerVertex: number;
  /** 影響半径 mm（RF: 出力・時間・接触で決定、PFA: デバイス形状で決定） */
  radiusMm: number;
  /** 貫壁性の推定 0〜1 */
  transmurality: number;
  createdAt: number;
  /** システム固有の表示用指標（Visitag 風タグ、局所インピーダンス低下など） */
  tags: Record<string, number>;
}

/** 頻拍の状態 */
export type TachycardiaState =
  | 'sinus'
  | 'pacing'
  | 'tachycardia'
  | 'terminated'
  | 'noninducible';

/** 解剖寸法のセット（core/geometry/parametric/dimensions.ts） */
export type AnatomyDimensionSet = 'normal' | 'afRemodeled';

/** シナリオ（不整脈ごとの基質定義と判定ロジック） */
export interface ArrhythmiaScenario {
  id: ArrhythmiaId;
  label: string;
  /** 主に表示する心腔（シミュレーションは常に両心房） */
  chambers: ChamberId[];
  /** 使う解剖寸法（AF は afRemodeled、それ以外は normal） */
  anatomy: AnatomyDimensionSet;
  /** メッシュに基質（遅伝導路、副伝導路、PV トリガーなど）を設定する */
  setupSubstrate(mesh: SurfaceMesh, tissue: TissueState): void;
  /** 誘発プロトコル（期外刺激・バースト）に対して頻拍が始まるかを返す */
  tryInduce(tissue: TissueState, protocol: PacingProtocol): boolean;
  /** 病変集合から「治療完了（根治）」かを判定する */
  isCured(mesh: SurfaceMesh, tissue: TissueState, lesions: Lesion[]): boolean;
  /** 教育用のゴール説明（例：PV 隔離の確認方法） */
  goals: string[];
}

export interface PacingProtocol {
  site: string;              // 例: "CS 9-10", "HRA"
  cycleLengthMs: number;     // S1
  extraStimuliMs?: number[]; // S2, S3...
  burstBeats?: number;
}
