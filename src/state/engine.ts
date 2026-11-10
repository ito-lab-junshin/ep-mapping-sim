import type { AnatomyDimensionSet } from '../core/types';
import { SimulationEngine } from '../core/sim/SimulationEngine';
import { loadParametricSync } from '../core/geometry/ChamberLoader';
import type { Placement } from '../core/catheter/placement';
import type { CatheterSpec } from '../core/catheter/catalog';
import type { SystemTheme } from '../systems';
import { SCENARIOS } from '../core/arrhythmia';
import { useSim } from './store';
import { PointCollection } from '../core/mapping/PointCollection';
import { acquirePoints } from '../core/mapping/acquire';
import { catheterGroup } from '../core/catheter/catalog';
import { MAP_DEFAULTS } from '../core/params';

/**
 * 解剖寸法セットごとに 1 つのシミュレーションエンジンを保持する（React の再描画とは独立）。
 * AF は afRemodeled、それ以外は normal（シナリオの anatomy）。
 * 3D ビューが tick() で進め、EGM パネルが同じインスタンスのバッファを読む。
 */
const engines = new Map<AnatomyDimensionSet, SimulationEngine>();

export function getEngine(set: AnatomyDimensionSet): SimulationEngine {
  let e = engines.get(set);
  if (!e) {
    e = new SimulationEngine(loadParametricSync(set));
    engines.set(set, e);
  }
  return e;
}

/** 選択中の症例のエンジン */
export function useEngine(): SimulationEngine {
  const set = useSim((s) => SCENARIOS[s.arrhythmia].anatomy);
  return getEngine(set);
}

/** カテーテルを置き直し、UI に知らせる */
export function placeCatheter(engine: SimulationEngine, id: string, placement: Placement | null) {
  engine.setPlacement(id, placement);
  useSim.getState().bumpPlacement();
}

/** テーマの機能フラグで使えるカテーテルか（多極スプライン／グリッド） */
export function catheterAvailable(spec: CatheterSpec, theme: SystemTheme): boolean {
  return !spec.requires || theme.features[spec.requires];
}

/** エンジン（症例）ごとの取得点。テーマを切り替えても残る（同じ症例を見比べるため） */
const pointSets = new Map<SimulationEngine, PointCollection>();

export function getPoints(engine: SimulationEngine): PointCollection {
  let p = pointSets.get(engine);
  if (!p) { p = new PointCollection(engine.mesh); pointSets.set(engine, p); }
  return p;
}

/** マッピングに使えるカテーテル（環状・多極・ABL）のうち、置かれていてテーマで使えるもの */
export function mappingCatheters(engine: SimulationEngine, theme: SystemTheme): CatheterSpec[] {
  return engine.specs.filter((s) => s.catheter.placed && catheterAvailable(s, theme)
    && (catheterGroup(s.catheter.kind) === 'map' || s.catheter.kind === 'ablation_tip'));
}

const REASON: Record<string, string> = {
  'no-reference': '基準チャンネルの興奮が見つからないか、WOI の記録が終わっていません',
  'no-contact': '接触している電極の組がありません（押し込んでください）',
  'not-placed': 'マッピングカテーテルが置かれていません',
};

/**
 * 置かれているマッピングカテーテルから点を取得する。
 * auto = true（自動取得）は多極カテーテルだけを使い、既存の点の近くは取り直さない。
 * 戻り値：取得できた点の数
 */
export function acquireNow(engine: SimulationEngine, theme: SystemTheme, auto = false): number {
  const s = useSim.getState();
  const pc = getPoints(engine);
  let added = 0;
  let reason = '';
  let woiNote = '';
  const cats = mappingCatheters(engine, theme).filter((c) => !auto || catheterGroup(c.catheter.kind) === 'map');
  if (!cats.length) reason = REASON['not-placed'];
  for (const spec of cats) {
    const r = acquirePoints(engine, spec.catheter.id, s.mapSettings, {
      omnipolar: theme.features.omnipolarEgm && spec.catheter.kind === 'grid', rhythm: s.tachycardia,
    });
    if (r.woi?.auto) woiNote = `（頻拍のため WOI を ${r.woi.beforeMs}〜+${r.woi.afterMs} ms に自動調整）`;
    if (!r.points.length) { reason = REASON[r.reason ?? 'no-contact']; continue; }
    for (const p of r.points) {
      if (auto && pc.hasNear(p.position, MAP_DEFAULTS.autoMinSpacingMm)) continue;
      pc.add(p);
      added++;
    }
  }
  if (added || !auto) {
    s.bumpMap(added ? `${added} 点を取得（合計 ${pc.points.length} 点）${woiNote}` : `取得できませんでした：${reason}`);
  }
  return added;
}

export function clearPoints(engine: SimulationEngine) {
  getPoints(engine).clear();
  useSim.getState().bumpMap('取得点を消去しました');
}
