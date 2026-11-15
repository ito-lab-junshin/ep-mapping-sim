import type { ArrhythmiaScenario, Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { REGIONS } from '../geometry/regions';
import { AF_SUBSTRATE } from '../params';
import { seededRandom } from '../pacing/Stimulator';
import { cloneWithSubstrate, separated } from './common';

/**
 * 持続性 AF の基質（AF-3、docs/DESIGN.md §5.1）：LA 天蓋の低電位領域に固定した旋回（局所の駆動源）と、周りの細動様伝導。
 *
 *  - 中心の瘢痕（伝導しない核、半径 coreRadiusMm）の周りに、遅い伝導の輪（channel、外半径 channelOuterMm）
 *  - その外側を線維化の輪（幅 insulationWidthMm）が囲み、出口（幅 exitGapMm）が 1 か所だけ開いている
 *  - channel を回る旋回（周期 約 195 ms、規則的）が出口から LA に出る。周りの心房は ERP のばらつきが大きく（150〜240 ms）、
 *    1:1 で追従できない所があるので、心房全体の興奮は不規則になる（細動様伝導）
 *
 * 線維化の輪がないと、旋回から出た興奮が速い正常心房筋を回って channel に反対側から入り、旋回を打ち消してしまう（試算の結果）。
 * 場所は天蓋：このモデルの後壁は PV の間が狭く（PV の口・スリーブから最大 6.8 mm）領域が入らないため（試算の結果、先生と決定）。
 * 値はすべて仮定値（教育用近似）で、§4.2 の表に記録する。
 *
 * 旋回は症例を作るときに 1 回だけ始める（位相の初期化。症例は AF が続いた状態で始まる）。
 * 複製したエンジン（根治の確認）でも同じように始めるので、病変で旋回が成り立たなければ再現しない。
 */

export interface RoofSubstrate {
  center: Vec3;
  core: number[];
  channel: number[];
  insulation: number[];
}

/** 天蓋の中心を選ぶときに避ける構造（PV の口・スリーブ、左心耳、僧帽弁輪、Bachmann 束） */
const AVOID = (r: string) => r.endsWith('_ostium') || r.endsWith('_sleeve') || r === 'laa' || r === 'mitral_annulus' || r === 'bachmann_bundle';

const cache = new WeakMap<object, RoofSubstrate>();

/** 天蓋の中心：領域 la_roof の頂点のうち、避ける構造から最も遠い点（afRemodeled で 16.5 mm 離れる） */
export function roofCenter(engine: SimulationEngine): Vec3 {
  const la = engine.mesh.parts![0];
  const avoid: Vec3[] = [];
  const roof: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    const r = REGIONS[engine.mesh.regionOfVertex[v]];
    if (AVOID(r)) avoid.push(engine.query.position(v));
    else if (r === 'la_roof') roof.push(v);
  }
  let best = roof[0], bestD = -Infinity;
  for (const v of roof) {
    const p = engine.query.position(v);
    let m = Infinity;
    for (const q of avoid) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2; if (d < m) m = d; }
    if (m > bestD) { bestD = m; best = v; }
  }
  return engine.query.position(best);
}

/** 天蓋の中心から避ける構造までの距離 mm（テスト用） */
export function roofClearanceMm(engine: SimulationEngine): number {
  const c = roofSubstrate(engine).center;
  const la = engine.mesh.parts![0];
  let m = Infinity;
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    if (!AVOID(REGIONS[engine.mesh.regionOfVertex[v]])) continue;
    const p = engine.query.position(v);
    m = Math.min(m, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
  }
  return m;
}

/**
 * 中心の接平面の座標軸：法線 n（LA の中心から外向き）、u = +x（左）を接平面に射影した向き、w = n × u。
 * 角度 0 が u（左）、π が −u（右）
 */
function tangentFrame(engine: SimulationEngine, c: Vec3) {
  const o = engine.model.anatomy.la.center;
  let n = { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
  const nl = Math.hypot(n.x, n.y, n.z); n = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
  const ref = Math.abs(n.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const k = ref.x * n.x + ref.y * n.y + ref.z * n.z;
  let u = { x: ref.x - k * n.x, y: ref.y - k * n.y, z: ref.z - k * n.z };
  const ul = Math.hypot(u.x, u.y, u.z); u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const w = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
  return { u, w };
}

/** 中心からの距離と、中心の接平面の中の角度 */
function polar(p: Vec3, c: Vec3, f: { u: Vec3; w: Vec3 }) {
  const q = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
  return { r: Math.hypot(q.x, q.y, q.z), th: Math.atan2(q.x * f.w.x + q.y * f.w.y + q.z * f.w.z, q.x * f.u.x + q.y * f.u.y + q.z * f.u.z) };
}

/** 頂点の分け方（中心の瘢痕・channel・線維化の輪）。メッシュごとに 1 回だけ求める */
export function roofSubstrate(engine: SimulationEngine): RoofSubstrate {
  const hit = cache.get(engine.mesh);
  if (hit) return hit;
  const P = AF_SUBSTRATE.persistent;
  const c = roofCenter(engine);
  const f = tangentFrame(engine, c);
  const la = engine.mesh.parts![0];
  const out: RoofSubstrate = { center: c, core: [], channel: [], insulation: [] };
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    const { r, th } = polar(engine.query.position(v), c, f);
    if (r <= P.coreRadiusMm) out.core.push(v);
    else if (r <= P.channelOuterMm) out.channel.push(v);
    else if (r <= P.channelOuterMm + P.insulationWidthMm) {
      // 出口：θ = exitAngle の向きの幅 exitGapMm（弧の長さ）だけ開ける
      let d = Math.abs(th - P.exitAngleRad) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d * r >= P.exitGapMm / 2) out.insulation.push(v);
    }
  }
  cache.set(engine.mesh, out);
  return out;
}

