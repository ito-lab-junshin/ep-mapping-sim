import type { ChamberId, InterAtrialBridge, MeshPart, SurfaceMesh, Vec3 } from '../../types';
import { buildNeighbors } from '../buildNeighbors';
import { REGIONS, REGION_ID, PV_NAMES, PV_OSTIUM, PV_SLEEVE, type PvName, type RegionName } from '../regions';
import { DIMENSION_SETS, LAYOUT, MESH_GRID_MM, type AnatomyDimensions, type DimensionSetId } from './dimensions';
import { CONDUCTION } from '../../params';
import {
  add, dist, dot, ellipsoid, norm, projectToSurface, scale, smoothUnion, sub, tube, tubeFrame, v3,
  type Sdf, type TubeFrame,
} from './sdf';
import { surfaceNets } from './surfaceNets';
import {
  axialDistance, boundaryEdgeVertices, cutOpenings, largestComponent, openingAtRadius, pos, radialDistance,
  type Opening, type RawMesh,
} from './meshOps';

/**
 * パラメトリック解剖モデル（両心房）。docs/DESIGN.md §9.1。
 *
 * 座標系: +x = 患者の左、+y = 頭側、+z = 前方（単位 mm）。
 * 寸法は dimensions.ts、開口や構造物の「向き」はこのファイルの ORIENT に置く（仮定値・教育用近似）。
 */

/** 各構造の向き（心腔中心から見た方向）。仮定値（教育用近似） */
export const ORIENT = {
  laCenter: v3(24, 2, -8),
  /** RA の中心（x は RA の短径から決める：中隔側の面が LA と重ならないように） */
  raCenter: v3(-20, 0, 8),
  pv: {
    LSPV: v3(0.62, 0.5, -0.6),
    LIPV: v3(0.62, -0.32, -0.72),
    RSPV: v3(-0.5, 0.5, -0.72),
    RIPV: v3(-0.5, -0.32, -0.82),
  } as Record<PvName, Vec3>,
  laa: v3(0.72, 0.38, 0.58),
  mitral: v3(0.12, -0.8, 0.58),
  svc: v3(-0.1, 1, -0.25),
  ivc: v3(-0.1, -0.6, -0.8),
  /** 前方を向き、わずかに上へ傾ける：IVC の口から三尖弁輪までの CTI を 20 mm 以上にするため（仮定値） */
  tricuspid: v3(0.25, 0.05, 0.97),
  csOs: v3(0.78, -0.58, -0.22),
  /**
   * 洞結節：分界稜の上端（SVC と RA の接合部の後外側）。RA の興奮が後上方から前下方（右心耳・RA 前壁）へ
   * 向かい、V1 の P 波の初期が陽性になる（前寄りに置くと初期の陽性が出ない）。仮定値
   */
  sinusNode: v3(-0.6, 0.75, -0.15),
  /** 右心耳：前側方・上方。三尖弁輪の開口（前方）と SVC の両方に重ならない向き（仮定値） */
  raa: v3(-0.75, 0.55, 0.35),
  fossa: v3(0.95, 0.05, -0.3),
  /** 分界稜：RA 側壁のやや後方（xz 平面の方位角） */
  cristaAzimuthDeg: 200,
  bachmannRa: v3(0.55, 0.7, 0.45),
} as const;

/** 心房の領域を決めるための構造（すべて全体座標） */
export interface PvInfo { name: PvName; ostium: Vec3; frame: TubeFrame; /** 断面の長軸半径（上下） */ radius: number }

export interface AtriumAnatomy {
  chamber: 'LA' | 'RA';
  center: Vec3;
  radii: Vec3;
  openings: Opening[];
}

export interface BiatrialAnatomy {
  la: AtriumAnatomy & { pvs: PvInfo[]; mitral: Opening };
  ra: AtriumAnatomy & { tricuspid: Opening; csOs: Opening; svc: Opening; ivc: Opening };
  /** 解剖の目印（全体座標の表面上の点と、その頂点 index） */
  anchors: Record<'sinusNode' | 'avNode' | 'his' | 'slowPathway' | 'csOs' | 'ctiIvc' | 'ctiTv', { point: Vec3; vertex: number }>;
  /** 境界（開口の縁）の頂点 */
  rims: { mitral: number[]; tricuspid: number[]; csOs: number[]; ivc: number[] };
  /** CTI の長さ（IVC 縁 − 三尖弁輪の直線距離 mm） */
  ctiLengthMm: number;
  /** 分界稜（SVC → IVC）と Eustachian 稜（IVC → CS 口）の表面上の線。線維方向を決めるのに使う */
  lines: { crista: Vec3[]; eustachian: Vec3[] };
}

