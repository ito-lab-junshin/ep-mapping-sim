import type { ArrhythmiaScenario } from '../types';
import { SimulationEngine } from '../sim/SimulationEngine';
import { REGION_ID } from '../geometry/regions';
import { AFL_SUBSTRATE, CONDUCTION } from '../params';
import { separated } from './common';

export interface AflParams {
  /** RA（CTI 以外）の ERP */
  raErpMs: number;
  /** CTI の伝導速度（§4.2：0.3〜0.5 mm/ms）と ERP（§4.2：230 ms） */
  ctiCv: number;
  ctiErpMs: number;
  /** 分界稜の横方向の伝導速度（機能的ブロック線） */
  cristaTransverseCv: number;
  /** RA（CTI・稜・大静脈以外）の伝導速度 */
  raCv: number;
}

/** RA の頂点 */
function raVertices(engine: SimulationEngine): number[] {
  const ra = engine.mesh.parts![1];
  return Array.from({ length: ra.vertexCount }, (_, i) => ra.vertexStart + i);
}

export function applyAflSubstrate(engine: SimulationEngine, p: AflParams = AFL_SUBSTRATE) {
  const t = engine.ca.tissue;
  const reg = engine.mesh.regionOfVertex;
  const P = engine.mesh.positions;
  const lines = engine.model.anatomy.lines;
  for (const v of raVertices(engine)) {
    if (reg[v] === REGION_ID.cti) { t.conductionVelocity[v] = p.ctiCv; t.erp[v] = p.ctiErpMs; continue; }
    t.erp[v] = p.raErpMs;
    t.conductionVelocity[v] = p.raCv;
    // 大静脈（SVC・IVC の管）は心筋がなく興奮しない（伝導速度 0）。ブロック線（分界稜・Eustachian 稜）の端になる。
    // 「遅い伝導」にすると、管の壁を回る小さな旋回ができてしまう
    if (reg[v] === REGION_ID.svc || reg[v] === REGION_ID.ivc) { t.conductionVelocity[v] = 0; t.cvLongitudinal[v] = 0; continue; }
    // 分界稜・Eustachian 稜：線に沿った向きは一般心房筋の速さ、横方向は遅い（機能的ブロック線）
    const line = reg[v] === REGION_ID.crista_terminalis ? lines.crista : reg[v] === REGION_ID.eustachian_ridge ? lines.eustachian : null;
    if (!line) continue;
    const q = { x: P[3 * v], y: P[3 * v + 1], z: P[3 * v + 2] };
    const dir = nearestSegmentDirection(q, line);
    const n = engine.query.normalAt(v);
    const d = dir.x * n.x + dir.y * n.y + dir.z * n.z;
    let fx = dir.x - d * n.x, fy = dir.y - d * n.y, fz = dir.z - d * n.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    t.fiber[3 * v] = fx; t.fiber[3 * v + 1] = fy; t.fiber[3 * v + 2] = fz;
    t.cvLongitudinal[v] = CONDUCTION.atrialCv;
    t.conductionVelocity[v] = p.cristaTransverseCv;
  }
}

/** 点 q に最も近い線分の向き（単位ベクトル） */
function nearestSegmentDirection(q: { x: number; y: number; z: number }, line: { x: number; y: number; z: number }[]) {
  let best = 0, bd = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const l2 = ab.x ** 2 + ab.y ** 2 + ab.z ** 2 || 1;
    const u = Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y + (q.z - a.z) * ab.z) / l2));
    const d = Math.hypot(q.x - a.x - ab.x * u, q.y - a.y - ab.y * u, q.z - a.z - ab.z * u);
    if (d < bd) { bd = d; best = i; }
  }
  const a = line[best - 1], b = line[best];
  const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, z: (b.z - a.z) / l };
}

