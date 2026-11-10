import { useEffect } from 'react';
import type { ChamberId } from '../core/types';
import { SimulationEngine } from '../core/sim/SimulationEngine';
import { PRESET_LA, PRESET_RA } from '../core/geometry/presetChambers';
import { ablPlacement, csPlacement } from '../core/catheter/catalog';
import { SCENARIOS } from '../core/arrhythmia';
import { useSim } from './store';

/**
 * 心腔ごとに 1 つのシミュレーションエンジンを保持する（React の再描画とは独立）。
 * 3D ビューが tick() で進め、EGM パネルが同じインスタンスのバッファを読む。
 */
const engines = new Map<ChamberId, SimulationEngine>();

export function getEngine(chamber: ChamberId): SimulationEngine {
  let e = engines.get(chamber);
  if (!e) {
    e = new SimulationEngine(chamber === 'RA' ? PRESET_RA() : PRESET_LA());
    engines.set(chamber, e);
  }
  return e;
}

/** 選択中の症例のエンジン。スライダーの配置を反映する */
export function useEngine(): SimulationEngine {
  const chamber = useSim((s) => SCENARIOS[s.arrhythmia].chambers[0]);
  const c = useSim((s) => s.catheters);
  const engine = getEngine(chamber);
  useEffect(() => {
    const l = engine.landmarks;
    engine.setPlacement('cs', csPlacement(l, c.csInsertionDeg, c.csHeightMm));
    // ABL の方位はスライダー上「中隔からの角度」として扱い、心腔の向きの違いを吸収する
    engine.setPlacement('abl', ablPlacement(l.septalAzimuthDeg + l.posteriorSign * c.ablAzimuthDeg, c.ablElevationDeg, c.ablHeightMm));
  }, [engine, c]);
  return engine;
}
