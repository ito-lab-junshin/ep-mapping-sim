import type { CatheterKind, Electrode, Vec3 } from '../types';
import type { BiatrialModel } from '../geometry/parametric/atria';
import { MeshQuery, tangent } from '../geometry/MeshQuery';
import { add, cross, dist, dot, norm, scale, sub, v3 } from '../geometry/parametric/sdf';
import { PV_OSTIUM, PV_SLEEVE, REGIONS } from '../geometry/regions';
import { ABLATION_SHAFT_TILT_DEG, CIRCULAR, CONTACT_THRESHOLD_MM, GRID, MULTISPLINE } from '../params';
import { pointAt, type GuidedPath } from './guidedPaths';

/**
 * カテーテル配置（docs/DESIGN.md §10）。
 *  - path：CS・His・HRA は経路に沿って動かす（s = 経路上の位置 mm）
 *  - free：ABL・環状・多極は表面上の任意の点に置く（raycast で得た点）
 * heightMm は「押し込み」の逆（大きいほど壁から離れる）。接触判定は実際の電極−表面距離で行う。
 */
export type Placement =
  | { kind: 'path'; s: number; heightMm: number }
  | { kind: 'free'; point: Vec3; heightMm: number; rotationDeg: number; diameterMm?: number };

/** 電極位置から接触を判定して Electrode を作る */
export function electrodeAt(q: MeshQuery, id: string, position: Vec3): Electrode {
  const hit = q.closestPoint(position);
  return { id, position, heightMm: hit.distance, contactVertex: hit.distance <= CONTACT_THRESHOLD_MM ? hit.vertex : -1 };
}

/**
 * 表面上の点 p から内側（−法線）へ h mm。
 * p が開口（弁輪・静脈）の上にある（最近点が開口の縁）ときは、壁に沿わず p の位置に浮かせる
 * （縁に吸い寄せると複数の電極が重なり、双極電位が 0 になってしまうため）。
 */
function inward(q: MeshQuery, p: Vec3, h: number, normal?: Vec3): Vec3 {
  const hit = q.closestPoint(p);
  if (normal && hit.distance > 1 && q.atOpening(hit)) return sub(p, scale(normal, h));
  return sub(hit.point, scale(hit.normal, h));
}

/**
 * 経路上の配置。gaps[i] は電極 i と i+1 の中心間距離。
 * awayFromPath を与えると（His）、遠位電極だけ経路上に置き、近位電極は表面をその向きへ歩いて置く。
 */
export function placeOnPath(q: MeshQuery, path: GuidedPath, gaps: readonly number[], p: { s: number; heightMm: number }, awayFromPath?: Vec3): Electrode[] {
  const out: Electrode[] = [];
  if (awayFromPath) {
    const distal = q.closestPoint(pointAt(path, p.s));
    out.push(electrodeAt(q, '1', sub(distal.point, scale(distal.normal, p.heightMm))));
    let acc = 0;
    gaps.forEach((g, i) => {
      acc += g;
      const hit = q.walk(distal.point, awayFromPath, acc);
      out.push(electrodeAt(q, String(i + 2), sub(hit.point, scale(hit.normal, p.heightMm))));
    });
    return out;
  }
  let s = p.s;
  for (let i = 0; i <= gaps.length; i++) {
    const pt = pointAt(path, s);
    out.push(electrodeAt(q, String(i + 1), path.onSurface ? inward(q, pt, p.heightMm) : pt));
    if (i < gaps.length) s += path.proximalDirection * gaps[i];
  }
  return out;
}

/** 接平面の基底（rotationDeg だけ法線まわりに回す） */
function tangentFrame(n: Vec3, rotationDeg: number): [Vec3, Vec3] {
  const t0 = tangent(v3(0, 1, 0.01), n);
  const b0 = cross(n, t0);
  const a = (rotationDeg * Math.PI) / 180;
  const t = add(scale(t0, Math.cos(a)), scale(b0, Math.sin(a)));
  return [t, cross(n, t)];
}

