import { useEffect, useState } from 'react';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { SystemTheme } from '../systems';
import { useSim } from '../state/store';
import { PV_NAMES } from '../core/geometry/regions';
import { pvGaps } from '../core/arrhythmia/pv';
import type { Vec3 } from '../core/types';

/**
 * PV の隙間のヒントの印（AF の症例で「隙間のヒント」をオンにしたときだけ。通電の欄・PVI のチュートリアルから切り替える。教育用の補助で実機の機能ではない）。
 * 隔離されていない PV の、最も短い通り道が病変のそばを抜ける所に球の印を出す（壁の裏側は隠れる。視点を回して探す）。1 秒ごとに計算し直す
 */
export function GapMarkers({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  const on = useSim((s) => s.gapHint && s.arrhythmia === 'af');
  const [centers, setCenters] = useState<Vec3[]>([]);
  useEffect(() => {
    if (!on) { setCenters([]); return; }
    const update = () => setCenters(PV_NAMES.flatMap((pv) => pvGaps(engine, pv).clusters.map((c) => c.center)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [on, engine]);
  if (!on) return null;
  return (
    <group>
      {centers.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]}>
          <sphereGeometry args={[2.6, 14, 14]} />
          <meshBasicMaterial color={theme.colors.accent} />
        </mesh>
      ))}
    </group>
  );
}