/**
 * 通常型心房粗動（CTI 依存性。docs/DESIGN.md §5.2）
 *  - 解剖：拡大した RA（aflRemodeled）
 *  - 基質：CTI の伝導を遅くし（ERP 230 ms は RA より長い）、分界稜（SVC → IVC）と Eustachian 稜（IVC → CS 口）を
 *    機能的ブロック線にする（線に沿った向きだけ伝導）。大静脈は興奮しない。RA の伝導速度・ERP は
 *    目標値（周期長 220〜260 ms・興奮間隙 ≧ 20 ms）から調整した仮定値（AFL_SUBSTRATE）
 *  - 誘発：CS 口からのバースト。CTI は ERP が長いので中隔側 → 側壁側の向きに通れず（一方向性ブロック）、
 *    興奮は中隔を上行し、側壁を下行して CTI に側壁側から入る → 反時計回りの旋回
 *  - 根治：三尖弁輪から IVC までの連続した病変線（CTI を横切る）と、CS 口・低位外側 RA からの刺激が
 *    線を越えない（両方向性ブロック）
 */
export const aflCtiScenario: ArrhythmiaScenario = {
  id: 'afl_cti',
  label: '通常型心房粗動（CTI）',
  chambers: ['RA'],
  anatomy: 'aflRemodeled',
  induction: { kind: 'burst', site: 'CS_OS' },
  setupSubstrate(engine) {
    applyAflSubstrate(engine);
    // ハロー 20 極を三尖弁輪の側壁に置く（CS と合わせて旋回方向を読む）
    engine.setPlacement('halo', { kind: 'path', s: engine.paths.halo.defaultS, heightMm: 1 });
  },
  structuralChecks(engine) {
    const viab = engine.ca.tissue.viability;
    // CTI の線：三尖弁輪側と IVC 側が、CTI の中で病変によって中隔側と側壁側に分かれているか
    const cti = new Set<number>();
    engine.mesh.regionOfVertex.forEach((r, v) => { if (r === REGION_ID.cti) cti.add(v); });
    const line = ctiLineComplete(engine, cti, viab);
    return [
      { id: 'cti-line', label: 'CTI に三尖弁輪から IVC までの連続した病変線がある', ok: line },
      { id: 'bidirectional', label: '両方向性ブロック（CS 口・低位外側 RA からの刺激が線を越えない）', ok: bidirectionalBlock(engine) },
    ];
  },
  energies: ['rf'],
  goals: [
    'CS 近位→遠位の活性化順序とハロー電極で旋回方向を確認する',
    'CTI に三尖弁輪から下大静脈まで連続線を引く',
    'CS 口ペーシングで両方向性ブロックを確認する',
  ],
};

/** CTI の中隔側の端と側壁側の端が、生きている頂点で CTI の帯の中でつながっていなければ線が完成 */
function ctiLineComplete(engine: SimulationEngine, cti: Set<number>, viab: Float32Array): boolean {
  const a = engine.model.anatomy;
  const P = engine.mesh.positions;
  // CTI の帯を、IVC 縁と三尖弁輪を結ぶ軸に直交する向き（中隔 ↔ 側壁）で端の頂点に分ける
  const ivc = a.anchors.ctiIvc.point, tv = a.anchors.ctiTv.point;
  const ax = { x: tv.x - ivc.x, y: tv.y - ivc.y, z: tv.z - ivc.z };
  const lat = { x: -1, y: 0, z: 0 }; // 側壁は −x
  const d = ax.x * lat.x + ax.y * lat.y + ax.z * lat.z, l2 = ax.x ** 2 + ax.y ** 2 + ax.z ** 2;
  const side = { x: lat.x - ax.x * d / l2, y: lat.y - ax.y * d / l2, z: lat.z - ax.z * d / l2 };
  const s = (v: number) => (P[3 * v] - ivc.x) * side.x + (P[3 * v + 1] - ivc.y) * side.y + (P[3 * v + 2] - ivc.z) * side.z;
  const vals = [...cti].map(s).sort((x, y) => x - y);
  const lo = vals[Math.floor(vals.length * 0.15)], hi = vals[Math.floor(vals.length * 0.85)];
  const septal = [...cti].filter((v) => s(v) <= lo), lateral = new Set([...cti].filter((v) => s(v) >= hi));
  // CTI の帯の中だけをたどる
  const masked = new Float32Array(viab.length);
  for (const v of cti) masked[v] = viab[v];
  return separated(engine.mesh, masked, septal, lateral);
}

