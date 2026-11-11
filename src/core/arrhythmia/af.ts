import type { ArrhythmiaScenario, CureCheck } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES, PV_SLEEVE, REGION_ID, REGIONS, type PvName } from '../geometry/regions';
import { seededRandom } from '../pacing/Stimulator';
import { AF_SUBSTRATE } from '../params';
import { cloneWithSubstrate, separated } from './common';

/** PV のスリーブの頂点 */
export function sleeveVertices(engine: SimulationEngine, pv: PvName): number[] {
  const id = REGION_ID[PV_SLEEVE[pv]];
  const out: number[] = [];
  engine.mesh.regionOfVertex.forEach((r, v) => { if (r === id) out.push(v); });
  return out;
}

/** スリーブの先端（PV 口から最も遠い）の頂点：トリガーの位置 */
export function sleeveTip(engine: SimulationEngine, pv: PvName): number {
  const info = engine.model.anatomy.la.pvs.find((p) => p.name === pv)!;
  const p = engine.mesh.positions;
  let best = -1, bestA = -Infinity;
  for (const v of sleeveVertices(engine, pv)) {
    const a = (p[3 * v] - info.ostium.x) * info.frame.axis.x + (p[3 * v + 1] - info.ostium.y) * info.frame.axis.y + (p[3 * v + 2] - info.ostium.z) * info.frame.axis.z;
    if (a > bestA) { bestA = a; best = v; }
  }
  return best;
}

/** LA 本体（PV のスリーブ・口以外）の頂点 */
function laBody(engine: SimulationEngine): number[] {
  const la = engine.mesh.parts![0];
  const out: number[] = [];
  for (let v = la.vertexStart; v < la.vertexStart + la.vertexCount; v++) {
    const r = REGIONS[engine.mesh.regionOfVertex[v]];
    if (!r.endsWith('_sleeve') && !r.endsWith('_ostium')) out.push(v);
  }
  return out;
}

/** トリガーを置く PV（最も多い上肺静脈 2 本） */
export const AF_TRIGGER_PVS: PvName[] = ['LSPV', 'RSPV'];

/**
 * 心房細動（AF）— PVI（docs/DESIGN.md §5.1、方針は案 A）
 *  - 基質：心房筋の ERP 160〜200 ms（斑状のばらつき）、PV スリーブ（伝導速度 0.5 mm/ms・ERP 180 ms）、
 *    LSPV・RSPV のスリーブ先端にトリガー（周期 150〜250 ms でランダムに発火）
 *  - AF は「PV トリガーの高頻度発火による不規則な伝導（fibrillatory conduction）」として表す。
 *    一般心房筋の波長（1.0 mm/ms × ERP）は LA の周長より長く、旋回は持続しないため、
 *    トリガーを隔離すると洞調律に戻る
 *  - 誘発：トリガーの発火で自然に始まる
 *  - 根治：4 本の PV すべてで entrance block（病変で LA 本体から隔てられている）と exit block
 */
export const afScenario: ArrhythmiaScenario = {
  id: 'af',
  label: '心房細動（PVI）',
  chambers: ['LA'],
  anatomy: 'afRemodeled',
  induction: { kind: 'spontaneous', site: 'CS_PROX' },
  setupSubstrate(engine) {
    const t = engine.ca.tissue;
    const n = t.erp.length;
    // ERP の斑状のばらつき：乱数をメッシュ上でなめらかにし、範囲 160〜200 ms に伸ばす
    const rng = seededRandom(20261111);
    let e = Float32Array.from({ length: n }, () => rng());
    for (let it = 0; it < AF_SUBSTRATE.erpSmoothingIterations; it++) {
      const next = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        let s = e[v], k = 1;
        for (const u of engine.mesh.neighbors[v]) { s += e[u]; k++; }
        next[v] = s / k;
      }
      e = next;
    }
    let lo = Infinity, hi = -Infinity;
    e.forEach((x) => { lo = Math.min(lo, x); hi = Math.max(hi, x); });
    const [eMin, eMax] = AF_SUBSTRATE.atrialErpMs;
    for (let v = 0; v < n; v++) t.erp[v] = eMin + ((e[v] - lo) / (hi - lo || 1)) * (eMax - eMin);
    // PV スリーブ
    for (const pv of PV_NAMES) {
      for (const v of sleeveVertices(engine, pv)) {
        t.conductionVelocity[v] = AF_SUBSTRATE.pvSleeveCv;
        t.erp[v] = AF_SUBSTRATE.pvSleeveErpMs;
      }
    }
    // トリガー
    engine.foci = [];
    AF_TRIGGER_PVS.forEach((pv, i) => engine.addFocus(sleeveTip(engine, pv), AF_SUBSTRATE.triggerClMs[0], AF_SUBSTRATE.triggerClMs[1], 101 + i));
  },
  structuralChecks(engine) {
    const viab = engine.ca.tissue.viability;
    const body = laBody(engine);
    const checks: CureCheck[] = PV_NAMES.map((pv) => {
      const targets = new Set(sleeveVertices(engine, pv));
      return { id: `entrance-${pv}`, label: `${pv}：entrance block（PV 口を一周する病変で隔離）`, ok: separated(engine.mesh, viab, body, targets) };
    });
    checks.push({ id: 'exit-block', label: '全 PV：exit block（PV 内を刺激しても LA に伝わらない）', ok: exitBlock(engine) });
    return checks;
  },
  goals: [
    '環状カテーテルで PV 電位を記録する',
    'PV 口周囲に連続した病変で隔離する',
    '隔離後に PV 内ペーシングで exit block を確認する',
  ],
};

/** 各 PV のスリーブ先端を刺激し、LA 本体が興奮しないこと（複製したエンジンで確かめる） */
function exitBlock(engine: SimulationEngine): boolean {
  const body = laBody(engine);
  for (const pv of PV_NAMES) {
    const c = cloneWithSubstrate(engine, afScenario);
    c.sinusEnabled = false;
    c.foci = [];
    c.ca.stimulate(sleeveTip(c, pv));
    c.tick(300);
    if (body.some((v) => c.ca.tissue.lastActivation[v] >= 0)) return false;
  }
  return true;
}

