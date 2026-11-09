import type { MappingSystemId } from '../core/types';

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
    /** 活性化マップのカラースケール（早→遅） */
    activationRamp: string[];
    /** ボルテージマップ（低電位→正常） */
    voltageRamp: string[];
    meshDefault: string;
    lesion: string;
  };
  terms: {
    geometryAcquire: string;   // 例: FAM / Fast Anatomical Map
    activationMap: string;     // 例: LAT map
    lesionTag: string;         // 例: Visitag / AutoMark / Lesion Tag
    localImpedance?: string;   // 例: DirectSense
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
      activationRamp: ['#ff2a2a', '#ffb000', '#f2f200', '#3cd13c', '#1ea8ff', '#8a3cff'],
      voltageRamp: ['#ff2a2a', '#ffb000', '#f2f200', '#3cd13c', '#9b5cff'],
      meshDefault: '#7f8699', lesion: '#ff3b3b',
    },
    terms: { geometryAcquire: 'FAM（高速解剖マップ）', activationMap: 'LAT マップ', lesionTag: 'VisiTag 風タグ' },
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
      activationRamp: ['#ffffff', '#ff4d4d', '#ffa500', '#ffff33', '#33ff66', '#3399ff', '#9933ff'],
      voltageRamp: ['#9a9a9a', '#ff4d4d', '#ffff33', '#33ff66', '#b366ff'],
      meshDefault: '#8b94a7', lesion: '#ff5a36',
    },
    terms: { geometryAcquire: '高密度収集（HD）', activationMap: 'LAT マップ', lesionTag: 'AutoMark 風タグ' },
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
      activationRamp: ['#ff3355', '#ff9f1a', '#ffe81a', '#3ddc84', '#1ab3ff', '#7a5cff'],
      voltageRamp: ['#ff3355', '#ff9f1a', '#ffe81a', '#3ddc84', '#7a5cff'],
      meshDefault: '#7d8893', lesion: '#ff4d6d',
    },
    terms: { geometryAcquire: 'ジオメトリ収集', activationMap: 'アクティベーションマップ', lesionTag: '病変タグ', localImpedance: 'DirectSense 風 局所インピーダンス' },
    features: {
      contactForce: false, localImpedance: true, ablationIndex: false, autoLesionTag: true,
      omnipolarEgm: false, hdGridLikeCatheter: false, multisplineCatheter: true, voltageThresholdSlider: true,
    },
  },
};
