import { describe, it, expect } from 'vitest';
import { CONDUCTION, AFL_SUBSTRATE, ABLATION } from '../params';
import { getParam, setParams, snapshotParams, withParams } from './params';
import { expandConditions, runBatch, toCsv, totalActivationMs, type BatchConfig } from './batch';
import { SimulationEngine } from '../sim/SimulationEngine';
import { loadParametricSync } from '../geometry/ChamberLoader';

describe('研究用：パラメータの上書き', () => {
  it('キーで読み書きでき、withParams の後は元に戻る。未知のキー・型の違いはエラー', () => {
    expect(getParam('CONDUCTION.atrialCv')).toBe(CONDUCTION.atrialCv);
    const v = withParams({ 'CONDUCTION.atrialCv': 0.7, 'ABLATION.rf.dose.powerExp': 1.5, 'AF_SUBSTRATE.triggerClMs': [100, 120] }, () => {
      expect(getParam('ABLATION.rf.dose.powerExp')).toBe(1.5);
      expect(getParam('AF_SUBSTRATE.triggerClMs')).toEqual([100, 120]);
      return CONDUCTION.atrialCv;
    });
    expect(v).toBe(0.7);
    expect(CONDUCTION.atrialCv).toBe(1.0);
    expect(ABLATION.rf.dose.powerExp).toBe(1.2);
    expect(() => setParams({ 'CONDUCTION.nothing': 1 })).toThrow();
    expect(() => setParams({ 'AFL_SUBSTRATE.raCv': [1, 2] })).toThrow();
    expect(() => setParams({ 'AF_SUBSTRATE.triggerClMs': 100 })).toThrow();
    expect(AFL_SUBSTRATE.raCv).toBe(0.6);
  });

  it('現在の値をすべて書き出せる（入れ子のグループも「.」でつなぐ）', () => {
    const s = snapshotParams();
    expect(s['CONDUCTION.atrialCv']).toBe(1.0);
    expect(s['ABLATION.rf.targetRefS.posterior']).toBe(30);
    expect(s['AV_NODE.slow.erpMs']).toBe(200);
  });
});

describe('研究用：一括実行', () => {
  it('条件の展開：base → 条件 → sweep の直積。id は条件と sweep の番号', () => {
    const cfg: BatchConfig = {
      scenario: 'afl_cti', base: { 'AFL_SUBSTRATE.ctiCv': 0.3 },
      sweep: { 'AFL_SUBSTRATE.raCv': [0.5, 0.6] },
      conditions: [{ id: 'a' }, { id: 'b', scenario: 'avnrt', params: { 'AFL_SUBSTRATE.ctiCv': 0.4 } }],
    };
    const c = expandConditions(cfg);
    expect(c.map((x) => x.id)).toEqual(['a-s1', 'a-s2', 'b-s1', 'b-s2']);
    expect(c[3]).toMatchObject({ scenario: 'avnrt', params: { 'AFL_SUBSTRATE.ctiCv': 0.4, 'AFL_SUBSTRATE.raCv': 0.6 } });
    expect(c[0].params['AFL_SUBSTRATE.ctiCv']).toBe(0.3);
    expect(() => expandConditions({ conditions: [{}] })).toThrow();
  });

  it('総興奮時間（P 波幅の指標）：normal で約 120 ms、伝導速度を下げると長くなる', () => {
    const base = totalActivationMs(new SimulationEngine(loadParametricSync('normal')));
    expect(base).toBeGreaterThan(105); expect(base).toBeLessThan(135);
    const slow = withParams({ 'CONDUCTION.atrialCv': 0.7 }, () => totalActivationMs(new SimulationEngine(loadParametricSync('normal'))));
    expect(slow).toBeGreaterThan(base * 1.3);
  });

  it('AVNRT の 2 条件：誘発・周期長・通電条件と貫壁性・通電後の非誘発が 1 行ずつ CSV に出て、先頭に設定がコメント行で残る', () => {
    const cfg: BatchConfig = {
      name: 'テスト', scenario: 'avnrt',
      conditions: [
        { id: 'none' },
        { id: 'rf', ablation: { energy: 'rf', powerW: 30, durationS: 30 } },
      ],
      induction: { s1Beats: 4, s2StartMs: 360, observeMs: 1200 },
    };
    const rows = runBatch(cfg);
    expect(rows.map((r) => r.induced)).toEqual([true, true]);
    expect(rows[0].tachyClMs!).toBeGreaterThan(220);
    expect(rows[0].lesions).toBe(0);
    expect(rows[1].lesions).toBe(1);
    expect(rows[1].transmuralityMinPct).toBe(100);
    expect(rows[1].inducedAfterAblation).toBe(false);
    expect(rows[1].pviComplete).toBeNull();
    const csv = toCsv(rows, cfg, { name: 'テスト' });
    const lines = csv.trim().split('\n');
    expect(lines[0].startsWith('# ')).toBe(true);
    expect(lines.some((l) => l.startsWith('# config: {'))).toBe(true);
    const header = lines.find((l) => !l.startsWith('#'))!.split(',');
    expect(header).toEqual(expect.arrayContaining(['induced', 'tachy_cl_ms', 'p_wave_ms', 'energy', 'power_w', 'transmurality_min_pct', 'pvi_complete']));
    const data = lines.filter((l) => !l.startsWith('#')).slice(1);
    expect(data).toHaveLength(2);
    const rf = Object.fromEntries(header.map((h, i) => [h, data[1].split(',')[i]]));
    expect(rf).toMatchObject({ id: 'rf', scenario: 'avnrt', induced: '1', energy: 'rf', power_w: '30', induced_after_ablation: '0' });
  }, 300_000);
});

import { exportCase, importCase, isCaseState } from './caseState';
import { afScenario } from '../arrhythmia/af';
import { isolatedPvs } from '../arrhythmia/pv';

describe('研究用：症例の状態の書き出し・読み込み', () => {
  it('JSON を通して読み込むと、病変（貫壁性・伝導遮断）・カテーテルの配置・病変タグが再現される', () => {
    const make = () => { const e = new SimulationEngine(loadParametricSync('afRemodeled')); afScenario.setupSubstrate(e); return e; };
    const a = make();
    a.ablation.pfa = { pv: 'LSPV', shape: 'flower' };
    a.ablation.applyPfa(); a.ablation.applyPfa();
    a.ablation.pfa = { pv: 'RSPV', shape: 'basket' };
    a.ablation.applyPfa();
    const pv = a.model.anatomy.la.pvs[0];
    a.setPlacement('circ', { kind: 'free', point: pv.ostium, heightMm: 1, rotationDeg: 30, diameterMm: 18 });
    const json = JSON.stringify(exportCase(a, 'af'));
    const state = JSON.parse(json);
    expect(isCaseState(state)).toBe(true);
    expect(isCaseState({ format: 'x' })).toBe(false);
    const b = make();
    importCase(b, state);
    expect(isolatedPvs(b)).toEqual(isolatedPvs(a));
    expect(isolatedPvs(b)).toEqual(['LSPV']);
    let maxDiff = 0;
    b.ca.tissue.viability.forEach((x, v) => { maxDiff = Math.max(maxDiff, Math.abs(x - a.ca.tissue.viability[v])); });
    expect(maxDiff).toBeLessThan(1e-3);
    expect(b.lesions.map((l) => l.tags.applications)).toEqual([1, 2, 1]);
    expect(b.spec('circ')!.placement).toEqual(a.spec('circ')!.placement);
    expect(state.params['CONDUCTION.atrialCv']).toBe(1);
  });
});
