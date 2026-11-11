import type { ArrhythmiaScenario, CureCheck } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES, type PvName } from '../geometry/regions';
import { seededRandom } from '../pacing/Stimulator';
import { AF_SUBSTRATE } from '../params';
import { cloneWithSubstrate, separated } from './common';
import { circularPv, recentlyActivated } from '../learning/conditions';

export { sleeveVertices, sleeveTip, laBody, isolatedPvs } from './pv';
import { sleeveVertices, sleeveTip, laBody, isolatedPvs } from './pv';

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
  energies: ['rf', 'cryo', 'pfa'],
  goals: [
    {
      id: 'pv-potential', label: '環状カテーテルで PV 電位を記録する',
      hint: '環状カテーテルを PV の中（口から少し奥）に置き、3 極以上を壁に接触させる',
      achieved: ({ engine }) => {
        const pv = circularPv(engine);
        if (!pv) return false;
        const v = engine.catheter('circ')!.electrodes.map((e) => e.contactVertex).filter((x) => x >= 0);
        return recentlyActivated(engine, v, 1500) >= 3;
      },
    },
    {
      id: 'isolation', label: 'PV 口周囲に連続した病変で 4 本の PV を隔離する',
      hint: 'PV 口の前庭部を隙間なく一周するように通電する（点の間隔 約 5 mm 以内）',
      achieved: ({ engine }) => isolatedPvs(engine).length === PV_NAMES.length,
      progress: ({ engine }) => `${isolatedPvs(engine).length}/${PV_NAMES.length} 本`,
    },
    {
      id: 'entrance', label: '4 本すべての PV に環状カテーテルを置き、PV 電位の消失または解離（entrance block）を確認する',
      hint: '隔離した PV に環状カテーテルを置く。トリガーのある PV（LSPV・RSPV）では、LA と無関係なリズムで PV 電位が出続ける（解離）',
      // 環状カテーテルが入っている PV が隔離されていれば、その PV を確認済みにする（1 本ずつ）
      items: ({ engine }) => {
        const pv = circularPv(engine);
        const iso = pv ? isolatedPvs(engine).includes(pv) : false;
        return PV_NAMES.map((p) => ({ id: p, label: p, ok: iso && pv === p }));
      },
    },
    {
      id: 'exit-block', label: '隔離後に PV 内ペーシング（環状カテーテル）で exit block を確認する',
      hint: '隔離した PV に環状カテーテルを置き、刺激部位「環状（1-2）」で刺激する。PV 内は捕捉されるが LA には伝わらない',
      // 刺激したときに、環状カテーテルが接触していた PV がすでに隔離されていたこと
      achieved: ({ events }) => events.some((e) => e.kind === 'protocol' && e.site === 'CIRC' && e.contact && e.circPvIsolated),
    },
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

