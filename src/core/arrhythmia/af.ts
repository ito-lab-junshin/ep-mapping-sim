import type { ArrhythmiaScenario, CaseOptions, CureCheck, GoalContext } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { PV_NAMES, type PvName } from '../geometry/regions';
import { seededRandom } from '../pacing/Stimulator';
import { AF_SUBSTRATE, AF_TYPE_IDS, type AfType } from '../params';
import { raBody, svcIsolated, svcTip, svcVertices } from './svc';
import { applyPersistentSubstrate, distanceFromRoofCenter, roofAreaIsolated, roofDriverActive, seedRoofRotor } from './persistent';
import { cloneWithSubstrate, reconnectionGoal, separated } from './common';
import { circularPv, recentlyActivated } from '../learning/conditions';

export { sleeveVertices, sleeveTip, laBody, isolatedPvs } from './pv';
import { sleeveVertices, sleeveTip, laBody, isolatedPvs, pvGapHints } from './pv';

export function afTypeOf(options?: CaseOptions): AfType {
  const t = options?.afType;
  return t && AF_TYPE_IDS.includes(t) ? t : 'pv';
}
/** AF の型の表示名 */
export const AF_TYPE_LABEL: Record<AfType, string> = {
  pv: '発作性（PV トリガー）',
  pvSvc: '発作性（PV と SVC のトリガー）',
  persistent: '持続性（天蓋の低電位領域）',
};
const hasSvcTrigger = (engine: SimulationEngine) => afTypeOf(engine.caseOptions) === 'pvSvc';
const isPersistent = (engine: SimulationEngine) => afTypeOf(engine.caseOptions) === 'persistent';
/** 持続性の型のゴールか */
const persistentGoal = ({ engine }: GoalContext) => isPersistent(engine);
/** 天蓋の旋回が止まった（channel を横切る通電、または領域の隔離） */
const roofDriverStopped = (engine: SimulationEngine) => roofAreaIsolated(engine) || !roofDriverActive(engine, afScenario);
/** SVC のトリガーがある型のゴールか */
const svcGoal = ({ engine }: GoalContext) => hasSvcTrigger(engine);


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
  setupSubstrate(engine, options) {
    const type = afTypeOf(options);
    engine.caseOptions = { ...engine.caseOptions, ...options, afType: type };
    const t = engine.ca.tissue;
    const n = t.erp.length;
    // ERP の斑状のばらつき：乱数をメッシュ上でなめらかにし、範囲 160〜200 ms に伸ばす
    // （持続性の型は 150〜240 ms・なめらかさ弱め：規則的な旋回に 1:1 で追従できない所をつくる）
    const persistent = type === 'persistent';
    const rng = seededRandom(20261111);
    let e = Float32Array.from({ length: n }, () => rng());
    const smoothing = persistent ? AF_SUBSTRATE.persistent.erpSmoothingIterations : AF_SUBSTRATE.erpSmoothingIterations;
    for (let it = 0; it < smoothing; it++) {
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
    const [eMin, eMax] = persistent ? AF_SUBSTRATE.persistent.atrialErpMs : AF_SUBSTRATE.atrialErpMs;
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
    // 非 PV トリガー（AF-2）：SVC の心筋スリーブの先端
    if (type === 'pvSvc') {
      for (const v of svcVertices(engine)) {
        t.conductionVelocity[v] = AF_SUBSTRATE.svcSleeveCv;
        t.erp[v] = AF_SUBSTRATE.svcSleeveErpMs;
      }
      engine.addFocus(svcTip(engine), AF_SUBSTRATE.svcTriggerClMs[0], AF_SUBSTRATE.svcTriggerClMs[1], 201);
    }
    // 持続性 AF（AF-3）：天蓋の低電位領域に固定した旋回。少し進めてから旋回を始める（症例は AF が続いた状態で始まる）
    if (persistent) {
      const s = applyPersistentSubstrate(engine);
      engine.tick(AF_SUBSTRATE.persistent.seedAtMs);
      seedRoofRotor(engine, s);
    }
  },
  structuralChecks(engine) {
    const viab = engine.ca.tissue.viability;
    const body = laBody(engine);
    const checks: CureCheck[] = PV_NAMES.map((pv) => {
      const targets = new Set(sleeveVertices(engine, pv));
      return { id: `entrance-${pv}`, label: `${pv}：entrance block（PV 口を一周する病変で隔離）`, ok: separated(engine.mesh, viab, body, targets) };
    });
    checks.push({ id: 'exit-block', label: '全 PV：exit block（PV 内を刺激しても LA に伝わらない）', ok: exitBlock(engine) });
    if (isPersistent(engine)) {
      checks.push({
        id: 'roof-driver', label: '天蓋の低電位領域の旋回が止まる（channel を横切る通電、または領域の隔離）',
        ok: roofAreaIsolated(engine) || !roofDriverActive(engine, afScenario),
      });
    }
    if (hasSvcTrigger(engine)) {
      checks.push({ id: 'entrance-SVC', label: 'SVC：entrance block（SVC–RA 接合部を一周する病変で隔離）', ok: svcIsolated(engine) });
      checks.push({ id: 'exit-block-SVC', label: 'SVC：exit block（SVC 内を刺激しても RA に伝わらない）', ok: svcExitBlock(engine) });
    }
    return checks;
  },
  energies: ['rf', 'cryo', 'pfa'],
  gapHints: pvGapHints,
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
    // ── AF の型 persistent（AF-3：持続性 AF）だけのゴール ──
    {
      id: 'lva-map', label: 'ボルテージマップで天蓋の低電位領域（0.5 mV 未満）を見つける',
      hint: '多極カテーテルか ABL で LA 全体の点を取り、表示をボルテージにする。天蓋に 0.5 mV 未満の点を 5 点以上取る（中心は 0.1 mV 未満の瘢痕）',
      applies: persistentGoal,
      achieved: ({ engine, points }) => points.filter((p) => p.voltageMv < 0.5 && distanceFromRoofCenter(engine, p.position) <= 16).length >= 5,
    },
    {
      id: 'roof-driver', label: 'PVI の後も続く AF で、天蓋の低電位領域の旋回を通電で止める（channel を横切る、または領域を隔離する）',
      hint: '中心の瘢痕と周りの線維化の輪のあいだの、遅い伝導の輪（channel）が旋回の道。瘢痕の縁から線維化の輪まで、channel を横切るように焼く',
      applies: persistentGoal,
      achieved: ({ engine }) => isolatedPvs(engine).length === PV_NAMES.length && engine.lesions.length > 0 && roofDriverStopped(engine),
    },
    {
      id: 'persistent-af-stopped', label: 'AF が止まり、洞調律に戻ったことを確認する',
      hint: 'PVI と天蓋の旋回の通電が終わると、PV のトリガーは隔離された PV の中だけで発火する',
      applies: persistentGoal,
      achieved: ({ engine }) => isolatedPvs(engine).length === PV_NAMES.length && engine.rhythm.state !== 'tachycardia' && engine.rhythm.state !== 'pacing'
        && roofDriverStopped(engine),
    },
    // ── AF の型 pvSvc（AF-2：非 PV トリガー）だけのゴール ──
    {
      id: 'svc-potential', label: 'PVI の後も続く AF で、環状カテーテルを SVC に置き、SVC 電位（速く不規則な興奮）を記録する',
      hint: '4 本の PV を隔離しても AF が止まらなければ、PV 以外のトリガーを探す。環状カテーテルを SVC の中（SVC–RA 接合部より上）に置き、3 極以上を壁に接触させる',
      applies: svcGoal,
      achieved: ({ engine }) => {
        if (isolatedPvs(engine).length !== PV_NAMES.length) return false;
        const v = circularSvcContacts(engine);
        return v.length >= 3 && recentlyActivated(engine, v, 1500) >= 3;
      },
    },
    {
      id: 'svc-isolation', label: 'SVC–RA 接合部を一周する病変で SVC を隔離する（洞結節・横隔神経に注意）',
      hint: '接合部より少し上（SVC 側）を一周する。前外側の洞結節の近くと、後外側の右横隔神経の走行に近い通電では注意が出る',
      applies: svcGoal,
      achieved: ({ engine }) => svcIsolated(engine),
    },
    {
      id: 'af-stopped', label: 'AF が止まり、洞調律に戻ったことを確認する',
      hint: 'PV と SVC の隔離が終わると、トリガーは隔離された静脈の中だけで発火する（解離）',
      applies: svcGoal,
      achieved: ({ engine }) => svcIsolated(engine) && isolatedPvs(engine).length === PV_NAMES.length
        && engine.rhythm.state !== 'tachycardia' && engine.rhythm.state !== 'pacing',
    },
    reconnectionGoal(() => afScenario),
  ],
};

