import { create } from 'zustand';
import type { ArrhythmiaId, EcgLeadCount, EnergyId, GeometryMode, MappingSystemId, TachycardiaState } from '../core/types';
import type { SweepSpeed } from '../core/egm/display';

/** 3D ビューの表示モード（Phase 3 で LAT・ボルテージを追加） */
export type MeshView = 'propagation' | 'regions';

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
  meshView: MeshView;
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
  setMeshView: (v: MeshView) => void;
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
  meshView: 'propagation',
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
  setMeshView: (meshView) => set({ meshView }),
  setHoveredRegion: (hoveredRegion) => set((s) => (s.hoveredRegion === hoveredRegion ? s : { hoveredRegion })),
  bumpPlacement: () => set((s) => ({ placementTick: s.placementTick + 1 })),
}));
