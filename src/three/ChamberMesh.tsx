import { useEffect, useMemo } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { MeshPart } from '../core/types';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { SystemTheme } from '../systems';
import { REGIONS, REGION_LABEL_JA } from '../core/geometry/regions';
import { useSim, type MeshView } from '../state/store';
import { placeCatheter } from '../state/engine';
import { CONTACT_HEIGHT_MM } from '../core/params';

interface Props {
  engine: SimulationEngine;
  theme: SystemTheme;
  view: MeshView;
  /** 主に表示する心房（他方は半透明か非表示） */
  focus: MeshPart['chamber'];
}

/** 領域ラベル表示の配色（テーマに依らない識別用の色） */
const regionColor = (id: number) => new THREE.Color().setHSL(((id * 0.618034) % 1), 0.55, 0.55);

/**
 * 両心房メッシュを描画する。シミュレーションは SimulationEngine（Scene が tick）にあり、ここでは描画と
 * マウス操作（raycast によるカテーテル配置）だけを行う。
 *  - 伝播：直近の活性化を activationRamp で着色
 *  - 領域：解剖ラベルごとに色分けし、マウスを乗せた領域名を表示
 * TODO(Phase 3): LAT / ボルテージ表示。
 */
export function ChamberMesh({ engine, theme, view, focus }: Props) {
  const mesh = engine.mesh;
  const otherAtrium = useSim((s) => s.otherAtrium);

  // 頂点属性は両心房で共有し、心房ごとに index の範囲だけ変える
  const { position, color } = useMemo(() => ({
    position: new THREE.BufferAttribute(mesh.positions, 3),
    color: new THREE.BufferAttribute(new Float32Array(mesh.positions.length), 3),
  }), [mesh]);
  const geometries = useMemo(() => (mesh.parts ?? []).map((part) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('color', color);
    g.setIndex(new THREE.BufferAttribute(mesh.indices.subarray(part.indexStart, part.indexStart + part.indexCount), 1));
    g.computeVertexNormals();
    return { part, g };
  }), [mesh, position, color]);
  useEffect(() => () => geometries.forEach(({ g }) => g.dispose()), [geometries]);

  const ramp = useMemo(() => theme.colors.activationRamp.map((c) => new THREE.Color(c)), [theme]);
  const base = useMemo(() => new THREE.Color(theme.colors.meshDefault), [theme]);
  const lesion = useMemo(() => new THREE.Color(theme.colors.lesion), [theme]);

  useFrame(() => {
    const t = engine.ca.tissue;
    const now = engine.time;
    const tmp = new THREE.Color();
    for (let v = 0; v < t.phase.length; v++) {
      if (t.viability[v] <= 0) tmp.copy(lesion);
      else if (view === 'regions') tmp.copy(regionColor(mesh.regionOfVertex[v]));
      else {
        const age = now - t.lastActivation[v];
        if (t.lastActivation[v] < 0 || age > 200) tmp.copy(base);
        else {
          const f = Math.min(1, age / 200) * (ramp.length - 1);
          const i = Math.floor(f);
          tmp.copy(ramp[i]).lerp(ramp[Math.min(i + 1, ramp.length - 1)], f - i);
        }
      }
      color.setXYZ(v, tmp.r, tmp.g, tmp.b);
    }
    color.needsUpdate = true;
  });

  // ── マウス操作：選択中のカテーテルをクリック／ドラッグで置き、ホイールで押し込み・回転
  const place = (point: THREE.Vector3) => {
    const id = useSim.getState().activeCatheter;
    const spec = id ? engine.spec(id) : undefined;
    if (!spec) return;
    if (spec.mode === 'path') {
      engine.dragOnPath(spec.catheter.id, point);
      useSim.getState().bumpPlacement();
    } else if (spec.mode === 'free') {
      const prev = spec.placement?.kind === 'free' ? spec.placement : null;
      placeCatheter(engine, spec.catheter.id, {
        kind: 'free', point: { x: point.x, y: point.y, z: point.z },
        heightMm: prev?.heightMm ?? CONTACT_HEIGHT_MM, rotationDeg: prev?.rotationDeg ?? 0, diameterMm: prev?.diameterMm,
      });
    }
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!useSim.getState().activeCatheter || e.button !== 0) return;
    e.stopPropagation();
    useSim.getState().setDragging(true);
    place(e.point);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const s = useSim.getState();
    if (view === 'regions' || !s.activeCatheter) {
      const v = e.face ? e.face.a : -1;
      s.setHoveredRegion(v >= 0 ? REGION_LABEL_JA[REGIONS[mesh.regionOfVertex[v]]] : null);
    }
    if (s.dragging) { e.stopPropagation(); place(e.point); }
  };
  const onWheel = (e: ThreeEvent<WheelEvent>) => {
    const id = useSim.getState().activeCatheter;
    const spec = id ? engine.spec(id) : undefined;
    const p = spec?.placement;
    if (!spec || !p || spec.catheter.kind === 'cs_decapolar') return;
    e.stopPropagation();
    const dir = Math.sign(e.deltaY);
    if (e.shiftKey && p.kind === 'free') {
      placeCatheter(engine, spec.catheter.id, { ...p, rotationDeg: (p.rotationDeg + dir * 10 + 360) % 360 });
    } else {
      // ホイールを手前に回す（deltaY < 0）と押し込む
      const heightMm = Math.min(10, Math.max(0.5, p.heightMm + dir * 0.5));
      placeCatheter(engine, spec.catheter.id, { ...p, heightMm });
    }
  };

  return (
    <group onPointerDown={onDown} onPointerMove={onMove} onWheel={onWheel}
      onPointerOut={() => useSim.getState().setHoveredRegion(null)}>
      {geometries.map(({ part, g }) => {
        const isFocus = part.chamber === focus;
        if (!isFocus && otherAtrium === 'hidden') return null;
        return (
          <mesh key={part.chamber} geometry={g} renderOrder={isFocus ? 1 : 0}>
            <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.05}
              transparent opacity={isFocus ? 0.9 : 0.25} depthWrite={isFocus} />
          </mesh>
        );
      })}
    </group>
  );
}