/** SVC のスリーブ先端を刺激し、RA 本体が興奮しないこと（複製したエンジンで確かめる） */
function svcExitBlock(engine: SimulationEngine): boolean {
  const c = cloneWithSubstrate(engine, afScenario);
  c.sinusEnabled = false;
  c.foci = [];
  c.ca.reset();
  c.ca.stimulate(svcTip(c));
  c.tick(300);
  return !raBody(c).some((v) => c.ca.tissue.lastActivation[v] >= 0);
}

/** 環状カテーテルの電極のうち、SVC のスリーブに接触している頂点 */
export function circularSvcContacts(engine: SimulationEngine): number[] {
  const c = engine.catheter('circ');
  if (!c?.placed) return [];
  const svc = new Set(svcVertices(engine));
  return c.electrodes.map((e) => e.contactVertex).filter((v) => v >= 0 && svc.has(v));
}


/** 各 PV のスリーブ先端を刺激し、LA 本体が興奮しないこと（複製したエンジンで確かめる） */
function exitBlock(engine: SimulationEngine): boolean {
  const body = laBody(engine);
  for (const pv of PV_NAMES) {
    const c = cloneWithSubstrate(engine, afScenario);
    c.sinusEnabled = false;
    c.foci = [];
    c.ca.reset(); // 持続性の型の天蓋の旋回など、複製で始め直した興奮を消してから刺激する
    c.ca.stimulate(sleeveTip(c, pv));
    c.tick(300);
    if (body.some((v) => c.ca.tissue.lastActivation[v] >= 0)) return false;
  }
  return true;
}

