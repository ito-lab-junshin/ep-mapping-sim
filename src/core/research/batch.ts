import type { ArrhythmiaId } from '../types';
import type { ProtocolConfig } from '../pacing/ProtocolSession';
import { SimulationEngine } from '../sim/SimulationEngine';
import { loadParametricSync } from '../geometry/ChamberLoader';
import { SCENARIOS } from '../arrhythmia';
import { tryInduce } from '../arrhythmia/common';
import { isolatedPvs } from '../arrhythmia/pv';
import { PV_NAMES } from '../geometry/regions';
import { withParams, type ParamOverrides } from './params';
import { applyStandardAblation, type AblationPlan } from './strategies';

/**
 * 一括実行（Phase 7、docs/DESIGN.md §4.3）。条件（パラメータの組）ごとに 1 行の結果を出す：
 * 誘発の成否・頻拍の周期長・P 波幅（両心房の総興奮時間）・通電の条件と貫壁性・PVI の完了。
 * ブラウザを使わず Node で動く（scripts/batch.ts）。
 */

export interface BatchCondition {
  id?: string;
  scenario?: ArrhythmiaId;
  params?: ParamOverrides;
  /** 通電（省略すると通電しない） */
  ablation?: AblationPlan;
  /** 誘発の刺激プロトコルの上書き（例：{ observeMs: 1000 }） */
  induction?: Partial<ProtocolConfig>;
}

export interface BatchConfig {
  name?: string;
  /** 既定の症例 */
  scenario?: ArrhythmiaId;
  /** すべての条件に共通の上書き */
  base?: ParamOverrides;
  /** 値の組み合わせ（直積）で条件を作る */
  sweep?: Record<string, number[]>;
  /** 明示した条件（sweep と両方あれば、各条件に sweep の組み合わせを掛ける） */
  conditions?: BatchCondition[];
  ablation?: AblationPlan;
  induction?: Partial<ProtocolConfig>;
  /** 通電の後にもう一度誘発を試す（既定 true） */
  inductionAfterAblation?: boolean;
}

export interface BatchRow {
  id: string;
  scenario: ArrhythmiaId;
  params: ParamOverrides;
  induced: boolean;
  tachyClMs: number | null;
  /** 洞調律 1 拍の両心房の総興奮時間（最初の興奮 → 最後の頂点の興奮）ms */
  pWaveMs: number;
  ablation: AblationPlan | null;
  lesions: number;
  /** 病変の中心の貫壁性 %（最小・平均） */
  transmuralityMinPct: number | null;
  transmuralityMeanPct: number | null;
  /** 隔離できた PV の数と PVI の完了（AF だけ） */
  isolatedPvs: number | null;
  pviComplete: boolean | null;
  inducedAfterAblation: boolean | null;
}

/** 条件の展開：base → 条件の params → sweep の組み合わせ の順に重ねる */
export type ExpandedCondition = BatchCondition & { id: string; scenario: ArrhythmiaId; params: ParamOverrides };

export function expandConditions(cfg: BatchConfig): ExpandedCondition[] {
  const conds = cfg.conditions?.length ? cfg.conditions : [{}];
  const keys = Object.keys(cfg.sweep ?? {});
  let combos: ParamOverrides[] = [{}];
  for (const k of keys) combos = combos.flatMap((c) => cfg.sweep![k].map((v) => ({ ...c, [k]: v })));
  const out: ExpandedCondition[] = [];
  conds.forEach((c, i) => combos.forEach((combo, j) => {
    const scenario = c.scenario ?? cfg.scenario;
    if (!scenario || !SCENARIOS[scenario]) throw new Error(`症例がありません：${scenario}`);
    const id = [c.id ?? (cfg.conditions?.length ? `c${i + 1}` : ''), keys.length ? `s${j + 1}` : ''].filter(Boolean).join('-') || 'c1';
    out.push({
      ...c, id, scenario,
      params: { ...cfg.base, ...c.params, ...combo },
      ablation: c.ablation ?? cfg.ablation,
      induction: { ...cfg.induction, ...c.induction },
    });
  }));
  return out;
}

/** 洞調律 1 拍の両心房の総興奮時間 ms（AF のトリガーは止める） */
export function totalActivationMs(e: SimulationEngine): number {
  e.foci.length = 0;
  e.sinusEnabled = false;
  const t0 = e.time;
  e.ca.stimulate(e.sinusVertex);
  e.tick(400);
  let first = Infinity, last = -Infinity;
  e.ca.tissue.lastActivation.forEach((t) => { if (t >= t0) { first = Math.min(first, t); last = Math.max(last, t); } });
  return last - first;
}

