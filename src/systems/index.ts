import type { ChannelGroup, MappingSystemId } from '../core/types';

/**
 * マッピングシステムごとの「見た目」と「固有機能フラグ」。
 *
 * 免責: CARTO®(Biosense Webster / J&J MedTech)、EnSite™(Abbott)、OPAL HDx™(Boston Scientific)
 * は各社の商標。本アプリは教育目的の非公式シミュレータであり、各社と無関係。
 * 画面構成・配色・用語は公開情報から受ける印象を「風」に再現したもので、
 * 内部アルゴリズムは一切再現していない（docs/DESIGN.md §8）。
 */
export interface SystemTheme {
  id: MappingSystemId;
  name: string;
  vendorNote: string;
  colors: {
    background: string;   // 3D ビュー背景
    panel: string;        // パネル背景
    text: string;
    accent: string;
    egmGrid: string;
    /** EGM パネルの波形色（チャンネル群ごと） */
    egmTrace: Record<ChannelGroup, string>;
    /** 活性化マップのカラースケール（早→遅） */
    activationRamp: string[];
    /** ボルテージマップ（低電位→正常） */
    voltageRamp: string[];
    meshDefault: string;
    lesion: string;
    /** ボルテージマップの瘢痕（閾値未満） */
    scar: string;
    /** マップの「データなし」（取得点から到達距離より遠い） */
    noData: string;
    /** 伝播アニメーションの波面 */
    wavefront: string;
    /** 取得点の既定色（マップ表示でない時） */
    point: string;
  };
  /** 取得点の印の形と大きさ（mm） */
  pointMarker: { shape: 'sphere' | 'box' | 'octahedron'; sizeMm: number };
  terms: {
    geometryAcquire: string;   // 例: FAM / Fast Anatomical Map
    activationMap: string;     // 例: LAT map
    voltageMap: string;
    propagationMap: string;
    /** 取得点の呼び方 */
    mapPoint: string;
    /** 補間の到達距離（fill threshold 相当） */
    fillThreshold: string;
    lesionTag: string;         // 例: Visitag / AutoMark / Lesion Tag
    localImpedance?: string;   // 例: DirectSense
    /** 病変指標の呼び方（features.ablationIndex のとき表示。尺度は独自：部位の目標量 = 100 %） */
    lesionIndex?: string;
  };
  features: {
    contactForce: boolean;         // 接触圧表示（RF 先端）
    localImpedance: boolean;       // 局所インピーダンス
    ablationIndex: boolean;        // AI 風の病変指標
    autoLesionTag: boolean;        // 自動病変タグ
    omnipolarEgm: boolean;         // 全方位（方向非依存）EGM 風
    hdGridLikeCatheter: boolean;   // グリッド型カテーテル
    multisplineCatheter: boolean;  // 多極スプライン型カテーテル
    voltageThresholdSlider: boolean;
  };
}

