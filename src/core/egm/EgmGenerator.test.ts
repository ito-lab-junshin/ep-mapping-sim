import { describe, it, expect } from 'vitest';
import { makeEllipsoidChamber } from '../geometry/presetChambers';
import { CellularAutomaton } from '../propagation/CellularAutomaton';
import { EgmGenerator } from './EgmGenerator';
import { vertexTowards } from '../geometry/meshUtils';
import type { Vec3 } from '../types';

const R = 22;
function setup() {
  const mesh = makeEllipsoidChamber('LA', { x: R, y: R, z: R }, 48);
  const ca = new CellularAutomaton(mesh);
  const egm = new EgmGenerator(mesh, ca.tissue);
  return { mesh, ca, egm };
}

/** 球面上の方向 dir の点から、心腔内へ h mm 入った位置（tangentShift で接線方向にずらす） */
function inside(dir: Vec3, h: number, tangentShift: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const l = Math.hypot(dir.x, dir.y, dir.z);
  const s = (R - h) / l;
  return { x: dir.x * s + tangentShift.x, y: dir.y * s + tangentShift.y, z: dir.z * s + tangentShift.z };
}

function record(ca: CellularAutomaton, egm: EgmGenerator, pos: Vec3[], ms: number) {
  const out = pos.map(() => [] as number[]);
  for (let t = 0; t < ms; t += 2) {
    ca.step(2);
    pos.forEach((p, i) => out[i].push(egm.unipolarAt(p, ca.time)));
  }
  return out;
}

const range = (a: number[]) => ({ max: Math.max(...a), min: Math.min(...a) });