export interface BiatrialModel { mesh: SurfaceMesh; anatomy: BiatrialAnatomy; dimensions: AnatomyDimensions }

/** 中心 c から方向 dir に進んで SDF の表面に当たる点 */
function surfacePointAlong(f: Sdf, c: Vec3, dir: Vec3): Vec3 {
  const d = norm(dir);
  let lo = 0, hi = 200;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    const p = add(c, scale(d, m));
    if (f(p.x, p.y, p.z) < 0) lo = m; else hi = m;
  }
  return add(c, scale(d, (lo + hi) / 2));
}

function meshFromSdf(f: Sdf, c: Vec3, half: number): RawMesh {
  const m = surfaceNets(f, { min: [c.x - half, c.y - half, c.z - half], max: [c.x + half, c.y + half, c.z + half] }, MESH_GRID_MM);
  for (let v = 0; v < m.positions.length / 3; v++) {
    const q = projectToSurface(f, pos(m, v), 3);
    m.positions[3 * v] = q.x; m.positions[3 * v + 1] = q.y; m.positions[3 * v + 2] = q.z;
  }
  return m;
}

function veinOpening(name: string, frame: TubeFrame): Opening {
  return { name, center: frame.b, axis: frame.axis, radius: Math.max(frame.ru, frame.rv) };
}

/** 方向 dir に最も近い頂点（中心 c から見て） */
export function vertexTowards(m: RawMesh, c: Vec3, dir: Vec3, candidates?: Iterable<number>): number {
  const d = norm(dir);
  let best = -1, bestDot = -Infinity;
  const it = candidates ?? Array.from({ length: m.positions.length / 3 }, (_, i) => i);
  for (const v of it) {
    const q = norm(sub(pos(m, v), c));
    const s = dot(q, d);
    if (s > bestDot) { bestDot = s; best = v; }
  }
  return best;
}

export function nearestVertex(m: RawMesh, p: Vec3, candidates?: Iterable<number>): number {
  let best = -1, bestD = Infinity;
  const it = candidates ?? Array.from({ length: m.positions.length / 3 }, (_, i) => i);
  for (const v of it) {
    const d = dist(pos(m, v), p);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

function rimOf(m: RawMesh, o: Opening, boundary: Set<number>): number[] {
  return [...boundary].filter((v) => Math.abs(axialDistance(o, pos(m, v))) < 2.5 && radialDistance(o, pos(m, v)) < o.radius * 1.7);
}

/** 分界稜・Eustachian 稜の帯の半幅 mm。仮定値（教育用近似） */
export const RIDGE_HALF_WIDTH_MM = 3.5;
export const crista = (ORIENT.cristaAzimuthDeg * Math.PI) / 180;

/** Bachmann 束の LA 側の帯の半幅 mm。仮定値（教育用近似） */
export const BACHMANN_BAND_HALF_WIDTH_MM = 4;

export function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, scale(ab, t)));
}

// ───────────────────────── 左房 ─────────────────────────

