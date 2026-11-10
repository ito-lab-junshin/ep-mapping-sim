import { create } from 'zustand';
import type { ArrhythmiaId, EcgLeadCount, EnergyId, GeometryMode, MapSettings, MapType, MappingSystemId, TachycardiaState } from '../core/types';
import { MAP_DEFAULTS } from '../core/params';
import type { SweepSpeed } from '../core/egm/display';

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  woiBeforeMs: MAP_DEFAULTS.woiBeforeMs,
  woiAfterMs: MAP_DEFAULTS.woiAfterMs,
  woiManual: false,
  referenceChannel: MAP_DEFAULTS.referenceChannel,
  latMethod: 'bipolarPeak',
  fillThresholdMm: MAP_DEFAULTS.fillThresholdMm,
  voltageScarMv: MAP_DEFAULTS.voltageScarMv,
  voltageNormalMv: MAP_DEFAULTS.voltageNormalMv,
};

interface SimState {
  system: MappingSystemId;
  arrhythmia: ArrhythmiaId;
  energy: EnergyId;
  geometryMode: GeometryMode;
  tachycardia: TachycardiaState;
  running: boolean;
  /** 体表 ECG の誘導数 */
  ecgLeadCount: EcgLeadCount;
  /** EGM スイープ速度 mm/s */
  sweepSpeed: SweepSpeed;
  /** EGM 表示ゲイン（倍率） */
  gain: number;
  /** EGM フリーズ（計測用。シミュレーションは止めない） */
  frozen: boolean;
  /** 操作対象のカテーテル（3D 上のクリック・ドラッグ・ホイールが効く） */
  activeCatheter: string | null;
  /** 3D ビューでドラッグ中か */
  dragging: boolean;
  /** 症例の主な心房でない方の表示 */
  otherAtrium: 'translucent' | 'hidden';
  /** 3D ビューの表示モード */
  mapType: MapType;
  mapSettings: MapSettings;
  /** 多極カテーテルの 1 拍ごとの自動取得 */
  autoAcquire: boolean;
  showPoints: boolean;
  /** 取得点が変わるたびに増える（補間の再計算用） */
  mapVersion: number;
  /** 直近の取得の結果（表示用） */
  acquireMessage: string;
  /** マウスを乗せている領域（表示用） */
  hoveredRegion: string | null;
  /** カテーテル配置が変わるたびに増える（UI の再描画用） */
  placementTick: number;
  setSystem: (s: MappingSystemId) => void;
  setArrhythmia: (a: ArrhythmiaId) => void;
  setEnergy: (e: EnergyId) => void;
  setGeometryMode: (m: GeometryMode) => void;
  setTachycardia: (t: TachycardiaState) => void;
  toggleRunning: () => void;
  setEcgLeadCount: (n: EcgLeadCount) => void;
  setSweepSpeed: (s: SweepSpeed) => void;
  setGain: (g: number) => void;
  setFrozen: (f: boolean) => void;
  setActiveCatheter: (id: string | null) => void;
  setDragging: (d: boolean) => void;
  setOtherAtrium: (o: 'translucent' | 'hidden') => void;
  setMapType: (t: MapType) => void;
  setMapSettings: (p: Partial<MapSettings>) => void;
  setAutoAcquire: (a: boolean) => void;
  setShowPoints: (s: boolean) => void;
  bumpMap: (message?: string) => void;
  setHoveredRegion: (r: string | null) => void;
  bumpPlacement: () => void;
}

export const useSim = create<SimState>((set) => ({
  system: 'carto',
  arrhythmia: 'af',
  energy: 'rf',
  geometryMode: 'preset',
  tachycardia: 'sinus',
  running: true,
  ecgLeadCount: 3,
  sweepSpeed: 100,
  gain: 1,
  frozen: false,
  activeCatheter: null,
  dragging: false,
  otherAtrium: 'translucent',
  mapType: 'live',
  mapSettings: DEFAULT_MAP_SETTINGS,
  autoAcquire: false,
  showPoints: true,
  mapVersion: 0,
  acquireMessage: '',
  hoveredRegion: null,
  placementTick: 0,
  setSystem: (system) => set({ system }),
  setArrhythmia: (arrhythmia) => set({ arrhythmia, tachycardia: 'sinus', activeCatheter: null }),
  setEnergy: (energy) => set({ energy }),
  setGeometryMode: (geometryMode) => set({ geometryMode }),
  setTachycardia: (tachycardia) => set({ tachycardia }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setEcgLeadCount: (ecgLeadCount) => set({ ecgLeadCount }),
  setSweepSpeed: (sweepSpeed) => set({ sweepSpeed }),
  setGain: (gain) => set({ gain }),
  setFrozen: (frozen) => set({ frozen }),
  setActiveCatheter: (activeCatheter) => set({ activeCatheter }),
  setDragging: (dragging) => set({ dragging }),
  setOtherAtrium: (otherAtrium) => set({ otherAtrium }),
  setMapType: (mapType) => set({ mapType }),
  setMapSettings: (p) => set((s) => ({ mapSettings: { ...s.mapSettings, ...p } })),
  setAutoAcquire: (autoAcquire) => set({ autoAcquire }),
  setShowPoints: (showPoints) => set({ showPoints }),
  bumpMap: (message) => set((s) => ({ mapVersion: s.mapVersion + 1, acquireMessage: message ?? s.acquireMessage })),
  setHoveredRegion: (hoveredRegion) => set((s) => (s.hoveredRegion === hoveredRegion ? s : { hoveredRegion })),
  bumpPlacement: () => set((s) => ({ placementTick: s.placementTick + 1 })),
}));
