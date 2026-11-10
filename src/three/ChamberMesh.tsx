import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { SystemTheme } from '../systems';

interface Props {
  engine: SimulationEngine;
  theme: SystemTheme;
}

/**
 * 心腔メッシュを描画し、セルオートマトンの状態を頂点カラーで表示する。
 * シミュレーションは SimulationEngine（Scene が tick）にあり、ここでは描画だけ行う。
 * 現状は「直近の活性化を activationRamp で着色」する簡易版。
 * TODO(Phase 3): LAT / ボルテージ / 伝播（アニメーション）の表示モード切り替え。
 */
export function ChamberMesh({ engine, theme }: Props) {
  const mesh = engine.mesh;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(mesh.positions.length), 3));
    g.computeVertexNormals();
    return g;
  }, [mesh]);

  const ramp = useMemo(() => theme.colors.activationRamp.map((c) => new THREE.Color(c)), [theme]);
  const base = useMemo(() => new THREE.Color(theme.colors.meshDefault), [theme]);
  const lesion = useMemo(() => new THREE.Color(theme.colors.lesion), [theme]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const t = engine.ca.tissue;
    const now = engine.time;
    const tmp = new THREE.Color();
    for (let v = 0; v < t.phase.length; v++) {
      const age = now - t.lastActivation[v];
      if (t.viability[v] <= 0) tmp.copy(lesion);
      else if (t.lastActivation[v] < 0 || age > 200) tmp.copy(base);
      else {
        const f = Math.min(1, age / 200) * (ramp.length - 1);
        const i = Math.floor(f);
        tmp.copy(ramp[i]).lerp(ramp[Math.min(i + 1, ramp.length - 1)], f - i);
      }
      colors.setXYZ(v, tmp.r, tmp.g, tmp.b);
    }
    colors.needsUpdate = true;
  });

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.05} transparent opacity={0.85} />
    </mesh>
  );
}
