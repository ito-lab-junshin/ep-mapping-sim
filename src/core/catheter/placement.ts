import type { Electrode, SurfaceMesh, Vec3 } from '../types';
import { centroid, nearestVertex, raycastFromInside } from '../geometry/meshUtils';
import { CONTACT_THRESHOLD_MM } from '../params';

/**
 * Phase 1 のカテーテル配置（スライダー操作用）。
 * Phase 2 でマウスの raycast による配置に置き換える。
 */

/** 弁輪・CS のように壁に沿って寝かせる配置 */
export interface ArcPlacement {
  kind: 'arc';
  /** 電極 1（遠位）の方位角 deg */
  distalAzimuthDeg: number;
  elevationDeg: number;
  /** 遠位→近位へ進む方位角の符号 */
  proximalSign: 1 | -1;
  heightMm: number;
}

/** アブレーションカテーテルのように先端を壁に当てる配置 */
export interface TipPlacement {
  kind: 'tip';
  azimuthDeg: number;
  elevationDeg: number;
  heightMm: number;
  /** シャフトの傾き（0 = 壁に垂直） */
  tiltDeg: number;
}

export type Placement = ArcPlacement | TipPlacement;

const rad = (d: number) => (d * Math.PI) / 180;

function direction(azDeg: number, elDeg: number): Vec3 {
  const az = rad(azDeg), el = rad(elDeg);
  return { x: Math.cos(el) * Math.cos(az), y: Math.sin(el), z: Math.cos(el) * Math.sin(az) };
}

function surfaceAt(mesh: SurfaceMesh, c: Vec3, azDeg: number, elDeg: number) {
  const hit = raycastFromInside(mesh, c, direction(azDeg, elDeg));
  if (!hit) throw new Error('placement ray missed the mesh');
  return hit;
}

function makeElectrode(mesh: SurfaceMesh, id: string, surface: Vec3, pos: Vec3, heightMm: number): Electrode {
  const contact = heightMm <= CONTACT_THRESHOLD_MM ? nearestVertex(mesh, surface).vertex : -1;
  return { id, position: pos, contactVertex: contact, heightMm };
}

/**
 * 壁に沿って電極を並べる。gapsMm[i] は電極 i と i+1 の中心間距離。
 * 電極は心内膜面から heightMm だけ心腔内側に置く。
 */
export function placeArc(mesh: SurfaceMesh, p: ArcPlacement, gapsMm: readonly number[]): Electrode[] {
  const c = centroid(mesh);
  const out: Electrode[] = [];
  let az = p.distalAzimuthDeg;
  for (let i = 0; i <= gapsMm.length; i++) {
    const hit = surfaceAt(mesh, c, az, p.elevationDeg);
    const pos = {
      x: hit.point.x - hit.normal.x * p.heightMm,
      y: hit.point.y - hit.normal.y * p.heightMm,
      z: hit.point.z - hit.normal.z * p.heightMm,
    };
    out.push(makeElectrode(mesh, String(i + 1), hit.point, pos, p.heightMm));
    if (i < gapsMm.length) {
      const ringR = Math.max(1, Math.hypot(hit.point.x - c.x, hit.point.z - c.z));
      az += p.proximalSign * (gapsMm[i] / ringR) * (180 / Math.PI);
    }
  }
  return out;
}

/**
 * 先端を壁に当てたカテーテル。offsetsMm は先端電極から各電極中心までのシャフト上の距離。
 * シャフトは壁の法線から tiltDeg 傾け、方位角が増える向きに倒す。
 */
export function placeTip(mesh: SurfaceMesh, p: TipPlacement, offsetsMm: readonly number[]): Electrode[] {
  const c = centroid(mesh);
  const hit = surfaceAt(mesh, c, p.azimuthDeg, p.elevationDeg);
  const n = hit.normal;
  // 接線: 方位角の増える向き（水平）を法線に直交化
  const az = rad(p.azimuthDeg);
  let tx = -Math.sin(az), ty = 0, tz = Math.cos(az);
  const dn = tx * n.x + ty * n.y + tz * n.z;
  tx -= dn * n.x; ty -= dn * n.y; tz -= dn * n.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const tilt = rad(p.tiltDeg);
  // 先端から心腔内へ向かうシャフト方向
  const sx = -n.x * Math.cos(tilt) + tx * Math.sin(tilt);
  const sy = -n.y * Math.cos(tilt) + ty * Math.sin(tilt);
  const sz = -n.z * Math.cos(tilt) + tz * Math.sin(tilt);
  const tip = { x: hit.point.x - n.x * p.heightMm, y: hit.point.y - n.y * p.heightMm, z: hit.point.z - n.z * p.heightMm };
  return offsetsMm.map((o, i) => {
    const d = o - offsetsMm[0];
    const pos = { x: tip.x + sx * d, y: tip.y + sy * d, z: tip.z + sz * d };
    const h = i === 0 ? p.heightMm : p.heightMm + d * Math.cos(tilt);
    return makeElectrode(mesh, String(i + 1), hit.point, pos, h);
  });
}

export function placeElectrodes(mesh: SurfaceMesh, p: Placement, layoutMm: readonly number[]): Electrode[] {
  return p.kind === 'arc' ? placeArc(mesh, p, layoutMm) : placeTip(mesh, p, layoutMm);
}
