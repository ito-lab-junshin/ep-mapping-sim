import type { ChamberId, InterAtrialBridge, MeshPart, SurfaceMesh, Vec3 } from '../../types';
import type { BiatrialAnatomy, BiatrialModel, PvInfo } from '../parametric/atria';
import { ORIENT, nearestVertex, vertexTowards } from '../parametric/atria';
import { DIMENSION_SETS, LAYOUT } from '../parametric/dimensions';
import { add, cross, dist, dot, norm, scale, sub, v3 } from '../parametric/sdf';
import type { Opening, RawMesh } from '../parametric/meshOps';
import { buildNeighbors } from '../buildNeighbors';
import { PV_NAMES, PV_SLEEVE, REGIONS, REGION_ID, type RegionName } from '../regions';
import { CONDUCTION } from '../../params';
import { boundaryLoops, fitRing, pca } from './meshTopology';
import type { AnchorName, LabelFile } from './labels';

/**
 * 領域ラベルの付いた両心房メッシュから、解剖の目印・開口・PV の情報・心房間の連結を求め、BiatrialModel を作る
 * （glTF ローダ用。パラメトリック形状では生成の途中で直接決めている値を、メッシュとラベルだけから求める）。
 * 座標系はアプリと同じ（+x = 患者の左、+y = 頭側、+z = 前方、mm）であることを前提にする。
 *  - 開口：境界の輪ごとに、輪の頂点の領域ラベル（多数決）で名前を決める。軸は輪の面の法線（心腔の外向き）
 *  - PV：静脈の端の輪と、スリーブ・口のラベル。口はスリーブの最も深い位置の 1 mm 先、半径は輪の最大半径
 *  - 目印：ラベルの重心に最も近い頂点（ラベル JSON の anchors があればそれを使う）
 *  - CTI の端：CTI の帯の主軸の両端（三尖弁輪側は弁輪の縁の頂点）
 *  - 分界稜・Eustachian 稜の線：ラベルの頂点を SVC → IVC（IVC → CS 口）の向きに並べて区間ごとに平均
 *  - 心房間の連結：パラメトリック形状と同じ規則（ラベル JSON の bridges があればそれを使う）
 */
export interface LabeledBiatrialMesh {
  positions: Float32Array;
  indices: Uint32Array;
  region: Uint8Array;
  /** LA が先、RA が後に並ぶ（頂点・index とも） */
  laVertexCount: number;
  laIndexCount: number;
  name?: string;
}

const P = (pos: Float32Array, v: number): Vec3 => v3(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
const centroid = (pts: Vec3[]) => scale(pts.reduce((a, p) => add(a, p), v3(0, 0, 0)), 1 / Math.max(1, pts.length));

/** 頂点の範囲の中点と半分の幅（外れ値に強いよう 2〜98 % 点） */
function boxOf(pts: Vec3[]): { center: Vec3; radii: Vec3 } {
  const q = (arr: number[], f: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
  const ax = (k: 'x' | 'y' | 'z') => { const a = pts.map((p) => p[k]); return [q(a, 0.02), q(a, 0.98)]; };
  const [x0, x1] = ax('x'), [y0, y1] = ax('y'), [z0, z1] = ax('z');
  return { center: v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), radii: v3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2) };
}

interface Loop { vertices: number[]; center: Vec3; axis: Vec3; radius: number; maxRadius: number; minRadius: number; regions: Map<RegionName, number>; chamber: ChamberId }

