import type { Lesion, Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { applyLesion } from './LesionModel';

/**
 * 簡易通電（Phase 4）：点 point の最寄り頂点を中心に、半径 radiusMm の病変を即座に作る。
 * 中心付近（半径の約 7 割以内）は viability = 0（伝導遮断）、その外側は部分的に低下する（LesionModel.applyLesion）。
 * Phase 5 で RF・クライオ・PFA の病変モデルに置き換える。半径 3 mm は仮定値（教育用近似）。
 */
export const SIMPLE_LESION_RADIUS_MM = 3;

export function ablateAt(engine: SimulationEngine, point: Vec3, radiusMm = SIMPLE_LESION_RADIUS_MM): Lesion {
  const center = engine.query.closestPoint(point).vertex;
  const lesion: Lesion = {
    id: `L${engine.lesions.length + 1}`, energy: 'rf', centerVertex: center, radiusMm, transmurality: 1,
    createdAt: engine.time, tags: {},
  };
  applyLesion(engine.mesh, engine.ca.tissue, lesion);
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

