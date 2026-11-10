import { describe, it, expect } from 'vitest';
import { SurfaceEcg, ecgLeadsFor, ECG_LEAD_OPTIONS } from './SurfaceEcg';

/** 100 頂点が 0〜100 ms に一様に活性化する拍 */
function beat(ecg: SurfaceEcg, t0: number, lead: 'I' | 'II' | 'V1') {
  const out: number[] = [];
  for (let t = t0; t < t0 + 160; t += 2) {
    ecg.update(t, t < t0 + 100 ? 2 : 0, 100);
    out.push(ecg.pWave(t, lead));
  }
  return out;
}

describe('SurfaceEcg', () => {
  it('誘導数の選択：1 → II、3 → I・II・V1、12 は準備中', () => {
    expect(ecgLeadsFor(1)).toEqual(['II']);
    expect(ecgLeadsFor(3)).toEqual(['I', 'II', 'V1']);
    expect(ecgLeadsFor(12)).toEqual([]);
    expect(ECG_LEAD_OPTIONS.find((o) => o.count === 12)!.available).toBe(false);
  });

  it('P 波は心房活性化の開始で立ち上がり、全活性化の終わりで戻る（II は陽性単峰）', () => {
    const p = beat(new SurfaceEcg(), 0, 'II');
    expect(p[0]).toBeGreaterThan(0);
    const peak = p.indexOf(Math.max(...p)) * 2;
    expect(peak).toBeGreaterThan(30);
    expect(peak).toBeLessThan(70);
    expect(Math.abs(p[p.length - 1])).toBeLessThan(0.01);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
  });

  it('V1 の P 波は前半陽性・後半陰性の二相性', () => {
    const p = beat(new SurfaceEcg(), 0, 'V1');
    expect(Math.max(...p.slice(0, 25))).toBeGreaterThan(0.02);
    expect(Math.min(...p.slice(25, 50))).toBeLessThan(-0.02);
  });

  it('QRS は QRS 開始の後に II で陽性、V1 で陰性（rS）。T 波は II で陽性', () => {
    const ecg = new SurfaceEcg();
    const ii = (t: number) => ecg.ventricular(t, 'II', [0]);
    const v1 = (t: number) => ecg.ventricular(t, 'V1', [0]);
    expect(ii(40)).toBeGreaterThan(0.8);
    expect(v1(50)).toBeLessThan(-0.6);
    expect(ii(300)).toBeGreaterThan(0.2);
    expect(Math.abs(ii(-40))).toBeLessThan(1e-3);
  });
});