function buildLeftAtrium(D: AnatomyDimensions) {
  const c = ORIENT.laCenter;
  const r = v3(D.la.lrDiameter / 2, D.la.siDiameter / 2, D.la.apDiameter / 2);
  const body = ellipsoid(c, r);
  const pvs: PvInfo[] = PV_NAMES.map((name) => {
    const dir = norm(ORIENT.pv[name]);
    const ostium = surfacePointAlong(body, c, dir);
    const o = D.pv[name];
    // 上下径を長軸とする楕円断面（u = 上下、v = 前後）
    const frame = tubeFrame(sub(ostium, scale(dir, 6)), add(ostium, scale(dir, D.pv.sleeveLength)), o.si / 2, o.ap / 2, v3(0, 1, 0));
    return { name, ostium, frame, radius: o.si / 2 };
  });
  const laaDir = norm(ORIENT.laa);
  const laaO = surfacePointAlong(body, c, laaDir);
  const laaR = D.laa.ostiumDiameter / 2;
  const laaFrame = tubeFrame(sub(laaO, scale(laaDir, 4)), add(laaO, scale(laaDir, D.laa.length - laaR)), laaR, laaR * 0.8, v3(0, 1, 0));
  const laaSdf = tube(laaFrame);
  const sdf = smoothUnion(3, smoothUnion(5, body, ...pvs.map((p) => tube(p.frame))), laaSdf);

  const closed = meshFromSdf(sdf, c, 55);
  const mitral = openingAtRadius(closed, 'mitral', c, norm(ORIENT.mitral), D.annulus.mitral / 2);
  const openings = [mitral, ...pvs.map((p) => veinOpening(p.name, p.frame))];
  const mesh = largestComponent(cutOpenings(closed, openings));

  const label = (p: Vec3): RegionName => {
    // PV の管：軸に最も近い（半径で正規化した距離が最小の）PV に割り当てる。
    // 右 PV のように管が近接すると、最初に見つかった PV に隣の管の壁を割り当ててしまうため
    let bestPv: PvInfo | null = null, bestA = 0, bestRel = 1.9;
    for (const pv of pvs) {
      const a = dot(sub(p, pv.ostium), pv.frame.axis);
      const rel = radialDistance({ name: '', center: pv.ostium, axis: pv.frame.axis, radius: 0 }, p) / pv.radius;
      if (a > -3 && rel < bestRel) { bestPv = pv; bestA = a; bestRel = rel; }
    }
    if (bestPv) return bestA > 1 ? PV_SLEEVE[bestPv.name] : PV_OSTIUM[bestPv.name];
    if (laaSdf(p.x, p.y, p.z) < 1.5 && dot(sub(p, laaO), laaDir) > -1) return 'laa';
    if (axialDistance(mitral, p) > -4 && radialDistance(mitral, p) < mitral.radius * 1.6) return 'mitral_annulus';
    const q = sub(p, c);
    if (q.x < -0.6 * r.x) return 'la_septum';
    if (q.y > 0.6 * r.y) return 'la_roof';
    if (q.z < -0.45 * r.z) return 'la_posterior';
    if (q.z > 0.45 * r.z) return 'la_anterior';
    return 'la_body';
  };

  return { mesh, sdf, center: c, radii: r, pvs, mitral, openings, label, laaOstium: laaO };
}

// ───────────────────────── 右房 ─────────────────────────

