import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import { catheterGroup } from '../core/catheter/catalog';
import type { SystemTheme } from '../systems';
import { useSim } from '../state/store';
import { catheterAvailable } from '../state/engine';

/**
 * カテーテル電極を小球で示す。接触している電極は不透明、非接触は半透明。
 * 選択中のカテーテルは少し大きく描く。
 */
export function CatheterMarkers({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  useSim((s) => s.placementTick);
  const active = useSim((s) => s.activeCatheter);
  const specs = engine.specs.filter((s) => s.catheter.source === 'mesh' && catheterAvailable(s, theme));
  const refs = useRef<Record<string, THREE.Mesh | null>>({});

  useFrame(() => {
    for (const spec of specs) {
      const cath = spec.catheter;
      cath.electrodes.forEach((e, i) => {
        const m = refs.current[`${cath.id}-${i}`];
        if (!m) return;
        m.visible = cath.placed;
        m.position.set(e.position.x, e.position.y, e.position.z);
        (m.material as THREE.MeshStandardMaterial).opacity = e.contactVertex >= 0 ? 1 : 0.4;
      });
    }
  });

  return (
    <group>
      {specs.flatMap(({ catheter: cath }) => cath.electrodes.map((_, i) => {
        const c = theme.colors.egmTrace[catheterGroup(cath.kind)];
        const r = (i === 0 && cath.kind === 'ablation_tip' ? 1.4 : 0.8) * (active === cath.id ? 1.35 : 1);
        return (
          <mesh key={`${engine.mesh.parts?.[0].vertexCount}-${cath.id}-${i}`} ref={(m) => { refs.current[`${cath.id}-${i}`] = m; }} renderOrder={3}>
            <sphereGeometry args={[r, 12, 12]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.45} transparent depthTest={false} />
          </mesh>
        );
      }))}
    </group>
  );
}
