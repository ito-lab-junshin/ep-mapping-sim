import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { SystemTheme } from '../systems';
import { useSim } from '../state/store';
import { SCENARIOS } from '../core/arrhythmia';
import { ABLATION } from '../core/params';

const Z = new THREE.Vector3(0, 0, 1);

/**
 * 通電のデバイス（クライオバルーン・PFA）と病変タグを 3D に描く。
 *  - クライオバルーン：選んだ PV の口に当てた半透明の球（軸のずれの分だけ、漏れのある側と反対へずれる）
 *  - PFA：バスケット型は PV 口の縁の輪、フラワー型は口を覆う円盤
 *  - 病変タグ：通電ごとに中心に小球（テーマの autoLesionTag のとき）
 * 形は模式（教育用）で、実機のデバイスの形状ではない。
 */
export function AblationDevices({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  useSim((s) => s.placementTick);
  const selected = useSim((s) => s.energy);
  const arrhythmia = useSim((s) => s.arrhythmia);
  const energy = SCENARIOS[arrhythmia].energies.includes(selected) ? selected : 'rf';
  const ctl = engine.ablation;
  const balloon = useRef<THREE.Mesh>(null);
  const pfa = useRef<THREE.Group>(null);
  const color = useMemo(() => new THREE.Color(theme.colors.lesion), [theme]);

  useFrame(() => {
    if (energy === 'cryo' && balloon.current) {
      const pv = engine.model.anatomy.la.pvs.find((p) => p.name === ctl.cryo.pv)!;
      const f = pv.frame, R = ABLATION.cryo.balloonDiameterMm / 2;
      const a = (ctl.cryo.leakAngleDeg * Math.PI) / 180;
      const shift = (ctl.cryo.misalignDeg / ABLATION.cryo.misalignLimitDeg) * 4 + (1 - ctl.cryo.push01) * 4;
      // 漏れのある側（leakAngle）と反対へずれ、押し付けが弱いほど PV 口から離れる
      const side = { x: -(Math.cos(a) * f.u.x + Math.sin(a) * f.v.x), y: -(Math.cos(a) * f.u.y + Math.sin(a) * f.v.y), z: -(Math.cos(a) * f.u.z + Math.sin(a) * f.v.z) };
      const back = R * 0.55 + (1 - ctl.cryo.push01) * 4;
      balloon.current.position.set(
        pv.ostium.x - f.axis.x * back + side.x * shift,
        pv.ostium.y - f.axis.y * back + side.y * shift,
        pv.ostium.z - f.axis.z * back + side.z * shift,
      );
      const m = balloon.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = ctl.active?.energy === 'cryo' ? 0.8 : 0.2;
    }
    if (energy === 'pfa' && pfa.current) {
      const pv = engine.model.anatomy.la.pvs.find((p) => p.name === ctl.pfa.pv)!;
      const axis = new THREE.Vector3(pv.frame.axis.x, pv.frame.axis.y, pv.frame.axis.z);
      pfa.current.quaternion.setFromUnitVectors(Z, axis);
      pfa.current.position.set(pv.ostium.x - axis.x * 2, pv.ostium.y - axis.y * 2, pv.ostium.z - axis.z * 2);
    }
  });

  const pfaPv = engine.model.anatomy.la.pvs.find((p) => p.name === ctl.pfa.pv)!;
  const outer = pfaPv.radius + (ctl.pfa.shape === 'basket' ? ABLATION.pfa.basketOuterMm : ABLATION.pfa.flowerOuterMm);
  const tags = theme.features.autoLesionTag ? engine.lesions : [];

  return (
    <group>
      {energy === 'cryo' && (
        <mesh ref={balloon} renderOrder={2}>
          <sphereGeometry args={[ABLATION.cryo.balloonDiameterMm / 2, 32, 24]} />
          <meshStandardMaterial color="#8fd3ff" emissive="#4fb3ff" emissiveIntensity={0.2} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
      {energy === 'pfa' && (
        <group ref={pfa} key={`${ctl.pfa.pv}-${ctl.pfa.shape}`}>
          {ctl.pfa.shape === 'basket' ? (
            // バスケット：PV の軸を含む面のスプラインを数本（口の縁に当たる）
            [0, 1, 2, 3, 4, 5].map((i) => (
              <group key={i} rotation={[0, 0, (i * Math.PI) / 6]}>
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -outer * 0.5]}>
                  <torusGeometry args={[outer, 0.35, 6, 48]} />
                  <meshStandardMaterial color="#ffe08a" emissive="#ffb84d" emissiveIntensity={0.5} transparent opacity={0.6} />
                </mesh>
              </group>
            ))
          ) : (
            // フラワー：口を覆う平たい円盤（花弁）
            [0, 1, 2, 3, 4].map((i) => (
              <mesh key={i} rotation={[0, 0, (i * 2 * Math.PI) / 5]} position={[0, 0, 0]}>
                <torusGeometry args={[outer * 0.6, 0.35, 6, 32, Math.PI * 1.2]} />
                <meshStandardMaterial color="#ffe08a" emissive="#ffb84d" emissiveIntensity={0.5} transparent opacity={0.8} />
              </mesh>
            ))
          )}
          <mesh>
            <ringGeometry args={[outer - 0.6, outer, 48]} />
            <meshBasicMaterial color="#ffb84d" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {tags.map((l) => {
        const p = engine.query.position(l.centerVertex), n = engine.query.normalAt(l.centerVertex);
        return (
          <mesh key={l.id} position={[p.x - n.x * 0.6, p.y - n.y * 0.6, p.z - n.z * 0.6]} renderOrder={3}>
            <sphereGeometry args={[l.energy === 'rf' ? 1.1 : 1.6, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4}
              transparent opacity={l.transmurality >= 1 ? 0.95 : 0.5} depthTest={false} />
          </mesh>
        );
      })}
    </group>
  );
}
