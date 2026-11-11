import type { Vec3 } from '../../types';
import { ORIENT, RIDGE_HALF_WIDTH_MM, crista, nearestVertex, segmentDistance, vertexTowards } from '../parametric/atria';
import { add, dist, dot, scale, sub, v3 } from '../parametric/sdf';
import type { RawMesh } from '../parametric/meshOps';
import { PV_NAMES, PV_OSTIUM, PV_SLEEVE, REGION_ID, type PvName, type RegionName } from '../regions';
import { boundaryLoops, fitRing, pca } from './meshTopology';
import { buildNeighbors } from '../buildNeighbors';
import type { AnchorName } from './labels';

/**
 * 領域ラベルの半自動推定（Phase 7）：ラベルのない両心房メッシュから、形だけで領域を推定する。
 * 前提：座標系はアプリと同じ（+x = 患者の左、+y = 頭側、+z = 前方、mm）。LA は僧帽弁輪と 4 本の PV の 5 つ、
 * RA は三尖弁輪・SVC・IVC・CS 口の 4 つの開口（境界の輪）をもつ。
 *  - LA：最大の輪 = 僧帽弁輪、残り 4 つ = PV（LA の中心より左 = 左 PV、上 = 上 PV）
 *  - RA：最大の輪 = 三尖弁輪、最小 = CS 口、残りの上 = SVC・下 = IVC
 *  - 管（PV・大静脈）の付け根：輪から奥へ、断面の半径が輪の 1.4 倍を超える深さ
 *  - Koch 三角・洞結節・分界稜・Eustachian 稜・CTI・卵円窩：パラメトリック形状と同じ規則（向きは ORIENT）
 * 左心耳・右心耳・Bachmann 束は推定しない（ラベル JSON で上書きする）。結果は目安で、JSON での手直しを前提とする。
 */

interface Ring { vertices: number[]; center: Vec3; axis: Vec3; radius: number }

/** 推定の結果：領域と、推定の途中で決めた解剖の目印（頂点） */
export interface Estimate { region: Uint8Array; anchors: Partial<Record<AnchorName, number>> }