describe('EgmGenerator（φ モデル）', () => {
  const ORIGIN = { x: -1, y: 0, z: 0 };
  const MID = { x: 0, y: 0, z: -1 };
  const END = { x: 1, y: 0, z: 0 };

  it('単極電位：起源は QS 型、途中は RS 型、終点は R 型', () => {
    const { mesh, ca, egm } = setup();
    ca.stimulate(vertexTowards(mesh, ORIGIN));
    const [o, m, e] = record(ca, egm, [inside(ORIGIN, 1), inside(MID, 1), inside(END, 1)], 120).map(range);
    expect(o.max).toBeLessThan(0.15 * -o.min);          // QS：陽性成分がほぼない
    expect(m.max).toBeGreaterThan(0.3 * -m.min);        // RS：両成分あり
    expect(-m.min).toBeGreaterThan(0.3 * m.max);
    expect(-e.min).toBeLessThan(0.3 * e.max);           // R：陰性成分が小さい
  });

  it('単極電位の最大下降点（intrinsic deflection）が局所の活性化時刻と一致する', () => {
    const { mesh, ca, egm } = setup();
    ca.stimulate(vertexTowards(mesh, ORIGIN));
    const [m] = record(ca, egm, [inside(MID, 1)], 120);
    let best = 0, slope = 0;
    for (let i = 1; i < m.length; i++) if (m[i - 1] - m[i] > slope) { slope = m[i - 1] - m[i]; best = (i + 1) * 2; }
    const lat = ca.tissue.lastActivation[vertexTowards(mesh, MID)];
    expect(Math.abs(best - lat)).toBeLessThanOrEqual(8);
  });

  it('電極間隔 2 mm（辺長 ≈ 3 mm より短い）でも双極電位が 0 にならない', () => {
    const { mesh, ca, egm } = setup();
    ca.stimulate(vertexTowards(mesh, ORIGIN));
    const [a, b] = record(ca, egm, [inside(MID, 1, { x: 0, y: 1, z: 0 }), inside(MID, 1, { x: 0, y: -1, z: 0 })], 120);
    // 波面は ±x 方向に進むので、y 方向に並べた双極は小さく、x 方向は大きい（方向依存性）
    const { ca: ca2, egm: egm2, mesh: mesh2 } = setup();
    ca2.stimulate(vertexTowards(mesh2, ORIGIN));
    const [c, d] = record(ca2, egm2, [inside(MID, 1, { x: 1, y: 0, z: 0 }), inside(MID, 1, { x: -1, y: 0, z: 0 })], 120);
    const along = Math.max(...c.map((x, i) => Math.abs(x - d[i])));
    const across = Math.max(...a.map((x, i) => Math.abs(x - b[i])));
    expect(along).toBeGreaterThan(0.5);
    expect(across).toBeLessThan(along);
  });

  it('非接触（10 mm）では接触（1 mm）より大きく振幅が下がる', () => {
    const { mesh, ca, egm } = setup();
    ca.stimulate(vertexTowards(mesh, ORIGIN));
    const [near, far] = record(ca, egm, [inside(MID, 1), inside(MID, 10)], 120).map(range);
    expect(far.max - far.min).toBeLessThan(0.3 * (near.max - near.min));
    expect(far.max - far.min).toBeGreaterThan(0); // 遠隔電位は残る
  });

  it('viability = 0 の領域の上では局所の双極電位が消える（単極は遠隔成分が残る）', () => {
    const target = inside(MID, 0);
    const run = (scar: boolean) => {
      const { mesh, ca, egm } = setup();
      const p = mesh.positions;
      if (scar) for (let v = 0; v < p.length / 3; v++) {
        if (Math.hypot(p[3 * v] - target.x, p[3 * v + 1] - target.y, p[3 * v + 2] - target.z) < 8) ca.tissue.viability[v] = 0;
      }
      ca.stimulate(vertexTowards(mesh, ORIGIN));
      const [a, b, uni] = record(ca, egm, [inside(MID, 1, { x: 1, y: 0, z: 0 }), inside(MID, 1, { x: -1, y: 0, z: 0 }), inside(MID, 1)], 160);
      return { bip: Math.max(...a.map((x, i) => Math.abs(x - b[i]))), uni: range(uni) };
    };
    const scar = run(true), normal = run(false);
    expect(scar.bip).toBeLessThan(0.15 * normal.bip);
    expect(scar.uni.max - scar.uni.min).toBeGreaterThan(0); // 遠隔の単極成分は残る
  });

  it('voltage を下げると振幅も下がる（低電位領域）', () => {
    const { mesh, ca, egm } = setup();
    ca.tissue.voltage.fill(0.5);
    ca.stimulate(vertexTowards(mesh, ORIGIN));
    const [low] = record(ca, egm, [inside(MID, 1)], 120).map(range);
    const { mesh: m2, ca: c2, egm: e2 } = setup();
    c2.stimulate(vertexTowards(m2, ORIGIN));
    const [normal] = record(c2, e2, [inside(MID, 1)], 120).map(range);
    expect((low.max - low.min) / (normal.max - normal.min)).toBeCloseTo(0.2, 1);
  });
});

describe('EgmGenerator の高速化（電流源を波面付近に限る）', () => {
  it('接触した双極電位のピークは、全頂点を使う場合と 5 % 以内で一致する', () => {
    const run = (frontOnly: boolean) => {
      const mesh = makeEllipsoidChamber('LA', { x: R, y: R, z: R }, 48);
      const ca = new CellularAutomaton(mesh);
      const egm = new EgmGenerator(mesh, ca.tissue, { frontOnly });
      ca.stimulate(vertexTowards(mesh, { x: -1, y: 0, z: 0 }));
      const a = inside({ x: 0, y: 0, z: -1 }, 1, { x: 1, y: 0, z: 0 }), b = inside({ x: 0, y: 0, z: -1 }, 1, { x: -1, y: 0, z: 0 });
      let peak = 0;
      for (let t = 0; t < 120; t += 2) { ca.step(2); peak = Math.max(peak, Math.abs(egm.unipolarAt(a, ca.time) - egm.unipolarAt(b, ca.time))); }
      return peak;
    };
    const fast = run(true), full = run(false);
    expect(Math.abs(fast - full) / full).toBeLessThan(0.05);
  });
});

