import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ChamberMesh } from './ChamberMesh';
import { CatheterMarkers } from './CatheterMarkers';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { useEngine } from '../state/engine';
import type { SimulationEngine } from '../core/sim/SimulationEngine';

/** 実時間 1 s = シミュレーション 1 s でエンジンを進める（1 フレーム最大 50 ms） */
function EngineClock({ engine, running }: { engine: SimulationEngine; running: boolean }) {
  useFrame((_, delta) => {
    if (running) engine.tick(Math.min(delta * 1000, 50));
  });
  return null;
}

/**
 * 3D マッピングビュー。
 * TODO(Phase 2): マウスによるメッシュ表面へのカテーテル配置（raycast）、FAM 風のポイント収集モード。
 */
export function Scene() {
  const system = useSim((s) => s.system);
  const running = useSim((s) => s.running);
  const theme = SYSTEMS[system];
  const engine = useEngine();

  return (
    <Canvas camera={{ position: [0, 20, 90], fov: 45 }} style={{ background: theme.colors.background }}>
      <EngineClock engine={engine} running={running} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[40, 60, 80]} intensity={1.1} />
      <directionalLight position={[-40, -20, -60]} intensity={0.3} />
      <ChamberMesh key={engine.mesh.chamber} engine={engine} theme={theme} />
      <CatheterMarkers engine={engine} theme={theme} />
      <OrbitControls enableDamping />
    </Canvas>
  );
}