export function estimateRegions(positions: Float32Array, indices: Uint32Array, laVertexCount: number): Estimate {
  const n = positions.length / 3;
  const raw: RawMesh = { positions, indices };
  const pt = (v: number): Vec3 => v3(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
  const laAll = Array.from({ length: laVertexCount }, (_, i) => i);
  const raAll = Array.from({ length: n - laVertexCount }, (_, i) => laVertexCount + i);
  const region = new Uint8Array(n);
  const centerOf = (vs: number[]) => pca(vs.map(pt)).center;

  const rings = (vs: number[]) => {
    const set = new Set(vs);
    const c0 = centerOf(vs);
    return boundaryLoops(indices, n).filter((l) => set.has(l[0])).map((l): Ring => {
      const { center, normal } = fitRing(l.map(pt));
      let axis = normal;
      if (dot(axis, sub(center, c0)) < 0) axis = scale(axis, -1);
      const r = l.map((v) => { const d = sub(pt(v), center); const a = dot(d, axis); return Math.hypot(d.x - axis.x * a, d.y - axis.y * a, d.z - axis.z * a); });
      return { vertices: l, center, axis, radius: Math.max(...r) };
    });
  };
  const radial = (ring: { center: Vec3; axis: Vec3 }, p: Vec3) => { const d = sub(p, ring.center); const a = dot(d, ring.axis); return Math.hypot(d.x - ring.axis.x * a, d.y - ring.axis.y * a, d.z - ring.axis.z * a); };
  /** 輪から奥（−軸）へ進む深さ */
  const depth = (ring: Ring, p: Vec3) => -dot(sub(p, ring.center), ring.axis);
  /**
   * 管の付け根の深さ：輪から、管の壁（軸からの距離が輪の半径の flare 倍未満。PV 1.3、大静脈 1.1）だけをメッシュの辺でたどり、
   * 届いた最も深い位置。壁が広がる（付け根）とたどれなくなる。ほかの構造をまたがないよう、つながりで判定する
   */
  const neighbors = buildNeighbors(n, indices);
  const tubeDepth = (ring: Ring, flare = 1.3) => {
    const seen = new Set<number>(ring.vertices), stack = [...ring.vertices];
    let deepest = 0;
    while (stack.length) {
      const v = stack.pop()!;
      deepest = Math.max(deepest, depth(ring, pt(v)));
      for (const u of neighbors[v]) {
        if (seen.has(u)) continue;
        const p = pt(u);
        if (radial(ring, p) < ring.radius * flare && depth(ring, p) > -1 && depth(ring, p) < 60) { seen.add(u); stack.push(u); }
      }
    }
    return deepest;
  };

  // ───── LA
  const laRings = rings(laAll).sort((a, b) => b.radius - a.radius);
  if (laRings.length !== 5) throw new Error(`LA の開口が 5 つではありません（${laRings.length} 個）。ラベル JSON で与えてください`);
  const [mitral, ...pvRings] = laRings;
  const laC0 = centerOf(laAll);
  const named = new Map<PvName, Ring>();
  for (const side of ['L', 'R'] as const) {
    const s = pvRings.filter((r) => (side === 'L' ? r.center.x > laC0.x : r.center.x <= laC0.x)).sort((a, b) => b.center.y - a.center.y);
    if (s.length !== 2) throw new Error('PV を左右 2 本ずつに分けられません。ラベル JSON で与えてください');
    named.set(`${side}SPV` as PvName, s[0]); named.set(`${side}IPV` as PvName, s[1]);
  }
  const pvInfo = PV_NAMES.map((name) => {
    const ring = named.get(name)!;
    const od = tubeDepth(ring);
    return { name, ring, ostium: sub(ring.center, scale(ring.axis, od)), radius: ring.radius };
  });
  const tube = new Set<number>();
  for (const v of laAll) {
    const p = pt(v);
    let best: (typeof pvInfo)[number] | null = null, bestA = 0, bestRel = 1.9;
    for (const pv of pvInfo) {
      const a = dot(sub(p, pv.ostium), pv.ring.axis);
      const rel = radial({ center: pv.ostium, axis: pv.ring.axis }, p) / pv.radius;
      if (a > -3 && rel < bestRel) { best = pv; bestA = a; bestRel = rel; }
    }
    if (best) { region[v] = REGION_ID[bestA > 1 ? PV_SLEEVE[best.name] : PV_OSTIUM[best.name]]; tube.add(v); }
  }
  const laBody = laAll.filter((v) => !tube.has(v));
  const box = (vs: number[]) => {
    const pts = vs.map(pt);
    const ax = (k: 'x' | 'y' | 'z') => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))];
    const [x0, x1] = ax('x'), [y0, y1] = ax('y'), [z0, z1] = ax('z');
    return { c: v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), r: v3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2) };
  };
  const lb = box(laBody);
  for (const v of laBody) {
    const p = pt(v);
    if (-dot(sub(p, mitral.center), mitral.axis) < 4 && radial(mitral, p) < mitral.radius * 1.6) { region[v] = REGION_ID.mitral_annulus; continue; }
    const q = sub(p, lb.c);
    const r: RegionName = q.x < -0.6 * lb.r.x ? 'la_septum' : q.y > 0.6 * lb.r.y ? 'la_roof' : q.z < -0.45 * lb.r.z ? 'la_posterior' : q.z > 0.45 * lb.r.z ? 'la_anterior' : 'la_body';
    region[v] = REGION_ID[r];
  }

  // ───── RA
  const raRings = rings(raAll).sort((a, b) => b.radius - a.radius);
  if (raRings.length !== 4) throw new Error(`RA の開口が 4 つではありません（${raRings.length} 個）。ラベル JSON で与えてください`);
  const tricuspid = raRings[0], csOs = raRings[3];
  const [svc, ivc] = [raRings[1], raRings[2]].sort((a, b) => b.center.y - a.center.y);
  const svcDepth = tubeDepth(svc, 1.05), ivcDepth = tubeDepth(ivc, 1.05);
  const isVein = (ring: Ring, d: number, p: Vec3) => depth(ring, p) < d - 1 && radial(ring, p) < ring.radius * 1.5;
  const raBody = raAll.filter((v) => !isVein(svc, svcDepth, pt(v)) && !isVein(ivc, ivcDepth, pt(v)));
  const c = box(raBody).c, rr = box(raBody).r;
  const tvRim = tricuspid.vertices, csRim = csOs.vertices;
  const hisV = vertexTowards(raw, c, v3(1, 0.55, 0.2), tvRim);
  const csToTv = nearestVertex(raw, csOs.center, tvRim);
  const csRimTowardTv = nearestVertex(raw, pt(csToTv), csRim);
  const slowV = nearestVertex(raw, scale(add(pt(csToTv), pt(csRimTowardTv)), 0.5), raAll);
  const avV = nearestVertex(raw, add(pt(hisV), scale(sub(csOs.center, pt(hisV)), 0.35)), raAll);
  const junction = raAll.filter((v) => Math.abs(depth(ivc, pt(v)) - ivcDepth) < 1.5 && radial(ivc, pt(v)) < ivc.radius * 1.6);
  let ctiIvc = -1, ctiTv = -1, best = Infinity;
  for (const a of junction) for (const b of tvRim) { const d = dist(pt(a), pt(b)); if (d < best) { best = d; ctiIvc = a; ctiTv = b; } }
  const sinusV = vertexTowards(raw, c, ORIENT.sinusNode, raAll);
  const fossaV = vertexTowards(raw, c, ORIENT.fossa, raAll);
  const surfaceLine = (a: Vec3, b: Vec3, k = 32) => Array.from({ length: k + 1 }, (_, i) => pt(vertexTowards(raw, c, sub(add(a, scale(sub(b, a), i / k)), c), raAll)));
  const lineDistance = (p: Vec3, line: Vec3[]) => { let d = Infinity; for (let i = 1; i < line.length; i++) d = Math.min(d, segmentDistance(p, line[i - 1], line[i])); return d; };
  const cristaDir = v3(Math.cos(crista), 0, Math.sin(crista));
  const cristaLine = surfaceLine(pt(vertexTowards(raw, c, add(cristaDir, v3(0, 1.2, 0)), svc.vertices)), pt(vertexTowards(raw, c, add(cristaDir, v3(0, -1.2, 0)), ivc.vertices)));
  const eustIvc = nearestVertex(raw, csOs.center, ivc.vertices);
  const eustachianLine = surfaceLine(pt(eustIvc), pt(nearestVertex(raw, pt(eustIvc), csRim)), 12);
  for (const v of raAll) {
    const p = pt(v);
    let r: RegionName;
    if (isVein(svc, svcDepth, p)) r = 'svc';
    else if (isVein(ivc, ivcDepth, p)) r = 'ivc';
    else if (dist(p, pt(hisV)) < 5) r = 'his_region';
    else if (dist(p, pt(avV)) < 4) r = 'av_node';
    else if (dist(p, pt(slowV)) < 5) r = 'slow_pathway';
    else if (-dot(sub(p, csOs.center), csOs.axis) < 3 && radial(csOs, p) < csOs.radius * 1.8) r = 'cs_os';
    else if (segmentDistance(p, pt(ctiIvc), pt(ctiTv)) < 7) r = 'cti';
    else if (-dot(sub(p, tricuspid.center), tricuspid.axis) < 3 && radial(tricuspid, p) < tricuspid.radius * 1.6) r = 'tricuspid_annulus';
    else if (lineDistance(p, eustachianLine) < RIDGE_HALF_WIDTH_MM) r = 'eustachian_ridge';
    else if (dist(p, pt(sinusV)) < 6) r = 'sinus_node';
    else if (lineDistance(p, cristaLine) < RIDGE_HALF_WIDTH_MM) r = 'crista_terminalis';
    else if (dist(p, pt(fossaV)) < 8) r = 'fossa_ovalis';
    else r = sub(p, c).x > 0.55 * rr.x ? 'ra_septum' : 'ra_body';
    region[v] = REGION_ID[r];
  }
  return { region, anchors: { his: hisV, slowPathway: slowV, avNode: avV, sinusNode: sinusV, ctiIvc, ctiTv, csOs: nearestVertex(raw, csOs.center, csRim) } };
}