import { actionPotential } from './templates';

/**
 * 高速化（AF-1）の回帰：波面の近くだけを計算する update が、全頂点を走査する素直な実装と同じ値になる。
 * 参照の実装は高速化の前の手順（全頂点の膜電位 → 波面とその隣接の頂点の膜電流 → 1/r の和）をそのまま書いたもの。
 */
function referenceUnipolar(mesh: ReturnType<typeof setup>['mesh'], ca: CellularAutomaton, pos: Vec3, now: number): number {
  const t = ca.tissue, n = mesh.positions.length / 3, p = mesh.positions;
  const vm = new Float64Array(n), recent = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const la = t.lastActivation[v];
    vm[v] = la < 0 ? 0 : actionPotential(now - la, t.erp[v] * 0.8);
    recent[v] = la >= 0 && now - la < 16 ? 1 : 0;
  }
  // 余接重み（EgmGenerator と同じ）
  const w: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const idx = mesh.indices;
  const add = (a: number, b: number, c: number) => {
    const ux = p[3 * a] - p[3 * c], uy = p[3 * a + 1] - p[3 * c + 1], uz = p[3 * a + 2] - p[3 * c + 2];
    const vx = p[3 * b] - p[3 * c], vy = p[3 * b + 1] - p[3 * c + 1], vz = p[3 * b + 2] - p[3 * c + 2];
    const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const cot = cross < 1e-12 ? 0 : Math.max(-10, Math.min(10, (ux * vx + uy * vy + uz * vz) / cross));
    w[a].set(b, (w[a].get(b) ?? 0) + cot / 2); w[b].set(a, (w[b].get(a) ?? 0) + cot / 2);
  };
  for (let k = 0; k < idx.length; k += 3) { add(idx[k], idx[k + 1], idx[k + 2]); add(idx[k + 1], idx[k + 2], idx[k]); add(idx[k + 2], idx[k], idx[k + 1]); }
  let phi = 0;
  for (let v = 0; v < n; v++) {
    if (t.viability[v] <= 0) continue;
    const near = recent[v] === 1 || [...w[v].keys()].some((u) => recent[u] === 1);
    if (!near) continue;
    let s = 0;
    for (const [u, wt] of w[v]) if (t.viability[u] > 0) s += wt * (vm[u] - vm[v]);
    s *= t.voltage[v] / 2.5;
    if (Math.abs(s) <= 1e-4) continue;
    phi += s / Math.max(0.5, Math.hypot(p[3 * v] - pos.x, p[3 * v + 1] - pos.y, p[3 * v + 2] - pos.z));
  }
  return 2.0 * phi;
}

describe('EgmGenerator の高速化（AF-1）', () => {
  it('波面の近くだけの計算が、全頂点を走査する参照の実装と一致する（病変・低電位を含む）', () => {
    const { mesh, ca, egm } = setup();
    const n = mesh.positions.length / 3;
    for (let v = 0; v < n; v += 7) ca.tissue.voltage[v] = 0.5;
    for (let v = 3; v < n; v += 53) ca.tissue.viability[v] = 0;
    ca.stimulate(vertexTowards(mesh, { x: 1, y: 0, z: 0 }));
    const pos = [inside({ x: 1, y: 0, z: 0 }, 1), inside({ x: 0, y: 1, z: 0 }, 2), inside({ x: -1, y: 0.2, z: 0.3 }, 5)];
    let compared = 0;
    for (let k = 0; k < 40; k++) {
      ca.step(2);
      for (const q of pos) {
        const ref = referenceUnipolar(mesh, ca, q, ca.time);
        expect(Math.abs(egm.unipolarAt(q, ca.time) - ref)).toBeLessThan(1e-5); // Float32 の保存による差だけ
        if (Math.abs(ref) > 1e-3) compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});
