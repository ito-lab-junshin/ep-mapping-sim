import type { Vec3 } from '../core/types';
import type { SimulationEngine } from '../core/sim/SimulationEngine';
import type { PvName } from '../core/geometry/regions';
import { PV_NAMES } from '../core/geometry/regions';
import { SYSTEMS } from '../systems';
import { useSim } from './store';
import { acquireNow, getAcquisition, getEngine, getGoalTracker, getPoints, placeCatheter, updateGoals, updateProtocol } from './engine';
import { ctiLinePoints, pvRingPoints } from '../core/research/strategies';
import { svcRingPoints } from '../core/arrhythmia/svc';
import { channelCutPoints } from '../core/arrhythmia/persistent';

/**
 * E2E テスト用の口（docs/DESIGN.md §13）。URL に ?e2e=1 を付けたときだけ window.__ep に出す。
 * 3D 上のマウス操作（カテーテルを面に当てる・なぞる）と、実時間で数分かかる刺激プロトコルは自動化しにくいので、
 *  - カテーテルを解剖の目印・頂点・座標に置く
 *  - シミュレーションを早送りする（刺激プロトコル・ゴール・調律の表示も一緒に進める）
 *  - 標準の通電（PVI の一周・CTI の線など）を高速で行う
 *  - エンジンの状態を読む
 * ことだけを提供する。画面のボタン・選択・表示はテストから本物の操作で確かめる。利用者の操作には影響しない。
 */
const engine = (): SimulationEngine => getEngine(useSim.getState().arrhythmia);

const bump = () => {
  const s = useSim.getState();
  s.bumpPlacement();
  s.bumpMap();
  s.bumpGoals();
};

/** 置き場所の指定：座標・頂点・解剖の目印（anchors の名前）・PV の中（口から奥へ mm） */
type Where = Vec3 | { vertex: number } | { anchor: string } | { pv: PvName; depthMm?: number };

function pointOf(e: SimulationEngine, w: Where): Vec3 {
  if ('vertex' in w) return e.query.position(w.vertex);
  if ('anchor' in w) return (e.model.anatomy.anchors as Record<string, { point: Vec3 }>)[w.anchor].point;
  if ('pv' in w) {
    const pv = e.model.anatomy.la.pvs.find((p) => p.name === w.pv)!, f = pv.frame, d = w.depthMm ?? 6;
    return { x: pv.ostium.x + f.axis.x * d, y: pv.ostium.y + f.axis.y * d, z: pv.ostium.z + f.axis.z * d };
  }
  return w;
}