export function deriveModel(m: LabeledBiatrialMesh, labels?: LabelFile): BiatrialModel {
  const { positions, indices, region } = m;
  const n = positions.length / 3;
  const nLa = m.laVertexCount;
  const pt = (v: number) => P(positions, v);
  const raw: RawMesh = { positions, indices };
  const name = (v: number) => REGIONS[region[v]] as RegionName;
  const inLa = (v: number) => v < nLa;
  const all = Array.from({ length: n }, (_, i) => i);
  const laAll = all.filter(inLa), raAll = all.filter((v) => !inLa(v));
  const ofRegion = (r: RegionName) => all.filter((v) => region[v] === REGION_ID[r]);

  const LA_BODY = new Set(['la_body', 'la_septum', 'la_roof', 'la_posterior', 'la_anterior', 'bachmann_bundle', 'mitral_annulus']);
  const RA_BODY = new Set(['ra_body', 'ra_septum', 'fossa_ovalis', 'sinus_node', 'crista_terminalis', 'eustachian_ridge', 'cti', 'tricuspid_annulus', 'his_region', 'av_node', 'slow_pathway', 'cs_os']);
  const laBox = boxOf(laAll.filter((v) => LA_BODY.has(name(v))).map(pt));
  const raBox = boxOf(raAll.filter((v) => RA_BODY.has(name(v))).map(pt));

  // ── 開口（境界の輪）
  const loops: Loop[] = boundaryLoops(indices, n).map((vs) => {
    const pts = vs.map(pt);
    const { center, normal } = fitRing(pts);
    const chamber: ChamberId = inLa(vs[0]) ? 'LA' : 'RA';
    const cc = chamber === 'LA' ? laBox.center : raBox.center;
    let axis = normal;
    if (dot(axis, sub(center, cc)) < 0) axis = scale(axis, -1);
    const radial = pts.map((p) => { const d = sub(p, center); const a = dot(d, axis); return Math.hypot(d.x - axis.x * a, d.y - axis.y * a, d.z - axis.z * a); });
    const regions = new Map<RegionName, number>();
    for (const v of vs) regions.set(name(v), (regions.get(name(v)) ?? 0) + 1);
    return {
      vertices: vs, center, axis, chamber, regions,
      radius: radial.reduce((a, b) => a + b, 0) / radial.length, maxRadius: Math.max(...radial), minRadius: Math.min(...radial),
    };
  });
  const majority = (l: Loop) => [...l.regions.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const findLoop = (chamber: ChamberId, r: RegionName[], fallback: (ls: Loop[]) => Loop | undefined) => {
    const ls = loops.filter((l) => l.chamber === chamber);
    return ls.find((l) => r.includes(majority(l))) ?? fallback(ls);
  };
  const largest = (ls: Loop[]) => [...ls].sort((a, b) => b.radius - a.radius)[0];
  const opening = (l: Loop, nm: string): Opening => ({ name: nm, center: l.center, axis: l.axis, radius: l.radius });
  const need = <T>(x: T | undefined, what: string): T => { if (!x) throw new Error(`${what}が見つかりません（ラベルを確かめてください）`); return x; };

  const mitralLoop = need(findLoop('LA', ['mitral_annulus'], largest), '僧帽弁輪の開口');
  const tvLoop = need(findLoop('RA', ['tricuspid_annulus', 'cti'], largest), '三尖弁輪の開口');
  const csLoop = need(findLoop('RA', ['cs_os'], () => undefined), 'CS 口の開口');
  const svcLoop = need(findLoop('RA', ['svc'], () => undefined), 'SVC の開口');
  const ivcLoop = need(findLoop('RA', ['ivc'], () => undefined), 'IVC の開口');
  const mitral = opening(mitralLoop, 'mitral'), tricuspid = opening(tvLoop, 'tricuspid'), csOs = opening(csLoop, 'cs_os');
  const svc = opening(svcLoop, 'svc'), ivc = opening(ivcLoop, 'ivc');

  // ── PV
  const pvs: PvInfo[] = PV_NAMES.map((pvName) => {
    const sleeve = ofRegion(PV_SLEEVE[pvName]);
    const end = need(findLoop('LA', [PV_SLEEVE[pvName]], () => undefined), `${pvName} の開口`);
    const axis = end.axis;
    const depth = (v: number) => dot(sub(end.center, pt(v)), axis);
    const deepest = sleeve.length ? Math.max(...sleeve.map(depth)) : 10;
    const ostium = sub(end.center, scale(axis, deepest + 1));
    let u = sub(v3(0, 1, 0), scale(axis, axis.y));
    u = norm(u);
    const vv = cross(axis, u);
    const radius = end.maxRadius;
    const a = sub(ostium, scale(axis, 6));
    return { name: pvName, ostium, radius, frame: { a, b: end.center, axis, u, v: vv, ru: radius, rv: end.minRadius, length: dist(a, end.center) } };
  });
  const sleeveLength = pvs.reduce((s, p) => s + dist(p.ostium, p.frame.b), 0) / pvs.length;

  // ── 目印
  const given = labels?.anchors ?? {};
  const regionAnchor = (r: RegionName, fallback: () => number) => {
    const vs = ofRegion(r);
    return vs.length ? nearestVertex(raw, centroid(vs.map(pt)), vs) : fallback();
  };
  const anchorVertex = (k: AnchorName, compute: () => number) => (given[k] !== undefined ? given[k]! : compute());
  const raIdx = raAll;
  const tvRim = tvLoop.vertices, csRim = csLoop.vertices, ivcRim = ivcLoop.vertices;
  const his = anchorVertex('his', () => regionAnchor('his_region', () => vertexTowards(raw, raBox.center, v3(1, 0.55, 0.2), tvRim)));
  const slow = anchorVertex('slowPathway', () => regionAnchor('slow_pathway', () => {
    const toTv = nearestVertex(raw, csOs.center, tvRim);
    return nearestVertex(raw, scale(add(pt(toTv), pt(nearestVertex(raw, pt(toTv), csRim))), 0.5), raIdx);
  }));
  const av = anchorVertex('avNode', () => regionAnchor('av_node', () => nearestVertex(raw, add(pt(his), scale(sub(csOs.center, pt(his)), 0.35)), raIdx)));
  const sinus = anchorVertex('sinusNode', () => regionAnchor('sinus_node', () => vertexTowards(raw, raBox.center, ORIENT.sinusNode, raIdx)));
  const csAnchor = anchorVertex('csOs', () => nearestVertex(raw, csOs.center, csRim));
  // CTI の端：帯の主軸に沿って最も三尖弁輪側と IVC 側
  const cti = ofRegion('cti');
  let ctiTv: number, ctiIvc: number;
  if (given.ctiTv !== undefined && given.ctiIvc !== undefined) { ctiTv = given.ctiTv; ctiIvc = given.ctiIvc; } else {
    need(cti.length ? cti : undefined, 'CTI のラベル');
    const { center: cc, axes } = pca(cti.map(pt));
    let ax = axes[0];
    if (dot(sub(tricuspid.center, cc), ax) < 0) ax = scale(ax, -1);
    const proj = (v: number) => dot(sub(pt(v), cc), ax);
    const tvEnd = cti.reduce((a, b) => (proj(b) > proj(a) ? b : a));
    const ivcEnd = cti.reduce((a, b) => (proj(b) < proj(a) ? b : a));
    ctiTv = given.ctiTv ?? nearestVertex(raw, pt(tvEnd), tvRim);
    ctiIvc = given.ctiIvc ?? ivcEnd;
  }
  const g = (v: number) => ({ point: pt(v), vertex: v });

  // ── 分界稜・Eustachian 稜の線
  const orderedLine = (r: RegionName, from: Vec3, to: Vec3, bins: number): Vec3[] => {
    const vs = ofRegion(r);
    if (!vs.length) return [from, to];
    const dir = norm(sub(to, from));
    const t = vs.map((v) => dot(sub(pt(v), from), dir));
    const lo = Math.min(...t), hi = Math.max(...t);
    const out: Vec3[] = [];
    for (let b = 0; b < bins; b++) {
      const sel = vs.filter((_, i) => t[i] >= lo + ((hi - lo) * b) / bins && t[i] <= lo + ((hi - lo) * (b + 1)) / bins);
      if (sel.length) out.push(pt(nearestVertex(raw, centroid(sel.map(pt)), sel)));
    }
    return out.length >= 2 ? out : [from, to];
  };
  const lines = {
    crista: labels?.lines?.crista ?? orderedLine('crista_terminalis', svc.center, ivc.center, 24),
    eustachian: labels?.lines?.eustachian ?? orderedLine('eustachian_ridge', ivc.center, csOs.center, 12),
  };

  // ── 心房間の連結
  const bridges: InterAtrialBridge[] = labels?.bridges?.map((b) => ({ ...b, cvMmPerMs: CONDUCTION.bridgeCv[b.name] })) ?? (() => {
    const patch = (cands: number[], c: Vec3) => cands.filter((v) => dist(pt(v), c) <= LAYOUT.bridgeRadius);
    const make = (nm: InterAtrialBridge['name'], raAnchor: number, laAnchor: number): InterAtrialBridge => {
      const laPatch = patch(laAll, pt(laAnchor));
      return { name: nm, pairs: patch(raAll, pt(raAnchor)).map((rv) => [rv, nearestVertex(raw, pt(rv), laPatch)] as [number, number]), cvMmPerMs: CONDUCTION.bridgeCv[nm] };
    };
    const bbRa = vertexTowards(raw, raBox.center, ORIENT.bachmannRa, raAll);
    const laAntSup = laAll.filter((v) => { const q = sub(pt(v), laBox.center); return q.y > 0 && q.z > 0; });
    const fossaRa = regionAnchor('fossa_ovalis', () => vertexTowards(raw, raBox.center, ORIENT.fossa, raAll));
    let csRa = csRim[0], csD = Infinity;
    for (const v of csRim) { const d = dist(pt(v), pt(nearestVertex(raw, pt(v), laAll))); if (d < csD) { csD = d; csRa = v; } }
    return [
      make('bachmann', bbRa, nearestVertex(raw, pt(bbRa), laAntSup)),
      make('fossa_rim', fossaRa, nearestVertex(raw, pt(fossaRa), laAll)),
      make('cs_musculature', csRa, nearestVertex(raw, pt(csRa), laAll)),
    ];
  })();

  const parts: MeshPart[] = [
    { chamber: 'LA', vertexStart: 0, vertexCount: nLa, indexStart: 0, indexCount: m.laIndexCount },
    { chamber: 'RA', vertexStart: nLa, vertexCount: n - nLa, indexStart: m.laIndexCount, indexCount: indices.length - m.laIndexCount },
  ];
  const mesh: SurfaceMesh = {
    chamber: 'BIATRIAL', positions, indices, neighbors: buildNeighbors(n, indices), regionOfVertex: region,
    regionNames: [...REGIONS], parts, bridges,
  };
  const laOpenings = [mitral, ...pvs.map((p) => ({ name: p.name, center: p.frame.b, axis: p.frame.axis, radius: p.radius }))];
  const anatomy: BiatrialAnatomy = {
    la: { chamber: 'LA', center: laBox.center, radii: laBox.radii, openings: laOpenings, pvs, mitral },
    ra: { chamber: 'RA', center: raBox.center, radii: raBox.radii, openings: [tricuspid, csOs, svc, ivc], tricuspid, csOs, svc, ivc },
    anchors: {
      sinusNode: g(sinus), avNode: g(av), his: g(his), slowPathway: g(slow),
      csOs: { point: csOs.center, vertex: csAnchor }, ctiIvc: g(ctiIvc), ctiTv: g(ctiTv),
    },
    rims: { mitral: mitralLoop.vertices, tricuspid: tvRim, csOs: csRim, ivc: ivcRim },
    ctiLengthMm: dist(pt(ctiIvc), pt(ctiTv)),
    lines,
  };
  const base = DIMENSION_SETS.normal;
  const dimensions = { ...base, label: m.name ?? 'glTF モデル', pv: { ...base.pv, sleeveLength } };
  return { mesh, anatomy, dimensions };
}