export const SYSTEMS: Record<MappingSystemId, SystemTheme> = {
  carto: {
    id: 'carto',
    name: 'CARTO 風',
    vendorNote: 'Biosense Webster CARTO® の画面構成を参考にした非公式テーマ',
    colors: {
      background: '#1b1f27', panel: '#262b36', text: '#e8eaf0', accent: '#f5c542',
      egmGrid: '#2f3542',
      egmTrace: { ecg: '#e8eaf0', hra: '#ffd166', his: '#f5f5f5', cs: '#3cd13c', map: '#c792ea', abl: '#ff5a5a', rv: '#4fc3f7' },
      activationRamp: ['#ff2a2a', '#ffb000', '#f2f200', '#3cd13c', '#1ea8ff', '#8a3cff'],
      voltageRamp: ['#ff2a2a', '#ffb000', '#f2f200', '#3cd13c', '#9b5cff'],
      meshDefault: '#7f8699', lesion: '#ff3b3b',
      scar: '#8c8c8c', noData: '#4a4f5c', wavefront: '#ff2a2a', point: '#f5f5f5',
    },
    pointMarker: { shape: 'sphere', sizeMm: 0.9 },
    terms: {
      geometryAcquire: 'FAM（高速解剖マップ）', activationMap: 'LAT マップ', lesionTag: 'VisiTag 風タグ', lesionIndex: 'Ablation Index 風 病変指標',
      voltageMap: 'ボルテージマップ（bipolar）', propagationMap: '伝播マップ（propagation）', mapPoint: '取得点', fillThreshold: '補間の到達距離（fill threshold）',
    },
    features: {
      contactForce: true, localImpedance: false, ablationIndex: true, autoLesionTag: true,
      omnipolarEgm: false, hdGridLikeCatheter: false, multisplineCatheter: true, voltageThresholdSlider: true,
    },
  },
  ensite: {
    id: 'ensite',
    name: 'EnSite 風',
    vendorNote: 'Abbott EnSite™ X の画面構成を参考にした非公式テーマ',
    colors: {
      background: '#0f1a2b', panel: '#162338', text: '#e6eef8', accent: '#39b6ff',
      egmGrid: '#1f3350',
      egmTrace: { ecg: '#ffffff', hra: '#ffff33', his: '#ff66ff', cs: '#33ff66', map: '#ffa64d', abl: '#ff4d4d', rv: '#39b6ff' },
      activationRamp: ['#ffffff', '#ff4d4d', '#ffa500', '#ffff33', '#33ff66', '#3399ff', '#9933ff'],
      voltageRamp: ['#9a9a9a', '#ff4d4d', '#ffff33', '#33ff66', '#b366ff'],
      meshDefault: '#8b94a7', lesion: '#ff5a36',
      scar: '#9a9a9a', noData: '#3d4a60', wavefront: '#ffffff', point: '#ffd24d',
    },
    pointMarker: { shape: 'box', sizeMm: 1.1 },
    terms: {
      geometryAcquire: '高密度収集（HD）', activationMap: 'LAT マップ', lesionTag: 'AutoMark 風タグ',
      voltageMap: 'ボルテージマップ（peak-to-peak）', propagationMap: 'ウェーブフロント表示', mapPoint: 'マッピング点', fillThreshold: '補間の到達距離（interpolation）',
    },
    features: {
      contactForce: true, localImpedance: false, ablationIndex: false, autoLesionTag: true,
      omnipolarEgm: true, hdGridLikeCatheter: true, multisplineCatheter: false, voltageThresholdSlider: true,
    },
  },
  opal: {
    id: 'opal',
    name: 'OPAL HDx 風',
    vendorNote: 'Boston Scientific OPAL HDx™ の画面構成を参考にした非公式テーマ',
    colors: {
      background: '#101418', panel: '#1a2027', text: '#eef2f5', accent: '#38d39f',
      egmGrid: '#263038',
      egmTrace: { ecg: '#eef2f5', hra: '#ffe81a', his: '#c39bff', cs: '#3ddc84', map: '#ff9f1a', abl: '#ff3355', rv: '#1ab3ff' },
      activationRamp: ['#ff3355', '#ff9f1a', '#ffe81a', '#3ddc84', '#1ab3ff', '#7a5cff'],
      voltageRamp: ['#ff3355', '#ff9f1a', '#ffe81a', '#3ddc84', '#7a5cff'],
      meshDefault: '#7d8893', lesion: '#ff4d6d',
      scar: '#8e8e8e', noData: '#3a434c', wavefront: '#38d39f', point: '#e0f7ef',
    },
    pointMarker: { shape: 'octahedron', sizeMm: 1.0 },
    terms: {
      geometryAcquire: 'ジオメトリ収集', activationMap: 'アクティベーションマップ', lesionTag: '病変タグ', localImpedance: 'DirectSense 風 局所インピーダンス',
      voltageMap: 'ボルテージマップ', propagationMap: 'プロパゲーション表示', mapPoint: 'ビート', fillThreshold: '補間の到達距離',
    },
    features: {
      contactForce: false, localImpedance: true, ablationIndex: false, autoLesionTag: true,
      omnipolarEgm: false, hdGridLikeCatheter: false, multisplineCatheter: true, voltageThresholdSlider: true,
    },
  },
};
