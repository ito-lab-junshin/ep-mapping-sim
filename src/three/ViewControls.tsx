import { useEffect, useRef, type ElementRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useSim } from '../state/store';
import { VIEW_PRESETS } from '../state/viewPresets';

const TARGET: [number, number, number] = [2, 0, -2];

/**
 * 視点の操作（OrbitControls）と、視点のプリセット（AP・PA・LAO・RAO・LL・RL・上）の要求に応じたカメラの移動。
 * プリセットは注視点からの距離を保ったまま向きだけ変える。カテーテルを選んでいても使える
 */
export function ViewControls({ enabled }: { enabled: boolean }) {
  const ref = useRef<ElementRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const preset = useSim((s) => s.viewPreset);
  useEffect(() => {
    const c = ref.current;
    if (!preset || !c) return;
    const d = camera.position.distanceTo(c.target);
    const [x, y, z] = VIEW_PRESETS[preset.name].dir;
    const n = Math.hypot(x, y, z);
    camera.position.set(c.target.x + (x / n) * d, c.target.y + (y / n) * d, c.target.z + (z / n) * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.target);
    c.update();
  }, [preset, camera]);
  return <OrbitControls ref={ref} enableDamping target={TARGET} enableRotate={enabled} enableZoom={enabled} />;
}
