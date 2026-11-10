import type { AnatomyDimensionSet } from '../core/types';
import { SimulationEngine } from '../core/sim/SimulationEngine';
import { loadParametricSync } from '../core/geometry/ChamberLoader';
import type { Placement } from '../core/catheter/placement';
import type { CatheterSpec } from '../core/catheter/catalog';
import type { SystemTheme } from '../systems';
import { SCENARIOS } from '../core/arrhythmia';
import { useSim } from './store';

/**
 * 解剖寸法セットごとに 1 つのシミュレーションエンジンを保持する（React の再描画とは独立）。
 * AF は afRemodeled、それ以外は normal（シナリオの anatomy）。
 * 3D ビューが tick() で進め、EGM パネルが同じインスタンスのバッファを読む。
 */
const engines = new Map<AnatomyDimensionSet, SimulationEngine>();

export function getEngine(set: AnatomyDimensionSet): SimulationEngine {
  let e = engines.get(set);
  if (!e) {
    e = new SimulationEngine(loadParametricSync(set));
    engines.set(set, e);
  }
  return e;
}

/** 選択中の症例のエンジン */
export function useEngine(): SimulationEngine {
  const set = useSim((s) => SCENARIOS[s.arrhythmia].anatomy);
  return getEngine(set);
}

/** カテーテルを置き直し、UI に知らせる */
export function placeCatheter(engine: SimulationEngine, id: string, placement: Placement | null) {
  engine.setPlacement(id, placement);
  useSim.getState().bumpPlacement();
}

/** テーマの機能フラグで使えるカテーテルか（多極スプライン／グリッド） */
export function catheterAvailable(spec: CatheterSpec, theme: SystemTheme): boolean {
  return !spec.requires || theme.features[spec.requires];
}
