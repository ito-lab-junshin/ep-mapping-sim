import { create } from 'zustand';
import type { ArrhythmiaId, EcgLeadCount, EnergyId, GeometryMode, MappingSystemId, TachycardiaState } from '../core/types';
import type { SweepSpeed } from '../core/egm/display';
import { CS_DEFAULT_INSERTION_DEG } from '../core/catheter/catalog';
import { CONTACT_HEIGHT_MM } from '../core/params';

/** Phase 1 のスライダー配置（Phase 2 で raycast 配置に置き換える） */
export interface CatheterSliders {
  csInsertionDeg: number;
  csHeightMm: number;
  ablAzimuthDeg: number;
  ablElevationDeg: number;
  ablHeightMm: number;
}

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
  catheters: CatheterSliders;
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
  setCatheters: (p: Partial<CatheterSliders>) => void;
}

/** 心腔によって中隔の方位が違うため、ABL の既定は「中隔の反対＝側壁」 */
export const DEFAULT_CATHETERS: CatheterSliders = {
  csInsertionDeg: CS_DEFAULT_INSERTION_DEG,
  csHeightMm: CONTACT_HEIGHT_MM,
  ablAzimuthDeg: 180,
  ablElevationDeg: 10,
  ablHeightMm: CONTACT_HEIGHT_MM,
};

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
  catheters: DEFAULT_CATHETERS,
  setSystem: (system) => set({ system }),
  setArrhythmia: (arrhythmia) => set({ arrhythmia, tachycardia: 'sinus' }),
  setEnergy: (energy) => set({ energy }),
  setGeometryMode: (geometryMode) => set({ geometryMode }),
  setTachycardia: (tachycardia) => set({ tachycardia }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setEcgLeadCount: (ecgLeadCount) => set({ ecgLeadCount }),
  setSweepSpeed: (sweepSpeed) => set({ sweepSpeed }),
  setGain: (gain) => set({ gain }),
  setFrozen: (frozen) => set({ frozen }),
  setCatheters: (p) => set((s) => ({ catheters: { ...s.catheters, ...p } })),
}));
