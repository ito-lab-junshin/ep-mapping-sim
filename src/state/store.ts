import { create } from 'zustand';
import type { ArrhythmiaId, EnergyId, GeometryMode, MappingSystemId, TachycardiaState } from '../core/types';

interface SimState {
  system: MappingSystemId;
  arrhythmia: ArrhythmiaId;
  energy: EnergyId;
  geometryMode: GeometryMode;
  tachycardia: TachycardiaState;
  running: boolean;
  setSystem: (s: MappingSystemId) => void;
  setArrhythmia: (a: ArrhythmiaId) => void;
  setEnergy: (e: EnergyId) => void;
  setGeometryMode: (m: GeometryMode) => void;
  setTachycardia: (t: TachycardiaState) => void;
  toggleRunning: () => void;
}

export const useSim = create<SimState>((set) => ({
  system: 'carto',
  arrhythmia: 'af',
  energy: 'rf',
  geometryMode: 'preset',
  tachycardia: 'sinus',
  running: true,
  setSystem: (system) => set({ system }),
  setArrhythmia: (arrhythmia) => set({ arrhythmia, tachycardia: 'sinus' }),
  setEnergy: (energy) => set({ energy }),
  setGeometryMode: (geometryMode) => set({ geometryMode }),
  setTachycardia: (tachycardia) => set({ tachycardia }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
}));
