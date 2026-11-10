import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { SystemTheme } from '../systems';
import { useSim } from '../state/store';
import { getPoints } from '../state/engine';
import { finiteRange, latColor, voltageColor } from '../core/mapping/colorScale';

/**
 * 取得点の印。形・大きさ・既定色はテーマ（pointMarker / colors.point）から取り、
 * LAT・ボルテージ表示中はその値の色で塗る。LAT が取れなかった点（null）は既定色。
 */
export function PointMarkers({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  const mapVersion = useSim((s) => s.mapVersion);
  const view = useSim((s) => s.mapType);
  const show = useSim((s) => s.showPoints);
  const settings = useSim((s) => s.mapSettings);
  const ref = useRef<THREE.InstancedMesh>(null);
  const points = getPoints(engine).points;
  const count = points.length;

  const geometry = useMemo(() => {
    const r = theme.pointMarker.sizeMm;
    if (theme.pointMarker.shape === 'box') return new THREE.BoxGeometry(r * 1.4, r * 1.4, r * 1.4);
    if (theme.pointMarker.shape === 'octahedron') return new THREE.OctahedronGeometry(r * 1.1);
    return new THREE.SphereGeometry(r, 10, 10);
  }, [theme]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const latRange = finiteRange(points.map((p) => p.latMs ?? Number.NaN));
    const mat = new THREE.Matrix4();
    const c = new THREE.Color();
    points.forEach((p, i) => {
      mat.makeTranslation(p.position.x, p.position.y, p.position.z);
      m.setMatrixAt(i, mat);
      if (view === 'lat' && p.latMs !== null && latRange) c.setRGB(...latColor(p.latMs, latRange.min, latRange.max, theme.colors.activationRamp));
      else if (view === 'voltage') c.setRGB(...voltageColor(p.voltageMv, settings.voltageScarMv, settings.voltageNormalMv, theme.colors.voltageRamp, theme.colors.scar));
      else c.set(theme.colors.point);
      m.setColorAt(i, c);
    });
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [points, count, mapVersion, view, theme, settings.voltageScarMv, settings.voltageNormalMv]);

  if (!show || count === 0) return null;
  return (
    <instancedMesh key={`${theme.id}-${Math.ceil(count / 256)}`} ref={ref} args={[geometry, undefined, Math.ceil(count / 256) * 256]} renderOrder={4}>
      <meshStandardMaterial depthTest={false} transparent emissiveIntensity={0.3} />
    </instancedMesh>
  );
}
