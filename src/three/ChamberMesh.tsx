import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SurfaceMesh } from '../core/types';
import { CellularAutomaton } from '../core/propagation/CellularAutomaton';
import type { SystemTheme } from '../systems';

interface Props {
  mesh: SurfaceMesh;
  theme: SystemTheme;
  running: boolean;
  /** 洞調律の刺激点（頂点 index）と周期 ms。null なら刺激しない */
  pacing: { vertex: number; cycleMs: number } | null;
}

/**
 * 心腔メッシュを描画し、セルオートマトンの状態を頂点カラーで表示する。
 * 現状は「興奮（phase=1）を明るく、直近の活性化を activationRamp で着色」する簡易版。
 * TODO(Phase 3): LAT / ボルテージ / 伝播（アニメーション）の表示モード切り替え。
 */
export function ChamberMesh({ mesh, theme, running, pacing }: Props) {
  const ca = useMemo(() => new CellularAutomaton(mesh), [mesh]);
  const lastPace = useRef(0);

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

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    if (!running) return;
    const dtMs = Math.min(delta * 1000, 50);
    // 実時間 1 s = シミュレーション 1 s
    const steps = Math.max(1, Math.round(dtMs / 2));
    for (let i = 0; i < steps; i++) {
      if (pacing && ca.time - lastPace.current >= pacing.cycleMs) {
        ca.stimulate(pacing.vertex);
        lastPace.current = ca.time;
      }
      ca.step(dtMs / steps);
    }
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const t = ca.tissue;
    const tmp = new THREE.Color();
    for (let v = 0; v < t.phase.length; v++) {
      const age = ca.time - t.lastActivation[v];
      if (t.lastActivation[v] < 0 || age > 200) tmp.copy(base);
      else {
        const f = Math.min(1, age / 200) * (ramp.length - 1);
        const i = Math.floor(f);
        tmp.copy(ramp[i]).lerp(ramp[Math.min(i + 1, ramp.length - 1)], f - i);
      }
      if (t.viability[v] <= 0) tmp.set(theme.colors.lesion);
      colors.setXYZ(v, tmp.r, tmp.g, tmp.b);
    }
    colors.needsUpdate = true;
  });

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.05} />
    </mesh>
  );
}
