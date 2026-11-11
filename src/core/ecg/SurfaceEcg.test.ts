import { describe, it, expect } from 'vitest';
import { SurfaceEcg, ecgLeadsFor, ECG_LEAD_OPTIONS, LEAD_VECTOR, ATRIAL_ECG_GAIN, PRECORDIAL_LEADS, PROXIMITY_GAIN } from './SurfaceEcg';
import { gaussSum } from '../egm/templates';
import { QT_MS } from '../params';
import type { VentricularBeat } from '../conduction/ConductionSystem';

const his = (time: number): VentricularBeat => ({ time, source: 'his' });

describe('SurfaceEcg', () => {
  it('誘導数の選択：1 → II、3 → I・II・V1、12 → 肢誘導 6 ＋ 胸部誘導 6', () => {
    expect(ecgLeadsFor(1)).toEqual(['II']);
    expect(ecgLeadsFor(3)).toEqual(['I', 'II', 'V1']);
    expect(ecgLeadsFor(12)).toEqual(['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']);
    expect(ECG_LEAD_OPTIONS.every((o) => o.available)).toBe(true);
  });

  it('心房成分は電気ベクトルの誘導方向への投影：左下向きの興奮は I・II で陽性、上向きは II で陰性', () => {
    const ecg = new SurfaceEcg();
    ecg.setAtrialDipole({ x: 50, y: -50, z: 0 });
    expect(ecg.atrial('I')).toBeCloseTo(ATRIAL_ECG_GAIN * 50);
    expect(ecg.atrial('II')).toBeGreaterThan(0);
    ecg.setAtrialDipole({ x: 0, y: 80, z: 0 });
    expect(ecg.atrial('II')).toBeLessThan(0);
    // I・II・III と胸部誘導は単位ベクトル、増高単極肢誘導は Einthoven の関係から大きさ 0.87
    for (const k of ['I', 'II', 'III', ...PRECORDIAL_LEADS] as const) expect(Math.hypot(LEAD_VECTOR[k].x, LEAD_VECTOR[k].y, LEAD_VECTOR[k].z)).toBeCloseTo(1, 2);
    for (const k of ['aVR', 'aVL', 'aVF'] as const) expect(Math.hypot(LEAD_VECTOR[k].x, LEAD_VECTOR[k].y, LEAD_VECTOR[k].z)).toBeCloseTo(0.866, 2);
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

  // ───────────── 12 誘導（Phase 7） ─────────────
  const at = (ecg: SurfaceEcg, t: number, lead: Parameters<SurfaceEcg['ventricular']>[1], beat: VentricularBeat) => ecg.ventricular(t, lead, [beat]);
  const peak = (ecg: SurfaceEcg, lead: Parameters<SurfaceEcg['ventricular']>[1], beat: VentricularBeat, from = 0, to = 120) => {
    let best = 0;
    for (let t = from; t <= to; t++) { const x = at(ecg, t, lead, beat); if (Math.abs(x) > Math.abs(best)) best = x; }
    return best;
  };

  it('肢誘導は Einthoven の関係を満たす（III = II − I、aVR + aVL + aVF = 0）', () => {
    const ecg = new SurfaceEcg();
    ecg.setAtrialDipole({ x: 30, y: -40, z: 10 });
    for (const t of [10, 40, 65, 300]) {
      const s = (l: Parameters<SurfaceEcg['sample']>[1]) => ecg.sample(t, l, [his(0)]);
      expect(s('III')).toBeCloseTo(s('II') - s('I'), 6);
      expect(s('aVR') + s('aVL') + s('aVF')).toBeCloseTo(0, 6);
    }
  });

  it('His 経由：aVR は陰性、胸部誘導は V1 の rS から V6 の R へ移行し、V6 に小さな中隔性 q', () => {
    const ecg = new SurfaceEcg();
    expect(peak(ecg, 'aVR', his(0))).toBeLessThan(-0.5);
    const main = PRECORDIAL_LEADS.map((l) => at(ecg, 43, l, his(0)));
    expect(main[0]).toBeLessThan(-0.5);
    expect(main[5]).toBeGreaterThan(0.5);
    // 近接補正の前の投影（ベクトルと誘導の向きだけ）は V1 から V6 へ単調に増える
    const raw = PRECORDIAL_LEADS.map((l) => main[PRECORDIAL_LEADS.indexOf(l)] / PROXIMITY_GAIN[l].qrs);
    for (let i = 1; i < 6; i++) expect(raw[i]).toBeGreaterThan(raw[i - 1]);
    expect(at(ecg, 17, 'V6', his(0))).toBeLessThan(0);
    expect(at(ecg, 17, 'V1', his(0))).toBeGreaterThan(0.1);
  });

  it('Phase 6 までの I・II・V1 のテンプレートとほぼ同じ波形（QRS と I・II の T のピークの差 15 % 以内。V1 の T は平坦に近づけた）', () => {
    const tPeak = QT_MS - 80;
    const OLD = {
      I: [[15, 5, -0.04], [40, 11, 0.7], [66, 7, -0.1], [tPeak, 40, 0.2]],
      II: [[15, 5, -0.05], [40, 10, 1.1], [65, 7, -0.2], [tPeak, 40, 0.3]],
      V1: [[22, 7, 0.25], [50, 12, -0.9], [tPeak, 40, -0.08]],
    } as const;
    const ecg = new SurfaceEcg();
    for (const lead of ['I', 'II', 'V1'] as const) {
      for (const [from, to] of (lead === 'V1' ? [[0, 120]] : [[0, 120], [200, 450]])) {
        let oldPeak = 0;
        for (let t = from; t <= to; t++) { const x = gaussSum(t, OLD[lead]); if (Math.abs(x) > Math.abs(oldPeak)) oldPeak = x; }
        const newPeak = peak(ecg, lead, his(0), from, to);
        expect(Math.sign(newPeak)).toBe(Math.sign(oldPeak));
        expect(Math.abs(newPeak - oldPeak) / Math.abs(oldPeak), `${lead} ${from}`).toBeLessThan(0.15);
      }
    }
  });

  it('胸部誘導の近接補正：正常洞調律で V2〜V4 の R 波は 0.7〜2 mV、R 波は V1 から V5 まで漸増し、移行帯（R/S が 1 を超える）は V3〜V4。補正係数は正（極性は変わらない）', () => {
    const ecg = new SurfaceEcg();
    const rs = PRECORDIAL_LEADS.map((l) => {
      let R = 0, S = 0;
      for (let t = 0; t < 110; t++) { const x = at(ecg, t, l, his(0)); R = Math.max(R, x); S = Math.min(S, x); }
      return { R, S: -S };
    });
    for (const i of [1, 2, 3]) { expect(rs[i].R).toBeGreaterThan(0.7); expect(rs[i].R).toBeLessThan(2); }
    for (let i = 1; i < 5; i++) expect(rs[i].R).toBeGreaterThan(rs[i - 1].R);
    const transition = rs.findIndex((x) => x.R > x.S);
    expect(transition === 2 || transition === 3, `移行帯 V${transition + 1}`).toBe(true);
    for (const g of Object.values(PROXIMITY_GAIN)) { expect(g.qrs).toBeGreaterThan(0); expect(g.t).toBeGreaterThan(0); }
    // 心房成分（P 波・粗動波）には近接補正を掛けない
    ecg.setAtrialDipole({ x: 0, y: 0, z: 100 });
    expect(ecg.atrial('V2')).toBeCloseTo(ATRIAL_ECG_GAIN * 100);
  });

  it('左側自由壁の副伝導路のデルタ波：V1 で陽性、I・aVL で陰性、下壁誘導（II・III・aVF）で陽性', () => {
    const ecg = new SurfaceEcg();
    const pre: VentricularBeat = { time: 0, source: 'ap', hisArrival: 40 };
    expect(at(ecg, 25, 'V1', pre)).toBeGreaterThan(0.05);
    expect(at(ecg, 25, 'I', pre)).toBeLessThan(0);
    expect(at(ecg, 25, 'aVL', pre)).toBeLessThan(0);
    for (const l of ['II', 'III', 'aVF'] as const) expect(at(ecg, 25, l, pre)).toBeGreaterThan(0);
  });

  it('RV 心尖ペーシング：上方軸（II・III・aVF で陰性、aVL で陽性）、V1〜V3 で陰性（左脚ブロック型）', () => {
    const ecg = new SurfaceEcg();
    const pace: VentricularBeat = { time: 0, source: 'pace' };
    for (const l of ['II', 'III', 'aVF'] as const) expect(peak(ecg, l, pace)).toBeLessThan(-0.3);
    expect(peak(ecg, 'aVL', pace)).toBeGreaterThan(0.3);
    for (const l of ['V1', 'V2', 'V3'] as const) expect(peak(ecg, l, pace)).toBeLessThan(-0.3);
  });
});