/** 基質を組織に書き込む（瘢痕は伝導せず電位もほぼ 0、channel は遅い伝導・低電位） */
export function applyPersistentSubstrate(engine: SimulationEngine): RoofSubstrate {
  const P = AF_SUBSTRATE.persistent;
  const s = roofSubstrate(engine);
  const t = engine.ca.tissue;
  const rng = seededRandom(20261115);
  for (const v of [...s.core, ...s.insulation]) { t.viability[v] = 0; t.voltage[v] = P.scarVoltage; }
  for (const v of s.channel) {
    t.conductionVelocity[v] = P.channelCv;
    t.cvLongitudinal[v] = 0;
    t.erp[v] = P.channelErpMs;
    t.voltage[v] = P.channelVoltage[0] + rng() * (P.channelVoltage[1] - P.channelVoltage[0]);
  }
  return s;
}

/**
 * 旋回を始める（位相の初期化）：channel の頂点に、角度に比例した「前回の興奮からの時間」を与え、
 * 出口の向き（角度の基準）付近の帯を興奮させる。波は不応期の側へは進めず、回復した側へ回る。
 * 時刻 0 では使えない（活性化時刻 < 0 は「未興奮」の意味）ので、少し進めてから呼ぶ。
 * 初期化の時間差は 61 ms 以上にする（伝播の三角形更新が同じ波とみなさないように）
 */
export function seedRoofRotor(engine: SimulationEngine, s: RoofSubstrate) {
  const P = AF_SUBSTRATE.persistent;
  const t = engine.ca.tissue, now = engine.ca.time;
  const T = P.seedCycleMs;
  const f = tangentFrame(engine, s.center);
  const front: number[] = [];
  for (const v of s.channel) {
    if (t.viability[v] <= 0) continue;
    let th = polar(engine.query.position(v), s.center, f).th - P.exitAngleRad;
    th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (th < 0.25) { front.push(v); continue; }
    const elapsed = 61 + (T - 61) * (th / (2 * Math.PI));
    t.lastActivation[v] = now - elapsed;
    t.timer[v] = elapsed;
    t.phase[v] = elapsed < 0.8 * t.erp[v] ? 1 : elapsed < t.erp[v] ? 2 : 0;
  }
  for (const v of front) engine.ca.excite(v, now);
}

/** 天蓋の低電位領域（channel）が、LA の残りから病変で隔てられている（領域の隔離） */
export function roofAreaIsolated(engine: SimulationEngine): boolean {
  const s = roofSubstrate(engine);
  const P = AF_SUBSTRATE.persistent;
  const f = tangentFrame(engine, s.center);
  const la = engine.mesh.parts![0];
  const outside: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    if (polar(engine.query.position(v), s.center, f).r > P.channelOuterMm + P.insulationWidthMm + P.isolationMarginMm) outside.push(v);
  }
  return separated(engine.mesh, engine.ca.tissue.viability, outside, new Set(s.channel));
}

/** 病変ごとの「旋回が続くか」の記憶（学習ゴールの判定で毎回走らせないため） */
const driverMemo = new WeakMap<SimulationEngine, { lesions: number; viabilitySum: number; active: boolean }>();

/**
 * 天蓋の旋回が続くか：同じ病変の複製で旋回を始め直し（PV トリガー・洞調律は止める）、channel が興奮し続けるかを見る。
 * channel を横切る病変（旋回の道を断つ）があれば続かない。病変が変わらなければ前の結果を使う
 */
export function roofDriverActive(engine: SimulationEngine, scenario: ArrhythmiaScenario): boolean {
  const s = roofSubstrate(engine);
  const viab = engine.ca.tissue.viability;
  let sum = 0;
  for (const v of s.channel) sum += viab[v];
  const m = driverMemo.get(engine);
  if (m && m.lesions === engine.lesions.length && Math.abs(m.viabilitySum - sum) < 1e-6) return m.active;
  const c = cloneWithSubstrate(engine, scenario);
  c.foci = [];
  c.sinusEnabled = false;
  const t0 = c.time;
  c.tick(1500);
  // channel の生きている頂点のうち、最後の 600 ms に興奮した頂点の割合
  const la = c.ca.tissue.lastActivation;
  const alive = s.channel.filter((v) => c.ca.tissue.viability[v] > 0);
  const recent = alive.filter((v) => la[v] > t0 + 900).length;
  const active = alive.length > 0 && recent / alive.length > 0.5;
  driverMemo.set(engine, { lesions: engine.lesions.length, viabilitySum: sum, active });
  return active;
}

/**
 * channel を横切る線（出口の反対側、角度 0 の向きに、中心の瘢痕の縁から線維化の輪まで）：
 * 研究用・テスト用の標準の通電（旋回の道を断つ）
 */
export function channelCutPoints(engine: SimulationEngine, spacingMm = 2.5): Vec3[] {
  const P = AF_SUBSTRATE.persistent;
  const s = roofSubstrate(engine);
  const f = tangentFrame(engine, s.center);
  const out: Vec3[] = [];
  for (let r = P.coreRadiusMm - 1; r <= P.channelOuterMm + 1; r += spacingMm) {
    out.push(engine.query.closestPoint({ x: s.center.x + r * f.u.x, y: s.center.y + r * f.u.y, z: s.center.z + r * f.u.z }).point);
  }
  return out;
}

/** 天蓋の低電位領域の中心からの距離 mm（学習ゴール：ボルテージマップの点がこの領域にあるか） */
export function distanceFromRoofCenter(engine: SimulationEngine, p: Vec3): number {
  const c = roofSubstrate(engine).center;
  return Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
}
