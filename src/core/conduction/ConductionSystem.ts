import { ACCESSORY_PATHWAY, HIS_ERP_MS, HV_MS, VENTRICLE_ERP_MS } from '../params';
import { antegradeTime, fastPathway, type PathwayState } from './AvNode';

/** 心室の興奮（QRS 開始）の記録 */
export interface VentricularBeat {
  time: number;
  source: 'his' | 'ap' | 'pace';
  /** 副伝導路から先に興奮した拍で、His 経由の興奮が後から届いた時刻（融合の程度 = これ − time） */
  hisArrival?: number;
}

/** 心房側への出口（逆行伝導・副伝導路の逆行）：時刻 time に頂点 vertex を興奮させる */
export interface AtrialExit { time: number; vertex: number; via: 'fast' | 'slow' | 'ap' }

export interface AccessoryPathwayState {
  /** 心房付着部の頂点（僧帽弁輪上の 1〜3 頂点） */
  vertices: number[];
  last: number;
  conductionMs: number;
  antegradeErpMs: number;
  retrogradeErpMs: number;
  ventricularDelayMs: number;
}

type Event =
  | { time: number; kind: 'common'; pathway: number }
  | { time: number; kind: 'ventricle'; source: VentricularBeat['source'] }
  | { time: number; kind: 'apRetro' };

const KEEP = 16;

/**
 * 刺激伝導系（docs/DESIGN.md §5.5）：房室結節の経路 → 共通路 → His → 心室（1 コンパートメント）と副伝導路。
 * 心房メッシュとはイベントでつながる：
 *  - 心房の入口頂点が興奮したら atrialArrival()
 *  - 心房側への出口（逆行伝導）は takeExits() で取り出し、エンジンがメッシュの頂点を興奮させる
 * 時刻はすべてシミュレーション時刻 ms。
 */
export class ConductionSystem {
  pathways: PathwayState[];
  ap: AccessoryPathwayState | null = null;
  hvMs = HV_MS;
  hisErpMs = HIS_ERP_MS;
  ventricleErpMs = VENTRICLE_ERP_MS;
  /** 房室伝導を止める（テスト・教育用） */
  blocked = false;

  lastH = -Infinity;
  lastV = -Infinity;
  /** 入口頂点の心房興奮時刻（伝導しなかったものも含む） */
  aTimes: number[] = [];
  hTimes: number[] = [];
  vBeats: VentricularBeat[] = [];
  private queue: Event[] = [];
  private exits: AtrialExit[] = [];
  /** 心房への出口の記録（エコー・副伝導路の逆行の判定用） */
  exitLog: AtrialExit[] = [];

  constructor(fastVertex: number) {
    this.pathways = [fastPathway(fastVertex)];
  }

  get vTimes(): number[] { return this.vBeats.map((b) => b.time); }

  /** 副伝導路を置く（null で取り除く） */
  setAccessoryPathway(vertices: number[] | null) {
    this.ap = vertices && vertices.length ? {
      vertices, last: -Infinity, conductionMs: ACCESSORY_PATHWAY.conductionMs,
      antegradeErpMs: ACCESSORY_PATHWAY.antegradeErpMs, retrogradeErpMs: ACCESSORY_PATHWAY.retrogradeErpMs,
      ventricularDelayMs: ACCESSORY_PATHWAY.ventricularDelayMs,
    } : null;
  }

  /** 経路 k の入口頂点に心房の興奮が届いた */
  atrialArrival(k: number, t: number) {
    const p = this.pathways[k];
    if (k === 0) push(this.aTimes, t);
    if (this.blocked) return;
    const ah = antegradeTime(p.params, t - p.last);
    if (ah === null) return; // 不応期でブロック
    p.last = t;
    this.schedule({ time: t + ah, kind: 'common', pathway: k });
  }

  /** 副伝導路の心房付着部に興奮が届いた（順行） */
  apAtrialArrival(t: number) {
    const ap = this.ap;
    if (!ap || t - ap.last < ap.antegradeErpMs) return;
    ap.last = t;
    this.schedule({ time: t + ap.conductionMs, kind: 'ventricle', source: 'ap' });
  }

