import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import { catheterGroup } from '../core/catheter/catalog';
import type { SystemTheme } from '../systems';

/**
 * メッシュ上のカテーテル電極を小球で示す（Phase 1 は表示のみ。ドラッグ配置は Phase 2）。
 * 接触している電極は不透明、非接触は半透明。
 */
export function CatheterMarkers({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  const onMesh = engine.catheters.filter((c) => c.source === 'mesh');
  const refs = useRef<Record<string, THREE.Mesh | null>>({});

  useFrame(() => {
    for (const cath of onMesh) {
      cath.electrodes.forEach((e, i) => {
        const m = refs.current[`${cath.id}-${i}`];
        if (!m) return;
        m.position.set(e.position.x, e.position.y, e.position.z);
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.opacity = e.contactVertex >= 0 ? 1 : 0.45;
      });
    }
  });

  return (
    <group>
      {onMesh.flatMap((cath) => cath.electrodes.map((_, i) => (
        <mesh key={`${engine.mesh.chamber}-${cath.id}-${i}`} ref={(m) => { refs.current[`${cath.id}-${i}`] = m; }} renderOrder={2}>
          <sphereGeometry args={[i === 0 && cath.kind === 'ablation_tip' ? 1.4 : 0.9, 12, 12]} />
          <meshStandardMaterial color={theme.colors.egmTrace[catheterGroup(cath.kind)]} transparent depthTest={false} emissive={theme.colors.egmTrace[catheterGroup(cath.kind)]} emissiveIntensity={0.4} />
        </mesh>
      )))}
    </group>
  );
}