function buildRightAtrium(D: AnatomyDimensions) {
  // normal（短径 38 mm）で x = −20。RA が大きいと中隔側が LA に食い込むので、その分だけ右へずらす
  const c = v3(ORIENT.raCenter.x - (D.ra.minorDiameter / 2 - 19), ORIENT.raCenter.y, ORIENT.raCenter.z);
  const r = v3(D.ra.minorDiameter / 2, D.ra.majorDiameter / 2, D.ra.apDiameter / 2);
  const body = ellipsoid(c, r);
  const vein = (dir: Vec3, diameter: number) => {
    const d = norm(dir);
    const o = surfacePointAlong(body, c, d);
    return tubeFrame(sub(o, scale(d, 6)), add(o, scale(d, D.vein.length)), diameter / 2, diameter / 2, v3(1, 0, 0));
  };
  const svcF = vein(ORIENT.svc, D.vein.svc);
  const ivcF = vein(ORIENT.ivc, D.vein.ivc);
  // 右心耳：先の閉じた楕円断面の袋。付け根を大きくなめらかにつなぎ、幅広い三角形の形に近づける
  const raaDir = norm(ORIENT.raa);
  const raaO = surfacePointAlong(body, c, raaDir);
  const raaFrame = tubeFrame(sub(raaO, scale(raaDir, 6)), add(raaO, scale(raaDir, D.raa.length - D.raa.ostiumMinor / 2)),
    D.raa.ostiumMajor / 2, D.raa.ostiumMinor / 2, v3(0, 1, 0));
  const raaSdf = tube(raaFrame);
  const sdf = smoothUnion(6, smoothUnion(4, body, tube(svcF), tube(ivcF)), raaSdf);

  const closed = meshFromSdf(sdf, c, 55);
  const tricuspid = openingAtRadius(closed, 'tricuspid', c, norm(ORIENT.tricuspid), D.annulus.tricuspid / 2);
  const csOs = openingAtRadius(closed, 'cs_os', c, norm(ORIENT.csOs), D.vein.csOstium / 2);
  const svc = veinOpening('svc', svcF);
  const ivc = veinOpening('ivc', ivcF);
  const openings = [tricuspid, csOs, svc, ivc];
  const mesh = largestComponent(cutOpenings(closed, openings));

  const boundary = boundaryEdgeVertices(mesh);
  const rims = {
    tricuspid: rimOf(mesh, tricuspid, boundary),
    csOs: rimOf(mesh, csOs, boundary),
    ivc: rimOf(mesh, ivc, boundary),
    svc: rimOf(mesh, svc, boundary),
  };
  const P = (v: number) => pos(mesh, v);
  // His 束部位：三尖弁輪の中隔・上方の縁（Koch 三角の頂点）
  const hisV = vertexTowards(mesh, c, v3(1, 0.55, 0.2), rims.tricuspid);
  // 遅伝導路部位：CS 口と三尖弁輪の間（Koch 三角の後下方）
  const csToTv = nearestVertex(mesh, csOs.center, rims.tricuspid);
  const csRimTowardTv = nearestVertex(mesh, P(csToTv), rims.csOs);
  const slowV = nearestVertex(mesh, scale(add(P(csToTv), P(csRimTowardTv)), 0.5));
  // 房室結節（緻密部）：His 部位から CS 口へ 1/3 ほど戻った位置
  const avV = nearestVertex(mesh, add(P(hisV), scale(sub(csOs.center, P(hisV)), 0.35)));
  // CTI：IVC の口（IVC と RA の接合部の輪）と三尖弁輪の最短の組。
  // rims.ivc は管の先端の縁なので使わない（CTI は IVC の口から三尖弁輪まで）
  const ivcJunction: number[] = [];
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const p = P(v);
    if (Math.abs(axialDistance(ivc, p) + D.vein.length) < 1.5 && radialDistance(ivc, p) < ivc.radius * 1.6) ivcJunction.push(v);
  }
  let ctiIvc = -1, ctiTv = -1, ctiLen = Infinity;
  for (const a of ivcJunction) for (const b of rims.tricuspid) {
    const d = dist(P(a), P(b));
    if (d < ctiLen) { ctiLen = d; ctiIvc = a; ctiTv = b; }
  }
  const sinusV = vertexTowards(mesh, c, ORIENT.sinusNode);
  const fossaV = vertexTowards(mesh, c, ORIENT.fossa);

  /** a から b までの RA 表面上の線（弦を中心から放射状に表面へ射影した点列） */
  const surfaceLine = (a: Vec3, b: Vec3, n = 32): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const q = add(a, scale(sub(b, a), i / n));
      out.push(P(vertexTowards(mesh, c, sub(q, c))));
    }
    return out;
  };
  const lineDistance = (p: Vec3, line: Vec3[]) => {
    let d = Infinity;
    for (let i = 1; i < line.length; i++) d = Math.min(d, segmentDistance(p, line[i - 1], line[i]));
    return d;
  };
  // 分界稜：SVC の縁（後側方）から IVC の縁（側方）まで、RA 後側壁を縦に走る線。
  // AFL では横方向の伝導が遅い機能的ブロック線になり、SVC・IVC とつながって回路の後ろ側の境界をつくる
  const cristaDir = v3(Math.cos(crista), 0, Math.sin(crista));
  const cristaTop = vertexTowards(mesh, c, add(cristaDir, v3(0, 1.2, 0)), rims.svc);
  const cristaBottom = vertexTowards(mesh, c, add(cristaDir, v3(0, -1.2, 0)), rims.ivc);
  const cristaLine = surfaceLine(P(cristaTop), P(cristaBottom));
  // Eustachian 稜：IVC の縁から CS 口の縁まで（CTI の後ろ側の境界）
  const eustIvc = nearestVertex(mesh, csOs.center, rims.ivc);
  const eustCs = nearestVertex(mesh, P(eustIvc), rims.csOs);
  const eustachianLine = surfaceLine(P(eustIvc), P(eustCs), 12);

  const veinLabel = (o: Opening, p: Vec3, junctionBack: number) =>
    axialDistance(o, p) > -junctionBack && radialDistance(o, p) < o.radius * 1.5;
  const label = (p: Vec3): RegionName => {
    if (veinLabel(svc, p, D.vein.length - 1)) return 'svc';
    if (veinLabel(ivc, p, D.vein.length - 1)) return 'ivc';
    if (dist(p, P(hisV)) < 5) return 'his_region';
    if (dist(p, P(avV)) < 4) return 'av_node';
    if (dist(p, P(slowV)) < 5) return 'slow_pathway';
    if (axialDistance(csOs, p) > -3 && radialDistance(csOs, p) < csOs.radius * 1.8) return 'cs_os';
    // CTI は三尖弁輪の縁まで続く（弁輪の帯より優先しないと、弁輪沿いに通常の速さの抜け道が残る）
    if (segmentDistance(p, P(ctiIvc), P(ctiTv)) < 7) return 'cti';
    if (axialDistance(tricuspid, p) > -3 && radialDistance(tricuspid, p) < tricuspid.radius * 1.6) return 'tricuspid_annulus';
    if (lineDistance(p, eustachianLine) < RIDGE_HALF_WIDTH_MM) return 'eustachian_ridge';
    if (dist(p, P(sinusV)) < 6) return 'sinus_node';
    if (raaSdf(p.x, p.y, p.z) < 1.5 && dot(sub(p, raaO), raaDir) > -1) return 'raa';
    const q = sub(p, c);
    if (lineDistance(p, cristaLine) < RIDGE_HALF_WIDTH_MM) return 'crista_terminalis';
    if (dist(p, P(fossaV)) < 8) return 'fossa_ovalis';
    if (q.x > 0.55 * r.x) return 'ra_septum';
    return 'ra_body';
  };

  return {
    mesh, sdf, center: c, radii: r, openings, tricuspid, csOs, svc, ivc, rims, label,
    anchors: { hisV, avV, slowV, sinusV, ctiIvc, ctiTv }, ctiLen, cristaLine, eustachianLine,
  };
}

