import type { ArrhythmiaId, Lesion } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import type { Placement } from '../catheter/placement';
import { snapshotParams, type ParamOverrides } from './params';

/**
 * 症例の状態の書き出し・読み込み（研究用、Phase 7）：パラメータ・カテーテルの配置・病変（頂点ごとの貫壁性と病変タグ）。
 * 読み込むときは、パラメータを先に反映してからエンジンを作り（UI は症例をリセットする）、importCase を呼ぶ。
 */
export interface CaseState {
  format: 'ep-mapping-sim/case';
  version: 1;
  scenario: ArrhythmiaId;
  /** 上書きできるパラメータの値（snapshotParams） */
  params: ParamOverrides;
  /** カテーテル id → 配置（null は置かれていない） */
  placements: Record<string, Placement | null>;
  /** 貫壁性が 0 でない頂点：[頂点 index, 貫壁性] */
  transmurality: [number, number][];
  lesions: Lesion[];
}

export function exportCase(engine: SimulationEngine, scenario: ArrhythmiaId): CaseState {
  const placements: Record<string, Placement | null> = {};
  for (const s of engine.specs) if (s.mode !== 'synthetic') placements[s.catheter.id] = s.placement ? JSON.parse(JSON.stringify(s.placement)) : null;
  const transmurality: [number, number][] = [];
  engine.ablation.field.transmurality.forEach((t, v) => { if (t > 0) transmurality.push([v, Math.round(t * 1e4) / 1e4]); });
  return {
    format: 'ep-mapping-sim/case', version: 1, scenario, params: snapshotParams(),
    placements, transmurality, lesions: engine.lesions.map((l) => ({ ...l, tags: { ...l.tags } })),
  };
}

/** 書き出した状態か（形式と版を確かめる） */
export function isCaseState(x: unknown): x is CaseState {
  const c = x as CaseState;
  return !!c && c.format === 'ep-mapping-sim/case' && c.version === 1 && typeof c.scenario === 'string'
    && typeof c.params === 'object' && Array.isArray(c.transmurality) && Array.isArray(c.lesions);
}

/** 症例の状態を、同じ症例・同じパラメータで作ったエンジンに読み込む */
export function importCase(engine: SimulationEngine, state: CaseState) {
  const n = engine.ablation.field.transmurality.length;
  for (const [v, t] of state.transmurality) {
    if (v < 0 || v >= n) throw new Error('頂点の index がメッシュと合いません（別の解剖の状態です）');
    engine.ablation.field.raise(v, t);
  }
  for (const [id, p] of Object.entries(state.placements)) if (engine.spec(id)) engine.setPlacement(id, p);
  engine.lesions.push(...state.lesions.map((l) => ({ ...l, tags: { ...l.tags } })));
}