/**
 * 両方向性ブロック：CS 口と低位外側 RA からそれぞれ刺激し、反対側に届く時刻が、病変のない同じ基質より
 * BLOCK_DELAY_MS 以上遅れる（CTI を直接通れず、三尖弁輪を回ってくる）こと。複製したエンジンで確かめる
 */
function bidirectionalBlock(engine: SimulationEngine): boolean {
  const arrival = (from: 'CS_OS' | 'LOW_LATERAL_RA', to: 'CS_OS' | 'LOW_LATERAL_RA', withLesions: boolean) => {
    const c = new SimulationEngine(engine.model);
    aflCtiScenario.setupSubstrate(c);
    if (withLesions) c.ca.tissue.viability.set(engine.ca.tissue.viability);
    c.sinusEnabled = false;
    const src = c.siteTarget(from), dst = c.siteTarget(to);
    if (src.kind !== 'atrium' || dst.kind !== 'atrium') return -1;
    c.ca.stimulate(src.vertex);
    c.tick(400);
    return c.ca.tissue.lastActivation[dst.vertex];
  };
  const blocked = (from: 'CS_OS' | 'LOW_LATERAL_RA', to: 'CS_OS' | 'LOW_LATERAL_RA') => {
    const t = arrival(from, to, true), ref = arrival(from, to, false);
    return t < 0 || t - ref >= BLOCK_DELAY_MS;
  };
  return blocked('CS_OS', 'LOW_LATERAL_RA') && blocked('LOW_LATERAL_RA', 'CS_OS');
}

/** 両方向性ブロックとみなす到達の遅れ ms。仮定値 */
const BLOCK_DELAY_MS = 30;

/**
 * 三尖弁輪の縁の興奮の位相（周期長 cl に対する ms）を、CS 口の側から His の方向（中隔を上行する向き）へ
 * 45° ごとに平均して返す。反時計回りの通常型 AFL では、角度とともに位相が増え続ける。
 */
export function tricuspidRingPhases(engine: SimulationEngine, cl: number): number[] {
  const a = engine.model.anatomy, P = engine.mesh.positions, tv = a.ra.tricuspid, ax = tv.axis;
  const proj = (p: { x: number; y: number; z: number }) => {
    const d = p.x * ax.x + p.y * ax.y + p.z * ax.z;
    return { x: p.x - d * ax.x, y: p.y - d * ax.y, z: p.z - d * ax.z };
  };
  const unit = (p: { x: number; y: number; z: number }) => { const l = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / l, y: p.y / l, z: p.z / l }; };
  const u = unit(proj({ x: a.anchors.csOs.point.x - tv.center.x, y: a.anchors.csOs.point.y - tv.center.y, z: a.anchors.csOs.point.z - tv.center.z }));
  let w = { x: ax.y * u.z - ax.z * u.y, y: ax.z * u.x - ax.x * u.z, z: ax.x * u.y - ax.y * u.x };
  const angle = (q: { x: number; y: number; z: number }) => {
    const r = { x: q.x - tv.center.x, y: q.y - tv.center.y, z: q.z - tv.center.z };
    return ((Math.atan2(r.x * w.x + r.y * w.y + r.z * w.z, r.x * u.x + r.y * u.y + r.z * u.z) * 180) / Math.PI + 360) % 360;
  };
  // His の方向が正の角度になるよう向きをそろえる
  if (angle(a.anchors.his.point) > 180) w = { x: -w.x, y: -w.y, z: -w.z };
  const t0 = engine.ca.tissue.lastActivation[a.anchors.csOs.vertex];
  const bins: number[][] = Array.from({ length: 8 }, () => []);
  for (const v of a.rims.tricuspid) {
    const q = { x: P[3 * v], y: P[3 * v + 1], z: P[3 * v + 2] };
    bins[Math.floor(angle(q) / 45) % 8].push((((engine.ca.tissue.lastActivation[v] - t0) % cl) + cl) % cl);
  }
  return bins.map((b) => (b.length ? b.reduce((s, x) => s + x, 0) / b.length : Number.NaN));
}