// ───────────────────────── 両心房 ─────────────────────────

/**
 * LA と RA を 1 つの SurfaceMesh にまとめ、心房間の 3 つの連結（Bachmann 束・卵円窩縁・CS 筋束）を
 * 隣接リストに追加する。連結の辺は三角形を持たないため、伝播だけに効き、EGM（φ モデル）の
 * ラプラシアンには入らない。
 */
export function buildBiatrialModel(set: DimensionSetId = 'normal'): BiatrialModel {
  const D = DIMENSION_SETS[set];
  const la = buildLeftAtrium(D);
  const ra = buildRightAtrium(D);
  const nLa = la.mesh.positions.length / 3;
  const nRa = ra.mesh.positions.length / 3;
  const positions = new Float32Array((nLa + nRa) * 3);
  positions.set(la.mesh.positions, 0);
  positions.set(ra.mesh.positions, nLa * 3);
  const indices = new Uint32Array(la.mesh.indices.length + ra.mesh.indices.length);
  indices.set(la.mesh.indices, 0);
  for (let i = 0; i < ra.mesh.indices.length; i++) indices[la.mesh.indices.length + i] = ra.mesh.indices[i] + nLa;

  const region = new Uint8Array(nLa + nRa);
  for (let v = 0; v < nLa; v++) region[v] = REGION_ID[la.label(pos(la.mesh, v))];
  for (let v = 0; v < nRa; v++) region[nLa + v] = REGION_ID[ra.label(pos(ra.mesh, v))];

  // 心房間の連結
  const laAll = Array.from({ length: nLa }, (_, i) => i);
  const raP = (v: number) => pos(ra.mesh, v);
  const laP = (v: number) => pos(la.mesh, v);
  const patch = (m: RawMesh, center: Vec3) => {
    const out: number[] = [];
    for (let v = 0; v < m.positions.length / 3; v++) if (dist(pos(m, v), center) <= LAYOUT.bridgeRadius) out.push(v);
    return out;
  };
  const makeBridge = (name: InterAtrialBridge['name'], raAnchor: number, laAnchor: number): InterAtrialBridge => {
    const raPatch = patch(ra.mesh, raP(raAnchor));
    const laPatch = patch(la.mesh, laP(laAnchor));
    const pairs: [number, number][] = raPatch.map((rv) => [nLa + rv, nearestVertex(la.mesh, raP(rv), laPatch)]);
    return { name, pairs, cvMmPerMs: CONDUCTION.bridgeCv[name] };
  };
  // Bachmann 束：RA 前上方の中隔寄りと、LA の前上方の半分のうち最も近い点
  const bbRa = vertexTowards(ra.mesh, ra.center, ORIENT.bachmannRa);
  const laAnteriorSuperior = laAll.filter((v) => {
    const q = sub(laP(v), la.center);
    return q.y > 0 && q.z > 0;
  });
  const bachmann = makeBridge('bachmann', bbRa, nearestVertex(la.mesh, raP(bbRa), laAnteriorSuperior));
  const fossaRa = vertexTowards(ra.mesh, ra.center, ORIENT.fossa);
  const fossa = makeBridge('fossa_rim', fossaRa, nearestVertex(la.mesh, raP(fossaRa), laAll));
  // CS 筋束：CS 口の縁のうち LA に最も近い点と、LA の最寄り点
  let csRa = ra.rims.csOs[0], csD = Infinity;
  for (const v of ra.rims.csOs) {
    const lv = nearestVertex(la.mesh, raP(v), laAll);
    const d = dist(raP(v), laP(lv));
    if (d < csD) { csD = d; csRa = v; }
  }
  const cs = makeBridge('cs_musculature', csRa, nearestVertex(la.mesh, raP(csRa), laAll));
  const bridges = [bachmann, fossa, cs];

  // Bachmann 束の LA 側：連結点から LA 前壁を左心耳の基部へ向かう帯
  const bbLa = bachmann.pairs.length ? bachmann.pairs[0][1] : -1;
  if (bbLa >= 0) {
    const a = laP(bbLa), b = la.laaOstium;
    for (let v = 0; v < nLa; v++) {
      const p = laP(v);
      const r = REGIONS[region[v]];
      if (r === 'laa' || r.includes('pv')) continue;
      if (segmentDistance(p, a, b) < BACHMANN_BAND_HALF_WIDTH_MM && dot(sub(p, la.center), v3(0, 0, 1)) > 0) region[v] = REGION_ID.bachmann_bundle;
    }
  }

  // 心房間の連結は隣接リストに入れず、bridges として別に持つ（連結ごとの伝導速度で伝える）
  const n = nLa + nRa;
  const neighbors = buildNeighbors(n, indices);

  const parts: MeshPart[] = [
    { chamber: 'LA' as ChamberId, vertexStart: 0, vertexCount: nLa, indexStart: 0, indexCount: la.mesh.indices.length },
    { chamber: 'RA' as ChamberId, vertexStart: nLa, vertexCount: nRa, indexStart: la.mesh.indices.length, indexCount: ra.mesh.indices.length },
  ];

  const mesh: SurfaceMesh = {
    chamber: 'BIATRIAL', positions, indices, neighbors, regionOfVertex: region, regionNames: [...REGIONS], parts, bridges,
  };

  const g = (v: number) => ({ point: raP(v), vertex: nLa + v });
  const laBoundary = boundaryEdgeVertices(la.mesh);
  const anatomy: BiatrialAnatomy = {
    la: { chamber: 'LA', center: la.center, radii: la.radii, openings: la.openings, pvs: la.pvs, mitral: la.mitral },
    ra: { chamber: 'RA', center: ra.center, radii: ra.radii, openings: ra.openings, tricuspid: ra.tricuspid, csOs: ra.csOs, svc: ra.svc, ivc: ra.ivc },
    anchors: {
      sinusNode: g(ra.anchors.sinusV),
      avNode: g(ra.anchors.avV),
      his: g(ra.anchors.hisV),
      slowPathway: g(ra.anchors.slowV),
      csOs: { point: ra.csOs.center, vertex: nLa + nearestVertex(ra.mesh, ra.csOs.center, ra.rims.csOs) },
      ctiIvc: g(ra.anchors.ctiIvc),
      ctiTv: g(ra.anchors.ctiTv),
    },
    rims: {
      mitral: rimOf(la.mesh, la.mitral, laBoundary),
      tricuspid: ra.rims.tricuspid.map((v) => nLa + v),
      csOs: ra.rims.csOs.map((v) => nLa + v),
      ivc: ra.rims.ivc.map((v) => nLa + v),
    },
    ctiLengthMm: ra.ctiLen,
    lines: { crista: ra.cristaLine, eustachian: ra.eustachianLine },
  };
  return { mesh, anatomy, dimensions: D };
}
