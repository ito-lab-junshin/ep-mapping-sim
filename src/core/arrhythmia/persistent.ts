import type { Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { REGION_ID } from '../geometry/regions';
import { AF_SUBSTRATE } from '../params';
import { seededRandom } from '../pacing/Stimulator';
import { separated } from './common';

/**
 * 持続性 AF の基質（AF-3、docs/DESIGN.md §5.1）：LA 後壁の低電位領域に固定した旋回（driver）。
 *
 *  - 中心の瘢痕（伝導しない核、半径 coreRadiusMm）の周りに、遅い伝導の輪（channel、外半径 channelOuterMm）
 *  - その外側を線維化の輪（幅 insulationWidthMm）が囲み、出口（幅 exitGapMm）が 1 か所だけ開いている
 *  - channel を回る旋回（周期 約 200〜250 ms）が出口から LA に出て、LA の残りは細動様に興奮する
 *
 * 線維化の輪がないと、旋回から出た興奮が速い正常心房筋を回って channel に反対側から入り、旋回を打ち消してしまう
 * （試算の結果）。値はすべて仮定値（教育用近似）で、§4.2 の表に記録する。
 *
 * 旋回は症例を作るときに 1 回だけ始める（位相の初期化。症例は AF が続いた状態で始まる）。
 * 複製したエンジン（誘発・根治の確認）でも同じように始めるので、病変で旋回が成り立たなければ再現しない。
 */

export interface PosteriorSubstrate {
  center: Vec3;
  core: number[];
  channel: number[];
  insulation: number[];
}

/** LA 後壁の中心（領域 la_posterior の重心に最も近い表面の点） */
export function posteriorCenter(engine: SimulationEngine): Vec3 {
  const P = AF_SUBSTRATE.persistent;
  if (P.useCenterHint) {
    const la = engine.mesh.parts![0];
    const [hx, hy, hz] = P.centerHint;
    return engine.query.closestPoint({ x: hx, y: hy, z: hz }, Array.from({ length: la.vertexCount }, (_, i) => la.vertexStart + i)).point;
  }
  let x = 0, y = 0, z = 0, n = 0;
  engine.mesh.regionOfVertex.forEach((r, v) => {
    if (r !== REGION_ID.la_posterior) return;
    const p = engine.query.position(v); x += p.x; y += p.y; z += p.z; n++;
  });
  return engine.query.closestPoint({ x: x / n, y: y / n, z: z / n }).point;
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
function polar(engine: SimulationEngine, c: Vec3, v: number) {
  const p = engine.query.position(v);
  const f = tangentFrame(engine, c);
  const q = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
  return { r: Math.hypot(q.x, q.y, q.z), th: Math.atan2(q.x * f.w.x + q.y * f.w.y + q.z * f.w.z, q.x * f.u.x + q.y * f.u.y + q.z * f.u.z) };
}

/** 頂点の分け方（中心の瘢痕・channel・線維化の輪） */
export function posteriorSubstrate(engine: SimulationEngine): PosteriorSubstrate {
  const P = AF_SUBSTRATE.persistent;
  const c = posteriorCenter(engine);
  const la = engine.mesh.parts![0];
  const out: PosteriorSubstrate = { center: c, core: [], channel: [], insulation: [] };
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    const { r, th } = polar(engine, c, v);
    if (r <= P.coreRadiusMm) out.core.push(v);
    else if (r <= P.channelOuterMm) out.channel.push(v);
    else if (r <= P.channelOuterMm + P.insulationWidthMm) {
      // 出口：θ = exitAngle の向きの幅 exitGapMm（弧の長さ）だけ開ける
      let d = Math.abs(th - P.exitAngleRad) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d * r >= P.exitGapMm / 2) out.insulation.push(v);
    }
  }
  return out;
}

/** 基質を組織に書き込む（瘢痕は伝導せず電位もほぼ 0、channel は遅い伝導・低電位） */
export function applyPersistentSubstrate(engine: SimulationEngine) {
  const P = AF_SUBSTRATE.persistent;
  const s = posteriorSubstrate(engine);
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
 * 角度 0 付近の帯を興奮させる。波は不応期の側（角度が正の側）へは進めず、回復した側へ回る。
 * 時刻 0 では使えない（活性化時刻 < 0 は「未興奮」の意味）ので、少し進めてから呼ぶ。
 * 初期化の時間差は 61 ms 以上にする（伝播の三角形更新が同じ波とみなさないように）
 */
export function seedPosteriorRotor(engine: SimulationEngine, s: PosteriorSubstrate) {
  const P = AF_SUBSTRATE.persistent;
  const t = engine.ca.tissue, now = engine.ca.time;
  const T = P.seedCycleMs;
  const front: number[] = [];
  for (const v of s.channel) {
    if (t.viability[v] <= 0) continue;
    let th = polar(engine, s.center, v).th - P.exitAngleRad;
    th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (th < 0.25) { front.push(v); continue; }
    const elapsed = 61 + (T - 61) * (th / (2 * Math.PI));
    t.lastActivation[v] = now - elapsed;
    t.timer[v] = elapsed;
    t.phase[v] = elapsed < 0.8 * t.erp[v] ? 1 : elapsed < t.erp[v] ? 2 : 0;
  }
  for (const v of front) engine.ca.excite(v, now);
}

/** 後壁の低電位領域（channel）が、LA の残り（後壁の外側）から病変で隔てられている（後壁隔離） */
export function posteriorIsolated(engine: SimulationEngine): boolean {
  const s = posteriorSubstrate(engine);
  const P = AF_SUBSTRATE.persistent;
  const la = engine.mesh.parts![0];
  const outside: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    if (polar(engine, s.center, v).r > P.channelOuterMm + P.insulationWidthMm + P.isolationMarginMm) outside.push(v);
  }
  return separated(engine.mesh, engine.ca.tissue.viability, outside, new Set(s.channel));
}