/** 自由配置（ABL・環状・多極） */
export function placeFree(
  q: MeshQuery, model: BiatrialModel, kind: CatheterKind,
  p: { point: Vec3; heightMm: number; rotationDeg: number; diameterMm?: number },
  ablationOffsetsMm: readonly number[],
): Electrode[] {
  const hit = q.closestPoint(p.point);
  const n = hit.normal;
  const [t, b] = tangentFrame(n, p.rotationDeg);

  if (kind === 'ablation_tip') {
    const tilt = (ABLATION_SHAFT_TILT_DEG * Math.PI) / 180;
    const shaft = add(scale(n, -Math.cos(tilt)), scale(t, Math.sin(tilt)));
    const tip = sub(hit.point, scale(n, p.heightMm));
    return ablationOffsetsMm.map((o, i) => electrodeAt(q, String(i + 1), add(tip, scale(shaft, o - ablationOffsetsMm[0]))));
  }

  if (kind === 'circular_mapping') {
    const diameter = p.diameterMm ?? CIRCULAR.defaultDiameterMm;
    const region = REGIONS[model.mesh.regionOfVertex[hit.vertex]];
    const pv = model.anatomy.la.pvs.find((v) => region === PV_SLEEVE[v.name] || region === PV_OSTIUM[v.name]);
    const out: Electrode[] = [];
    if (pv) {
      // PV 内：PV の軸を中心とする輪。輪が PV より小さければ壁から浮く（非接触）
      const axial = Math.max(-2, Math.min(model.dimensions.pv.sleeveLength - 3, dot(sub(hit.point, pv.ostium), pv.frame.axis)));
      const center = add(pv.ostium, scale(pv.frame.axis, axial));
      for (let i = 0; i < CIRCULAR.electrodes; i++) {
        const a = (2 * Math.PI * i) / CIRCULAR.electrodes + (p.rotationDeg * Math.PI) / 180;
        const dir = norm(add(scale(pv.frame.u, Math.cos(a)), scale(pv.frame.v, Math.sin(a))));
        const wall = q.closestPoint(add(center, scale(add(scale(pv.frame.u, Math.cos(a) * pv.frame.ru), scale(pv.frame.v, Math.sin(a) * pv.frame.rv)), 1)));
        const wallR = dist(wall.point, center);
        const r = Math.max(0, Math.min(diameter / 2, wallR - p.heightMm));
        out.push(electrodeAt(q, String(i + 1), add(center, scale(dir, r))));
      }
      return out;
    }
    // 心房本体：壁に沿って平らに置く
    for (let i = 0; i < CIRCULAR.electrodes; i++) {
      const a = (2 * Math.PI * i) / CIRCULAR.electrodes;
      const target = add(hit.point, add(scale(t, Math.cos(a) * diameter / 2), scale(b, Math.sin(a) * diameter / 2)));
      out.push(electrodeAt(q, String(i + 1), inward(q, target, p.heightMm, n)));
    }
    return out;
  }

  if (kind === 'multispline') {
    const out: Electrode[] = [];
    for (let sp = 0; sp < MULTISPLINE.splines; sp++) {
      const a = (2 * Math.PI * sp) / MULTISPLINE.splines;
      const dir = add(scale(t, Math.cos(a)), scale(b, Math.sin(a)));
      MULTISPLINE.offsetsMm.forEach((o, k) => {
        const w = q.walk(hit.point, dir, o);
        // 開口の縁で止まったら、残りは縁から直進して開口の上に浮かせる（非接触）
        const rest = o - w.traveled;
        const onWall = sub(w.point, scale(w.normal, p.heightMm));
        const pos = rest > 0.5 ? add(onWall, scale(w.direction, rest)) : onWall;
        out.push(electrodeAt(q, `${String.fromCharCode(65 + sp)}${k + 1}`, pos));
      });
    }
    return out;
  }

  if (kind === 'grid') {
    const out: Electrode[] = [];
    for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) {
      const target = add(hit.point, add(scale(t, (c - (GRID.cols - 1) / 2) * GRID.spacingMm), scale(b, (r - (GRID.rows - 1) / 2) * GRID.spacingMm)));
      out.push(electrodeAt(q, `${String.fromCharCode(65 + r)}${c + 1}`, inward(q, target, p.heightMm, n)));
    }
    return out;
  }

  throw new Error(`free placement not supported for ${kind}`);
}
