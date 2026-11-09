import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';
import { ChamberMesh } from './ChamberMesh';
import { PRESET_LA, PRESET_RA } from '../core/geometry/presetChambers';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { SCENARIOS } from '../core/arrhythmia';

/**
 * 3D マッピングビュー。
 * TODO(Phase 2): カテーテル描画・マウスによるメッシュ表面への配置（raycast）、
 *   FAM 風のポイント収集モード。
 */
export function Scene() {
  const system = useSim((s) => s.system);
  const arrhythmia = useSim((s) => s.arrhythmia);
  const running = useSim((s) => s.running);
  const theme = SYSTEMS[system];
  const chamber = SCENARIOS[arrhythmia].chambers[0];
  const mesh = useMemo(() => (chamber === 'RA' ? PRESET_RA() : PRESET_LA()), [chamber]);

  return (
    <Canvas camera={{ position: [0, 20, 90], fov: 45 }} style={{ background: theme.colors.background }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[40, 60, 80]} intensity={1.1} />
      <directionalLight position={[-40, -20, -60]} intensity={0.3} />
      <ChamberMesh mesh={mesh} theme={theme} running={running} pacing={{ vertex: 0, cycleMs: 1000 }} />
      <OrbitControls enableDamping />
    </Canvas>
  );
}