const api = {
  engine,
  store: useSim,

  /** カテーテルを置く（自由配置。環状は diameterMm も） */
  place(id: string, where: Where, opts: { heightMm?: number; diameterMm?: number; rotationDeg?: number } = {}) {
    const e = engine();
    placeCatheter(e, id, {
      kind: 'free', point: pointOf(e, where), heightMm: opts.heightMm ?? 1, rotationDeg: opts.rotationDeg ?? 0,
      ...(opts.diameterMm !== undefined ? { diameterMm: opts.diameterMm } : {}),
    });
  },

  /** シミュレーションを ms 早送りする（刺激プロトコル・ゴール・調律の表示を 50 ms ごとに進める） */
  advance(ms: number) {
    const e = engine();
    const s = useSim.getState();
    for (let t = 0; t < ms; t += 50) {
      e.tick(Math.min(50, ms - t));
      updateProtocol();
      if (t % 250 === 0) updateGoals(e, s.arrhythmia);
    }
    updateGoals(e, s.arrhythmia);
    const st = e.rhythm.state;
    s.setRhythm(st, st === 'tachycardia' || st === 'pacing' ? e.rhythm.currentCycleLength(e.time) : null);
    bump();
  },

  /** ABL を各点に当てて RF 通電する（通電の時計を大きな倍速にして一気に進める） */
  ablateRf(points: Vec3[], powerW = 30, durationS = 30) {
    const e = engine();
    const ctl = e.ablation;
    const speed = ctl.speed;
    for (const p of points) {
      e.setPlacement('abl', { kind: 'free', point: p, heightMm: 1, rotationDeg: 0 });
      ctl.rf = { powerW, durationS };
      if (ctl.start('rf')) continue;
      ctl.speed = 250;
      while (ctl.active) ctl.step(e.sampleMs);
    }
    ctl.speed = speed;
    useSim.getState().setCureChecks(null);
    bump();
  },

  /** 標準の通電の点（研究用の標準の通電と同じ） */
  points: {
    pvRing: (pv: PvName, spacingMm = 5) => pvRingPoints(engine(), pv, spacingMm),
    allPvRings: (spacingMm = 5) => PV_NAMES.flatMap((pv) => pvRingPoints(engine(), pv, spacingMm)),
    ctiLine: (spacingMm = 4) => ctiLinePoints(engine(), spacingMm),
    svcRing: () => svcRingPoints(engine()),
    channelCut: () => channelCutPoints(engine()),
    anchor: (name: string) => pointOf(engine(), { anchor: name }),
    apMid: () => {
      const e = engine(), ap = e.conduction.ap!.vertices;
      const a = e.query.position(ap[0]), b = e.query.position(ap[ap.length - 1]);
      return e.query.closestPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }).point;
    },
    apVertices: () => [...(engine().conduction.ap?.vertices ?? [])],
    /** 僧帽弁輪の縁の頂点のうち、側方（+x）から順に n 点（間隔 every 頂点。WPW の最早期部位のマッピング用） */
    mitralLateral: (n = 6, every = 3) => {
      const e = engine(), p = e.mesh.positions;
      const rim = [...e.model.anatomy.rims.mitral].sort((a, b) => p[3 * b] - p[3 * a]);
      return Array.from({ length: n }, (_, i) => rim[Math.min(rim.length - 1, i * every)]);
    },
    /** LA の壁（PV・弁輪・左心耳を除く）に散らばる n 点の頂点 */
    laWall: (n = 8) => {
      const e = engine(), la = e.mesh.parts![0];
      const ok = new Set(['la_body', 'la_posterior', 'la_anterior', 'la_roof', 'la_septum'].map((r) => e.mesh.regionNames.indexOf(r)));
      const vs: number[] = [];
      for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) if (ok.has(e.mesh.regionOfVertex[v])) vs.push(v);
      return Array.from({ length: n }, (_, i) => vs[Math.floor(((i + 0.5) * vs.length) / n)]);
    },
  },

  /** 収集モード：ABL で LA の壁を間隔 every 頂点ごとになぞる（形の収集） */
  sweepLa(every = 25) { api.sweepPart(0, every); },
  /** 収集モード：ABL で RA の壁をなぞる */
  sweepRa(every = 25) { api.sweepPart(1, every); },
  /** 収集モード：心房 part（0 = LA、1 = RA）の壁を間隔 every 頂点ごとになぞる */
  sweepPart(part: number, every = 25) {
    const e = engine();
    const la = e.mesh.parts![part];
    const acq = getAcquisition(e);
    for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v += every) {
      e.setPlacement('abl', { kind: 'free', point: e.query.position(v), heightMm: 1, rotationDeg: 0 });
      acq.collect([e.catheter('abl')!]);
    }
    useSim.getState().bumpGeometry();
    bump();
  },

  /** 置いたマッピングカテーテルで点を取る（画面の「点を取得」と同じ） */
  acquire(): number {
    const s = useSim.getState();
    return acquireNow(engine(), SYSTEMS[s.system]);
  },

  /** 取得点（位置・LAT・電位・最寄りの副伝導路の頂点までの距離） */
  mapPoints() {
    const e = engine();
    const ap = e.conduction.ap?.vertices ?? [];
    return getPoints(e).points.map((p) => ({
      latMs: p.latMs, voltageMv: p.voltageMv, vertex: p.vertex,
      apDistanceMm: ap.length ? Math.min(...ap.map((v) => { const q = e.query.position(v); return Math.hypot(q.x - p.position.x, q.y - p.position.y, q.z - p.position.z); })) : null,
    }));
  },

  /** 状態の要約 */
  state() {
    const e = engine();
    const s = useSim.getState();
    const tracker = getGoalTracker(e, s.arrhythmia);
    return {
      arrhythmia: s.arrhythmia, time: e.time, rhythm: e.rhythm.state, cycleLengthMs: e.rhythm.currentCycleLength(e.time),
      lesions: e.lesions.length, points: getPoints(e).points.length, procedureMin: e.ablation.field.procedureMin,
      edemaVertices: e.ablation.field.edemaVertexCount, tutorialStep: s.tutorialStep,
      achievedGoals: [...tracker.achievedAt.keys()],
      laCoveragePct: getAcquisition(e).coveragePct(e.mesh.parts![0].vertexStart, e.mesh.parts![0].vertexCount),
      raCoveragePct: getAcquisition(e).coveragePct(e.mesh.parts![1].vertexStart, e.mesh.parts![1].vertexCount),
      apSite: e.conduction.ap?.site ?? null, afType: e.caseOptions.afType ?? null,
    };
  },
};

export type EpTestApi = typeof api;

/** ?e2e=1 のときだけ window.__ep を付ける */
export function installE2eHooks() {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(window.location.search).get('e2e') !== '1') return;
  (window as unknown as { __ep: EpTestApi }).__ep = api;
}