/** 1 つの条件を実行する */
export function runCondition(c: ExpandedCondition, inductionAfterAblation = true): BatchRow {
  return withParams(c.params, () => {
    const scenario = SCENARIOS[c.scenario];
    const make = () => { const e = new SimulationEngine(loadParametricSync(scenario.anatomy)); scenario.setupSubstrate(e); return e; };
    const pWaveMs = totalActivationMs(make());
    const base = make();
    const ind = tryInduce(base, scenario, c.induction ?? {});
    const tachyClMs = ind.induced ? ind.engine.rhythm.currentCycleLength(ind.engine.time) : null;
    const row: BatchRow = {
      id: c.id, scenario: c.scenario, params: c.params, induced: ind.induced, tachyClMs, pWaveMs,
      ablation: c.ablation ?? null, lesions: 0, transmuralityMinPct: null, transmuralityMeanPct: null,
      isolatedPvs: null, pviComplete: null, inducedAfterAblation: null,
    };
    if (c.ablation) {
      applyStandardAblation(base, c.scenario, c.ablation);
      const t = base.lesions.map((l) => 100 * l.transmurality);
      row.lesions = t.length;
      if (t.length) { row.transmuralityMinPct = Math.min(...t); row.transmuralityMeanPct = t.reduce((a, b) => a + b, 0) / t.length; }
      if (c.scenario === 'af') { row.isolatedPvs = isolatedPvs(base).length; row.pviComplete = row.isolatedPvs === PV_NAMES.length; }
      if (inductionAfterAblation) row.inducedAfterAblation = tryInduce(base, scenario, c.induction ?? {}).induced;
    }
    return row;
  });
}

export function runBatch(cfg: BatchConfig, onRow?: (row: BatchRow, index: number, total: number) => void): BatchRow[] {
  const conds = expandConditions(cfg);
  return conds.map((c, i) => { const r = runCondition(c, cfg.inductionAfterAblation ?? true); onRow?.(r, i, conds.length); return r; });
}

const fmt = (x: number | null | boolean | undefined, d = 1) => (x === null || x === undefined ? '' : typeof x === 'boolean' ? (x ? '1' : '0') : Number.isInteger(x) ? String(x) : x.toFixed(d));
const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const paramCell = (v: unknown) => (v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v));

/** 結果を CSV にする。先頭に実行時の設定を「# 」で始まるコメント行で残す */
export function toCsv(rows: BatchRow[], cfg: BatchConfig, meta: Record<string, string> = {}): string {
  const paramKeys = [...new Set(rows.flatMap((r) => Object.keys(r.params)))].sort();
  const lines: string[] = [];
  lines.push('# ep-mapping-sim batch（教育用シミュレータ。値は教育用近似）');
  for (const [k, v] of Object.entries(meta)) lines.push(`# ${k}: ${v}`);
  lines.push(`# config: ${JSON.stringify(cfg)}`);
  lines.push('# 列：p_wave_ms＝洞調律 1 拍の両心房の総興奮時間、tachy_cl_ms＝頻拍の周期長、transmurality_*＝病変の中心の貫壁性、pvi_complete＝4 本の PV の entrance block（AF のみ）');
  const header = ['id', 'scenario', ...paramKeys, 'induced', 'tachy_cl_ms', 'p_wave_ms',
    'energy', 'power_w', 'duration_s', 'height_mm', 'spacing_mm', 'push01', 'misalign_deg', 'pfa_shape', 'pfa_applications',
    'lesions', 'transmurality_min_pct', 'transmurality_mean_pct', 'isolated_pvs', 'pvi_complete', 'induced_after_ablation'];
  lines.push(header.join(','));
  for (const r of rows) {
    const a = r.ablation;
    lines.push([
      r.id, r.scenario, ...paramKeys.map((k) => paramCell(r.params[k])),
      fmt(r.induced), fmt(r.tachyClMs, 0), fmt(r.pWaveMs, 0),
      a?.energy ?? '', fmt(a?.powerW), fmt(a?.durationS), fmt(a?.heightMm), fmt(a?.spacingMm), fmt(a?.push01, 2), fmt(a?.misalignDeg), a?.shape ?? '', fmt(a?.applications),
      fmt(r.lesions), fmt(r.transmuralityMinPct, 0), fmt(r.transmuralityMeanPct, 0), fmt(r.isolatedPvs), fmt(r.pviComplete), fmt(r.inducedAfterAblation),
    ].map(cell).join(','));
  }
  return lines.join('\n') + '\n';
}
