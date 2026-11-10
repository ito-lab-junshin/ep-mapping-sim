import { AH_MS, HV_MS, VENTRICLE_ERP_MS } from '../params';

/**
 * 房室伝導と心室の 1 コンパートメント（docs/DESIGN.md §5.5 の最小版）。
 * 心房波が房室結節部位に届いた時刻 tA から、H = tA + AH、V = H + HV を出す。
 * 心室の ERP 内に V が来る場合は伝導しない（房室ブロック）。
 * Phase 4 で 2 経路（AVNRT）・副伝導路（WPW）に拡張する。
 */
export interface AvParams { ahMs: number; hvMs: number; ventricleErpMs: number }

const KEEP = 8;

export class AvConduction {
  readonly params: AvParams;
  /** 房室結節部位の心房興奮時刻（伝導しなかったものも含む） */
  aTimes: number[] = [];
  hTimes: number[] = [];
  /** 心室興奮（QRS 開始）時刻 */
  vTimes: number[] = [];

  constructor(params?: Partial<AvParams>) {
    this.params = { ahMs: AH_MS, hvMs: HV_MS, ventricleErpMs: VENTRICLE_ERP_MS, ...params };
  }

  /** 心房波の到達を知らせる。伝導したら true */
  atrialArrival(tA: number): boolean {
    push(this.aTimes, tA);
    const h = tA + this.params.ahMs;
    const v = h + this.params.hvMs;
    const lastV = this.vTimes[this.vTimes.length - 1];
    if (lastV !== undefined && v - lastV < this.params.ventricleErpMs) return false;
    push(this.hTimes, h);
    push(this.vTimes, v);
    return true;
  }

  /** now 以前で windowMs 以内のイベント（未来の予定は含まない） */
  static recent(times: number[], now: number, windowMs: number): number[] {
    return times.filter((t) => t <= now && now - t <= windowMs);
  }

  reset() { this.aTimes = []; this.hTimes = []; this.vTimes = []; }
}

function push(a: number[], x: number) {
  a.push(x);
  if (a.length > KEEP) a.shift();
}
