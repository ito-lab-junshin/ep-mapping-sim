import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { aflCtiScenario, ctiGapHint, ctiLineDone } from './aflCti';
import { REGION_ID } from '../geometry/regions';
import type { Vec3 } from '../types';

/** 隙間のヒント（教育用の補助）：CTI の線 */
const make = () => { const e = new SimulationEngine(loadParametricSync('aflRemodeled')); aflCtiScenario.setupSubstrate(e); return e; };
const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** 三尖弁輪 → IVC の口へ、CTI の弦に沿って約 4 mm ごとに RF（40 W・45 秒）。skip の区間（mm）は焼かない */
function line(e: SimulationEngine, skip?: [number, number]) {
  const a = e.model.anatomy.anchors, p = a.ctiTv.point, q = a.ctiIvc.point;
  const len = d(p, q), n = Math.ceil(len / 4);
  const cti: number[] = [];
  e.mesh.regionOfVertex.forEach((r, v) => { if (r === REGION_ID.cti || r === REGION_ID.ivc) cti.push(v); });
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (skip && t * len >= skip[0] && t * len <= skip[1]) continue;
    pts.push(e.query.closestPoint({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t }, cti).point);
  }
  for (const pt of pts) {
    e.setPlacement('abl', { kind: 'free', point: pt, heightMm: 1, rotationDeg: 0 });
    e.ablation.rf = { powerW: 40, durationS: 45 };
    expect(e.ablation.start('rf')).toBeNull();
    e.ablation.speed = 250;
    while (e.ablation.active) e.ablation.step(e.sampleMs);
  }
  return { tv: p, ivc: q, len };
}

describe('隙間のヒント：CTI の線', () => {
  it('焼く前は未完成・まだ焼いていない（覆っている割合 0、印なし）。AFL の症例は gapHints をもつ', () => {
    const e = make();
    const g = ctiGapHint(e);
    expect(g.complete).toBe(false);
    expect(g.coverage).toBe(0);
    expect(g.showGaps).toBe(false);
    expect(aflCtiScenario.gapHints!(e)).toHaveLength(1);
  });

  it('三尖弁輪から IVC の口までの線は完成（ctiLineDone と一致）', () => {
    const e = make();
    line(e);
    expect(ctiLineDone(e)).toBe(true);
    expect(ctiGapHint(e).complete).toBe(true);
  }, 120_000);

  it('線の中ほどに隙間を残すと、その近くに印が出る。IVC の口の手前で止めると、IVC 側の端に印が出る', () => {
    const mid = make();
    const m = line(mid, [10, 15]);
    const g = ctiGapHint(mid);
    expect(ctiLineDone(mid)).toBe(false);
    expect(g.complete).toBe(false);
    expect(g.coverage).toBeGreaterThanOrEqual(0.5);
    expect(g.showGaps).toBe(true);
    const at = (t: number) => ({ x: m.tv.x + (m.ivc.x - m.tv.x) * t, y: m.tv.y + (m.ivc.y - m.tv.y) * t, z: m.tv.z + (m.ivc.z - m.tv.z) * t });
    expect(Math.min(...g.clusters.map((c) => d(c.center, at(12.5 / m.len))))).toBeLessThan(6);

    const short = make();
    const s = line(short, [s0(short), 99]);
    const h = ctiGapHint(short);
    expect(h.complete).toBe(false);
    expect(h.showGaps).toBe(true);
    // 印は IVC の口の近く（三尖弁輪より IVC に近い）
    const c = h.clusters[0].center;
    expect(d(c, s.ivc)).toBeLessThan(d(c, s.tv));
  }, 240_000);
});

/** IVC の口から 8 mm 手前の位置（三尖弁輪から mm） */
function s0(e: SimulationEngine) {
  const a = e.model.anatomy.anchors;
  return d(a.ctiTv.point, a.ctiIvc.point) - 8;
}
