import type { ArrhythmiaScenario } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { cloneWithSubstrate } from '../arrhythmia/common';

/** para-Hisian 刺激の 1 つの出力の結果 */
export interface ParaHisianBeat {
  /** 刺激から HRA（高位右房）の心房興奮まで ms（逆行がなければ null） */
  saHraMs: number | null;
  /** 刺激から His 部位の心房興奮まで ms */
  saHisMs: number | null;
  /** 刺激から CS 遠位（CS 1-2）の心房興奮まで ms（左側の副伝導路は、中隔より側方で先に興奮する） */
  saCsDistMs: number | null;
  /** 心房への逆行の出口（最初の出口）：房室結節（速伝導路）か副伝導路か */
  route: 'node' | 'ap' | null;
  /** QRS の形：His を捕捉した狭い QRS か、心室だけの広い QRS か */
  qrs: 'narrow' | 'wide';
}

export interface ParaHisianResult {
  high: ParaHisianBeat;
  low: ParaHisianBeat;
  /** 低出力 − 高出力の S-A の差（HRA）ms */
  deltaHraMs: number | null;
}

/**
 * 洞調律を止めて 1 発だけ刺激し、その後の最初の心房興奮を測る（仮定値）。続けて刺激すると、AVNRT の症例では
 * 逆行（速伝導路）→ 遅伝導路の順行でエコー・AVNRT が始まり、次の刺激の S-A が頻拍の興奮と混ざった
 */
const PACE_BEATS = 1;
const PACE_CL_MS = 600;
const OBSERVE_MS = 400;

/**
 * para-Hisian 刺激（4-A、docs/DESIGN.md §5.6）：同じ症例・病変の複製で、高出力（His＋心室）と低出力（心室だけ）の
 * 刺激をそれぞれ行い、最後の刺激から HRA・His 部位の心房興奮までの時間（S-A）と逆行の出口を測る。
 * 房室結節を逆行するなら低出力で S-A が延び、副伝導路を逆行するなら変わらない（判定は学習者に任せる）
 */
export function paraHisianResponse(engine: SimulationEngine, scenario: ArrhythmiaScenario): ParaHisianResult {
  const one = (output: 'high' | 'low'): ParaHisianBeat => {
    const c = cloneWithSubstrate(engine, scenario);
    c.sinusEnabled = false;
    c.foci = [];
    c.tick(300);
    const t0 = c.time + 50;
    const times = Array.from({ length: PACE_BEATS }, (_, i) => t0 + i * PACE_CL_MS);
    c.pace(output === 'high' ? 'PARA_HIS_HIGH' : 'PARA_HIS_LOW', times);
    const last = times[times.length - 1];
    c.tick(last - c.time);
    const la = c.ca.tissue.lastActivation;
    const hra = c.catheter('hra')?.placed ? c.query.closestPoint(c.catheter('hra')!.electrodes[0].position).vertex : c.model.anatomy.anchors.sinusNode.vertex;
    const his = c.model.anatomy.anchors.his.vertex;
    const csDist = c.catheter('cs')?.placed ? c.query.closestPoint(c.catheter('cs')!.electrodes[0].position).vertex : c.model.anatomy.anchors.csOs.vertex;
    // 最後の刺激の後で最初に興奮した時刻（後のエコーなどで上書きされる前に記録する）
    const first = new Map<number, number>();
    for (let t = 0; t < OBSERVE_MS; t += 2) {
      c.tick(2);
      for (const v of [hra, his, csDist]) if (!first.has(v) && la[v] >= last) first.set(v, la[v]);
    }
    const sa = (v: number) => (first.has(v) ? Math.round(first.get(v)! - last) : null);
    const exit = c.conduction.exitLog.filter((x) => x.time >= last).sort((a, b) => a.time - b.time)[0];
    const beat = c.conduction.vBeats.filter((b) => b.time >= last)[0];
    return {
      saHraMs: sa(hra), saHisMs: sa(his), saCsDistMs: sa(csDist),
      route: exit ? (exit.via === 'ap' ? 'ap' : 'node') : null,
      qrs: beat?.source === 'his' ? 'narrow' : 'wide',
    };
  };
  const high = one('high'), low = one('low');
  return { high, low, deltaHraMs: high.saHraMs !== null && low.saHraMs !== null ? low.saHraMs - high.saHraMs : null };
}

export { PARA_HISIAN_QUESTION, retrogradeRoute, paraHisianGoal } from './paraHisianGoal';
