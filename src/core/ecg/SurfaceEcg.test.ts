import { describe, it, expect } from 'vitest';
import { SurfaceEcg, ecgLeadsFor, ECG_LEAD_OPTIONS, LEAD_VECTOR, ATRIAL_ECG_GAIN } from './SurfaceEcg';
import type { VentricularBeat } from '../conduction/ConductionSystem';

const his = (time: number): VentricularBeat => ({ time, source: 'his' });

describe('SurfaceEcg', () => {
  it('誘導数の選択：1 → II、3 → I・II・V1、12 は準備中', () => {
    expect(ecgLeadsFor(1)).toEqual(['II']);
    expect(ecgLeadsFor(3)).toEqual(['I', 'II', 'V1']);
    expect(ecgLeadsFor(12)).toEqual([]);
    expect(ECG_LEAD_OPTIONS.find((o) => o.count === 12)!.available).toBe(false);
  });

  it('心房成分は電気ベクトルの誘導方向への投影：左下向きの興奮は I・II で陽性、上向きは II で陰性', () => {
    const ecg = new SurfaceEcg();
    ecg.setAtrialDipole({ x: 50, y: -50, z: 0 });
    expect(ecg.atrial('I')).toBeCloseTo(ATRIAL_ECG_GAIN * 50);
    expect(ecg.atrial('II')).toBeGreaterThan(0);
    ecg.setAtrialDipole({ x: 0, y: 80, z: 0 });
    expect(ecg.atrial('II')).toBeLessThan(0);
    // 誘導の方向は単位ベクトル
    for (const l of Object.values(LEAD_VECTOR)) expect(Math.hypot(l.x, l.y, l.z)).toBeCloseTo(1, 2);
  });

  it('His 経由の QRS は II で陽性、V1 で陰性（rS）。T 波は II で陽性', () => {
    const ecg = new SurfaceEcg();
    expect(ecg.ventricular(40, 'II', [his(0)])).toBeGreaterThan(0.8);
    expect(ecg.ventricular(50, 'V1', [his(0)])).toBeLessThan(-0.6);
    expect(ecg.ventricular(300, 'II', [his(0)])).toBeGreaterThan(0.2);
    expect(Math.abs(ecg.ventricular(-40, 'II', [his(0)]))).toBeLessThan(1e-3);
  });

  it('副伝導路による早期興奮：QRS の前にデルタ波（I で陰性、V1 で陽性）、早期興奮が長いほど大きい', () => {
    const ecg = new SurfaceEcg();
    const pre = (fusion: number): VentricularBeat => ({ time: 0, source: 'ap', hisArrival: fusion });
    // デルタ波の途中（His 経由の QRS が始まる前）
    expect(ecg.ventricular(25, 'I', [pre(40)])).toBeLessThan(-0.05);
    expect(ecg.ventricular(25, 'V1', [pre(40)])).toBeGreaterThan(0.05);
    // デルタ波の終わり（His 経由の QRS が始まる直前）の振幅で比べる
    const deltaEnd = (f: number) => Math.abs(ecg.ventricular(f - 1, 'V1', [pre(f)]));
    expect(deltaEnd(50)).toBeGreaterThan(deltaEnd(20));
    // His 経由だけの拍にはデルタ波がない
    expect(Math.abs(ecg.ventricular(5, 'V1', [his(0)]))).toBeLessThan(0.05);
  });

  it('RV ペーシングの QRS は幅が広い', () => {
    const ecg = new SurfaceEcg();
    const width = (beat: VentricularBeat) => {
      let first = -1, last = -1;
      for (let t = -20; t < 200; t++) if (Math.abs(ecg.ventricular(t, 'II', [beat])) > 0.1) { if (first < 0) first = t; last = t; }
      return last - first;
    };
    expect(width({ time: 0, source: 'pace' })).toBeGreaterThan(width(his(0)) + 30);
  });
});