  /**
   * 接合部の興奮（遅伝導路の通電中の接合部調律など）：共通路から His → 心室へ伝わり、
   * 逆行できる経路（速伝導路）を通って心房へも戻る
   */
  junctionalBeat(t: number) {
    this.schedule({ time: t, kind: 'common', pathway: -1 });
  }

  /** 心室刺激（RV ペーシング） */
  paceVentricle(t: number) {
    this.schedule({ time: t, kind: 'ventricle', source: 'pace' });
  }

  /** 時刻 until までのイベントを処理する */
  advance(until: number) {
    while (this.queue.length && this.queue[0].time <= until) {
      const e = this.queue.shift()!;
      if (e.kind === 'common') this.onCommon(e.time, e.pathway);
      else if (e.kind === 'ventricle') this.onVentricle(e.time, e.source);
      else this.onApRetro(e.time);
    }
  }

  /** 心房側への出口（時刻 until まで）を取り出す */
  takeExits(until: number): AtrialExit[] {
    const out = this.exits.filter((x) => x.time <= until);
    this.exits = this.exits.filter((x) => x.time > until);
    return out;
  }

  private onCommon(t: number, k: number) {
    // His の不応期なら共通路でブロック（遅れて届いたもう一方の経路の興奮は不顕性伝導）
    if (t - this.lastH < this.hisErpMs) return;
    this.lastH = t;
    push(this.hTimes, t);
    this.schedule({ time: t + this.hvMs, kind: 'ventricle', source: 'his' });
    // 共通路から、いま通らなかった経路を逆行して心房へ（エコー）
    this.pathways.forEach((p, j) => {
      if (j === k || p.params.retroMs === undefined) return;
      if (t - p.last < (p.params.retroErpMs ?? p.params.erpMs)) return;
      p.last = t;
      this.addExit({ time: t + p.params.retroMs, vertex: p.vertex, via: p.params.name });
    });
  }

  private onVentricle(t: number, source: VentricularBeat['source']) {
    if (t - this.lastV < this.ventricleErpMs) {
      // 副伝導路で先に興奮した拍に、His 経由の興奮が後から届いた（融合）
      const last = this.vBeats[this.vBeats.length - 1];
      if (source === 'his' && last && last.source === 'ap' && last.hisArrival === undefined) last.hisArrival = t;
      return;
    }
    this.lastV = t;
    this.vBeats.push({ time: t, source });
    if (this.vBeats.length > KEEP) this.vBeats.shift();
    // 副伝導路を逆行して心房へ（副伝導路自身が起こした興奮は不応期で戻らない）
    const ap = this.ap;
    if (ap) {
      const reach = t + (source === 'ap' ? 0 : ap.ventricularDelayMs);
      this.schedule({ time: reach, kind: 'apRetro' });
    }
  }

  private onApRetro(t: number) {
    const ap = this.ap;
    if (!ap || t - ap.last < ap.retrogradeErpMs) return;
    ap.last = t;
    for (const v of ap.vertices) this.addExit({ time: t + ap.conductionMs, vertex: v, via: 'ap' });
  }

  private addExit(x: AtrialExit) {
    this.exits.push(x);
    this.exitLog.push(x);
    if (this.exitLog.length > KEEP) this.exitLog.shift();
  }

  private schedule(e: Event) {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].time > e.time) i--;
    this.queue.splice(i, 0, e);
  }

  /** now 以前で windowMs 以内の時刻 */
  static recent(times: number[], now: number, windowMs: number): number[] {
    return times.filter((t) => t <= now && now - t <= windowMs);
  }

  reset() {
    for (const p of this.pathways) p.last = -Infinity;
    if (this.ap) this.ap.last = -Infinity;
    this.lastH = this.lastV = -Infinity;
    this.aTimes = []; this.hTimes = []; this.vBeats = [];
    this.queue = []; this.exits = []; this.exitLog = [];
  }
}

function push(a: number[], x: number) {
  a.push(x);
  if (a.length > KEEP) a.shift();
}
