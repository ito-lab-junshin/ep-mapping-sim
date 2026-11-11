import { ProtocolSession, type ProtocolConfig } from '../core/pacing/ProtocolSession';
import { ablateAt } from '../core/ablation/simpleAblation';
import type { ArrhythmiaId, CureCheck } from '../core/types';
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
 * シナリオ（症例）ごとに 1 つのシミュレーションエンジンを保持する（React の再描画とは独立）。
 * 解剖はシナリオの anatomy（AF = afRemodeled、AFL = aflRemodeled、それ以外 = normal）、
 * 作るときにシナリオの基質を設定する。
 * 3D ビューが tick() で進め、EGM パネルが同じインスタンスのバッファを読む。
 */
const engines = new Map<ArrhythmiaId, SimulationEngine>();

export function getEngine(id: ArrhythmiaId): SimulationEngine {
  let e = engines.get(id);
  if (!e) {
    const scenario = SCENARIOS[id];
    e = new SimulationEngine(loadParametricSync(scenario.anatomy));
    scenario.setupSubstrate(e);
    engines.set(id, e);
  }
  return e;
}

/** 選択中の症例のエンジン */
export function useEngine(): SimulationEngine {
  return getEngine(useSim((s) => s.arrhythmia));
}

/** 症例を最初の状態に戻す（病変・取得点・刺激を消す） */
export function resetCase(id: ArrhythmiaId) {
  engines.delete(id);
  const e = getEngine(id);
  pointSets.delete(e);
  stopProtocol();
  const s = useSim.getState();
  s.bumpPlacement();
  s.bumpMap('症例を最初の状態に戻しました');
  s.setCureChecks(null);
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

// ───────────── 刺激プロトコル・通電・根治判定（Phase 4） ─────────────


let session: ProtocolSession | null = null;
/** プロトコルを始めた時点の病変の数（「最後の通電より後の非誘発」かどうかの判定用） */
let sessionLesionCount = 0;

export function currentSession(): ProtocolSession | null { return session; }

export function startProtocol(engine: SimulationEngine, config: ProtocolConfig) {
  stopProtocol();
  session = new ProtocolSession(engine, config);
  sessionLesionCount = engine.lesions.length;
  useSim.getState().bumpProtocol();
}

export function stopProtocol() {
  if (session && !session.done) session.stop();
  useSim.getState().bumpProtocol();
}

/** 毎フレーム呼ぶ（Scene） */
export function updateProtocol() {
  if (!session || session.done) return;
  const before = session.results.length + session.status;
  session.update();
  if (session.results.length + session.status !== before) useSim.getState().bumpProtocol();
}

/** ABL の先端で簡易通電する。先端が接触していなければ何もしない（戻り値 false） */
export function ablateWithTip(engine: SimulationEngine): boolean {
  const abl = engine.catheter('abl');
  if (!abl?.placed || abl.electrodes[0].contactVertex < 0) return false;
  ablateAt(engine, abl.electrodes[0].position);
  const s = useSim.getState();
  s.bumpPlacement();
  s.setCureChecks(null);
  return true;
}

/**
 * 根治の判定：シナリオの構造的な基準 ＋「最後の通電より後に行った刺激プロトコルで非誘発」。
 * 非誘発の確認は、表示中のエンジンで刺激パネルから行う（複製で走らせると画面が止まるため）。
 */
export function checkCure(engine: SimulationEngine, id: ArrhythmiaId): CureCheck[] {
  const checks = SCENARIOS[id].structuralChecks(engine);
  const spontaneous = SCENARIOS[id].induction.kind === 'spontaneous';
  const afterLastLesion = !!session && session.done && sessionLesionCount === engine.lesions.length && engine.lesions.length > 0;
  const noninducible = spontaneous
    ? engine.lesions.length > 0 && engine.rhythm.state !== 'tachycardia' && engine.rhythm.state !== 'pacing'
    : afterLastLesion && session!.status === 'noninducible';
  checks.push({
    id: 'noninducible',
    label: spontaneous ? 'AF が止まり、再発していない' : '最後の通電の後に、刺激プロトコルで非誘発を確認した',
    ok: noninducible,
  });
  useSim.getState().setCureChecks(checks);
  return checks;
}
