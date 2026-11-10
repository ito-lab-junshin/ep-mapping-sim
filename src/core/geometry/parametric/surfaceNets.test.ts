import { describe, it, expect } from 'vitest';
import { surfaceNets } from './surfaceNets';
import { ellipsoid, v3 } from './sdf';

describe('surfaceNets', () => {
  const f = ellipsoid(v3(0, 0, 0), v3(20, 20, 20));
  const m = surfaceNets(f, { min: [-24, -24, -24], max: [24, 24, 24] }, 2);

  it('頂点はほぼ表面上にある', () => {
    for (let v = 0; v < m.positions.length / 3; v++) {
      const r = Math.hypot(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
      expect(Math.abs(r - 20)).toBeLessThan(1);
    }
  });

  it('面は外向き', () => {
    let outward = 0, total = 0;
    const p = m.positions, idx = m.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const e1 = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]];
      const e2 = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cx = p[3 * a] + p[3 * b] + p[3 * c], cy = p[3 * a + 1] + p[3 * b + 1] + p[3 * c + 1], cz = p[3 * a + 2] + p[3 * b + 2] + p[3 * c + 2];
      if (n[0] * cx + n[1] * cy + n[2] * cz > 0) outward++;
      total++;
    }
    expect(outward / total).toBeGreaterThan(0.99);
  });

  it('閉じた面（各辺をちょうど 2 つの三角形が共有）', () => {
    const count = new Map<string, number>();
    const idx = m.indices;
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const c of count.values()) expect(c).toBe(2);
  });
});
