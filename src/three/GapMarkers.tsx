import { useEffect, useState } from 'react';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { SystemTheme } from '../systems';
import { useSim } from '../state/store';
import { SCENARIOS } from '../core/arrhythmia';
import type { Vec3 } from '../core/types';

/**
 * 隙間のヒントの印（症例に隙間のヒント gapHints があり、「隙間のヒント」をオンにしたときだけ。AF の PV・AFL の CTI。通電の欄・チュートリアルから切り替える。教育用の補助で実機の機能ではない）。
 * 完成していない PV・CTI の線の、最も短い通り道が病変のそばを抜ける所に球の印を出す（壁の裏側は隠れる。視点を回して探す）。1 秒ごとに計算し直す
 */
export function GapMarkers({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  const arrhythmia = useSim((s) => s.arrhythmia);
  const on = useSim((s) => s.gapHint);
  const hints = SCENARIOS[arrhythmia].gapHints;
  const [centers, setCenters] = useState<Vec3[]>([]);
  useEffect(() => {
    if (!on || !hints) { setCenters([]); return; }
    const update = () => setCenters(hints(engine).flatMap((g) => (g.showGaps ? g.clusters.map((c) => c.center) : [])));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [on, hints, engine]);
  if (!on || !hints) return null;
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
