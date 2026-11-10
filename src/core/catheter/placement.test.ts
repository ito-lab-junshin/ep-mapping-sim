import { describe, it, expect } from 'vitest';
import { makeEllipsoidChamber } from '../geometry/presetChambers';
import { placeArc, placeTip } from './placement';
import { ablationOffsetsMm } from './catalog';

const mesh = makeEllipsoidChamber('LA', { x: 22, y: 20, z: 24 }, 48);
const dist = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('カテーテル配置（Phase 1 のスライダー用）', () => {
  it('弧配置：電極間隔がほぼ指定どおり、接触なら接触頂点をもつ', () => {
    const gaps = [2, 8, 2];
    const es = placeArc(mesh, { kind: 'arc', distalAzimuthDeg: 300, elevationDeg: -35, proximalSign: -1, heightMm: 1 }, gaps);
    expect(es.length).toBe(4);
    gaps.forEach((g, i) => expect(dist(es[i].position, es[i + 1].position)).toBeCloseTo(g, 0));
    for (const e of es) expect(e.contactVertex).toBeGreaterThanOrEqual(0);
  });

  it('弧配置：高さ 5 mm は非接触（contactVertex = -1）で心腔の内側', () => {
    const es = placeArc(mesh, { kind: 'arc', distalAzimuthDeg: 0, elevationDeg: 0, proximalSign: 1, heightMm: 5 }, [5]);
    expect(es[0].contactVertex).toBe(-1);
    expect(es[0].position.x).toBeGreaterThan(15);
    expect(es[0].position.x).toBeLessThan(18);
  });

  it('先端配置：先端だけ接触し、近位電極は壁から離れる', () => {
    const offs = ablationOffsetsMm();
    const es = placeTip(mesh, { kind: 'tip', azimuthDeg: 0, elevationDeg: 0, heightMm: 1, tiltDeg: 45 }, offs);
    expect(es[0].contactVertex).toBeGreaterThanOrEqual(0);
    expect(es[1].contactVertex).toBe(-1);
    expect(es[3].heightMm).toBeGreaterThan(es[1].heightMm);
    expect(dist(es[0].position, es[1].position)).toBeCloseTo(offs[1], 5);
  });
});
