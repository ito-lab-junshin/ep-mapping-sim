import type { SurfaceMesh } from '../types';
import type { PvInfo } from '../geometry/parametric/atria';
import { PV_OSTIUM, PV_SLEEVE, REGION_ID } from '../geometry/regions';

/** PV 口を基準にした頂点の位置：軸方向（PV 側が正）、軸からの距離、軸まわりの角度（deg、frame.u が 0°） */
export interface PvCoord { axial: number; radial: number; angleDeg: number }

export function pvCoord(mesh: SurfaceMesh, pv: PvInfo, v: number): PvCoord {
  const p = mesh.positions;
  const d = { x: p[3 * v] - pv.ostium.x, y: p[3 * v + 1] - pv.ostium.y, z: p[3 * v + 2] - pv.ostium.z };
  const f = pv.frame;
  const axial = d.x * f.axis.x + d.y * f.axis.y + d.z * f.axis.z;
  const u = d.x * f.u.x + d.y * f.u.y + d.z * f.u.z;
  const w = d.x * f.v.x + d.y * f.v.y + d.z * f.v.z;
  return { axial, radial: Math.hypot(u, w), angleDeg: ((Math.atan2(w, u) * 180) / Math.PI + 360) % 360 };
}

/**
 * LA の頂点のうち、PV 口のまわりの帯（軸方向 axialMin〜axialMax、軸からの距離 radialMin〜radialMax）にあるもの。
 * includeOwnOstium のとき、その PV の口の領域（と軸方向 axialMax までのスリーブ）も含める：
 * 右 PV のように隣の PV と前庭部を共有する（分岐部が近い）とき、帯だけでは分岐部の側に橋が残るため。
 */
export function pvBand(
  mesh: SurfaceMesh, pv: PvInfo, axialMin: number, axialMax: number, radialMin: number, radialMax: number, includeOwnOstium = false,
): { v: number; c: PvCoord }[] {
  const la = mesh.parts![0];
  const ostium = REGION_ID[PV_OSTIUM[pv.name]], sleeve = REGION_ID[PV_SLEEVE[pv.name]];
  const out: { v: number; c: PvCoord }[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    const c = pvCoord(mesh, pv, v);
    if (c.axial < axialMin || c.axial > axialMax) continue;
    const r = mesh.regionOfVertex[v];
    const own = includeOwnOstium && c.radial >= radialMin && (r === ostium || r === sleeve);
    if (own || (c.radial >= radialMin && c.radial <= radialMax)) out.push({ v, c });
  }
  return out;
}

/** 角度 a と b の差（0〜180°） */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
