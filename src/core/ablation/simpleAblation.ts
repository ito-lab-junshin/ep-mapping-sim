import type { Lesion, Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';

/**
 * 簡易通電（Phase 4）：点 point の最寄り頂点を中心に、半径 radiusMm の病変を即座に作る。
 * 半径以内は貫壁性の完全な病変（viability = 0・電位 0、伝導遮断）、その外側 BORDER_MM は部分的な傷害
 * （viability と電位が距離に比例して戻る）。Phase 5 で RF・クライオ・PFA の病変モデルに置き換える。
 * 半径 3 mm・境界 1 mm は仮定値（教育用近似）。
 */
export const SIMPLE_LESION_RADIUS_MM = 3;
const BORDER_MM = 1;

export function ablateAt(engine: SimulationEngine, point: Vec3, radiusMm = SIMPLE_LESION_RADIUS_MM): Lesion {
  const center = engine.query.closestPoint(point).vertex;
  const lesion: Lesion = {
    id: `L${engine.lesions.length + 1}`, energy: 'rf', centerVertex: center, radiusMm, transmurality: 1,
    createdAt: engine.time, tags: {},
  };
  const p = engine.mesh.positions, t = engine.ca.tissue;
  const cx = p[3 * center], cy = p[3 * center + 1], cz = p[3 * center + 2];
  for (let v = 0; v < t.viability.length; v++) {
    const d = Math.hypot(p[3 * v] - cx, p[3 * v + 1] - cy, p[3 * v + 2] - cz);
    if (d > radiusMm + BORDER_MM) continue;
    const keep = d <= radiusMm ? 0 : (d - radiusMm) / BORDER_MM;
    t.viability[v] = Math.min(t.viability[v], keep);
    t.voltage[v] = Math.min(t.voltage[v], t.voltage[v] * keep);
  }
  engine.lesions.push(lesion);
  return lesion;
}

/** 点 a から b まで、間隔 spacingMm で表面に沿って病変を並べる（線状焼灼。テスト・デモ用） */
export function ablateLine(engine: SimulationEngine, a: Vec3, b: Vec3, spacingMm = 2.5, radiusMm = SIMPLE_LESION_RADIUS_MM): Lesion[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / spacingMm));
  const out: Lesion[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(ablateAt(engine, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, radiusMm));
  }
  return out;
}

