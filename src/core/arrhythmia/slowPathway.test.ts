import { describe, it, expect } from 'vitest';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SimulationEngine } from '../sim/SimulationEngine';
import { avnrtScenario, hasAhJump, slowPathwayAblatedFraction, slowPathwayRegion } from './avnrt';
import { tryInduce } from './common';
import { AV_NODE } from '../params';
import { REGION_ID } from '../geometry/regions';
import { pathwayStatus } from '../conduction/AvNode';

/** 遅伝導路の領域（離断・修飾、QA の回答で決定。docs/DESIGN.md §5.3） */
const FAST = { s1Beats: 4, s2StartMs: 360, observeMs: 1200 };
const R = AV_NODE.slowRegion;
const make = () => { const e = new SimulationEngine(loadParametricSync('normal')); avnrtScenario.setupSubstrate(e); return e; };
/** 領域の頂点のうち、目印から遠い順（縁から）に割合 f だけ焼く（貫壁） */
const burnFraction = (e: SimulationEngine, f: number) => {
  const c = e.model.anatomy.anchors.slowPathway.point;
  const reg = slowPathwayRegion(e).map((v) => ({ v, d: Math.hypot(e.query.position(v).x - c.x, e.query.position(v).y - c.y, e.query.position(v).z - c.z) }))
    .sort((a, b) => b.d - a.d);
  for (const { v } of reg.slice(0, Math.round(f * reg.length))) e.ablation.field.raise(v, 1);
};

describe('遅伝導路の領域', () => {
  it('領域は目印から半径 3.5 mm の頂点で、表示の「遅伝導路部位」も同じ半径', () => {
    const e = make();
    const reg = slowPathwayRegion(e);
    expect(reg.length).toBeGreaterThan(5);
    const labelled: number[] = [];
    e.mesh.regionOfVertex.forEach((r, v) => { if (r === REGION_ID.slow_pathway) labelled.push(v); });
    // 表示の領域は、領域から（優先順位の高い His・房室結節のラベルに取られた頂点を除き）はみ出さない
    const set = new Set(reg);
    expect(labelled.every((v) => set.has(v))).toBe(true);
    expect(labelled.length / reg.length).toBeGreaterThan(0.6);
  });

  it(`${Math.round(R.blockFraction * 100)} % 以上焼けると離断：遅伝導路の伝導が消え、AH jump も頻拍も出ない`, () => {
    const e = make();
    burnFraction(e, 0.7);
    e.tick(10);
    expect(pathwayStatus(e.conduction.pathways[1])).toBe('blocked');
    expect(slowPathwayAblatedFraction(e)).toBeGreaterThanOrEqual(R.blockFraction);
    const r = tryInduce(e, avnrtScenario, FAST);
    expect(r.induced).toBe(false);
    expect(hasAhJump(r.session!.results)).toBe(false);
    expect(avnrtScenario.structuralChecks(e)[0].ok).toBe(true);
  }, 120_000);

  it(`${Math.round(R.modifyFraction * 100)}〜${Math.round(R.blockFraction * 100)} % では修飾：jump は残るがエコーが出ず非誘発`, () => {
    const e = make();
    burnFraction(e, 0.4);
    e.tick(10);
    expect(pathwayStatus(e.conduction.pathways[1])).toBe('modified');
    const r = tryInduce(e, avnrtScenario, FAST);
    expect(r.induced).toBe(false);
    expect(hasAhJump(r.session!.results)).toBe(true);
    expect(r.session!.results.some((x) => x.echo)).toBe(false);
    expect(avnrtScenario.structuralChecks(e)[0].ok).toBe(true);
    expect(avnrtScenario.structuralChecks(e)[0].label).toContain('修飾');
  }, 120_000);

  it(`${Math.round(R.modifyFraction * 100)} % 未満では変わらない（誘発される）。入口の頂点が焼けても、領域の残りが入口になる`, () => {
    const e = make();
    e.ablation.field.raise(e.model.anatomy.anchors.slowPathway.vertex, 1); // 目印の 1 頂点だけ
    e.tick(10);
    expect(slowPathwayAblatedFraction(e)).toBeLessThan(R.modifyFraction);
    expect(pathwayStatus(e.conduction.pathways[1])).toBe('intact');
    expect(tryInduce(e, avnrtScenario, FAST).induced).toBe(true);
    expect(avnrtScenario.structuralChecks(e)[0].ok).toBe(false);
  }, 120_000);

  it('接合部調律は、ABL の先端が領域内（半径 3.5 mm 以内）の RF 通電で出て、領域の外では出ない', () => {
    const run = (offsetMm: number) => {
      const e = make();
      const a = e.model.anatomy.anchors, c = a.slowPathway.point, csOs = a.csOs.point;
      const d = Math.hypot(csOs.x - c.x, csOs.y - c.y, csOs.z - c.z);
      const p = e.query.closestPoint({ x: c.x + ((csOs.x - c.x) / d) * offsetMm, y: c.y + ((csOs.y - c.y) / d) * offsetMm, z: c.z + ((csOs.z - c.z) / d) * offsetMm }).point;
      e.setPlacement('abl', { kind: 'free', point: p, heightMm: 1, rotationDeg: 0 });
      e.ablation.rf = { powerW: 30, durationS: 30 };
      e.ablation.speed = 5;
      e.ablation.start('rf');
      e.tick(3000);
      return !!e.ablation.active?.last.junctional;
    };
    expect(run(0)).toBe(true);
    expect(run(R.radiusMm + 2.5)).toBe(false);
  });
});
