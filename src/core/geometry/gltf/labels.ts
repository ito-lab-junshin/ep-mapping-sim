import { REGIONS, type RegionName } from '../regions';
import type { InterAtrialBridge, Vec3 } from '../../types';

/** 解剖の目印の名前（BiatrialAnatomy.anchors） */
export type AnchorName = 'sinusNode' | 'avNode' | 'his' | 'slowPathway' | 'csOs' | 'ctiIvc' | 'ctiTv';

/**
 * 領域ラベルの JSON（glTF の頂点に解剖の領域名を付ける。docs/DESIGN.md §9.1、Phase 7）。
 * 頂点の index は、glTF の POSITION を文書の順（メッシュ → プリミティブ）につないだ通し番号。
 * regions は全頂点の配列でも、{ "index": "領域名" } の一部だけでもよい（一部だけのときは半自動推定を上書きする）。
 * anchors・lines・bridges は省略でき、省略すると領域ラベルから求める（アプリが書き出すときは全部入れる）。
 */
export interface LabelFile {
  format: 'ep-mapping-sim/labels';
  version: 1;
  /** glTF の座標の単位（省略すると大きさから推定：全体の差し渡しが 2 未満ならメートル） */
  unit?: 'm' | 'mm';
  /** 心房ごとのメッシュ名（省略すると "LA"・"RA" の名前、なければ形から判定） */
  chambers?: { LA?: string[]; RA?: string[] };
  regions?: RegionName[] | Record<string, RegionName>;
  anchors?: Partial<Record<AnchorName, number>>;
  lines?: { crista?: Vec3[]; eustachian?: Vec3[] };
  bridges?: { name: InterAtrialBridge['name']; pairs: [number, number][] }[];
}

export function isLabelFile(x: unknown): x is LabelFile {
  const l = x as LabelFile;
  return !!l && l.format === 'ep-mapping-sim/labels' && l.version === 1;
}

/** 領域名の確認（知らない名前はエラー） */
export function regionIdOf(name: string): number {
  const i = (REGIONS as readonly string[]).indexOf(name);
  if (i < 0) throw new Error(`知らない領域名：${name}`);
  return i;
}

/** ラベル JSON の regions を「頂点 → 領域 id（未指定は -1）」にする */
export function regionOverrides(file: LabelFile | undefined, vertexCount: number): Int16Array {
  const out = new Int16Array(vertexCount).fill(-1);
  const r = file?.regions;
  if (!r) return out;
  if (Array.isArray(r)) {
    if (r.length !== vertexCount) throw new Error(`regions の数（${r.length}）が頂点の数（${vertexCount}）と合いません`);
    r.forEach((name, v) => { out[v] = regionIdOf(name); });
  } else {
    for (const [k, name] of Object.entries(r)) {
      const v = Number(k);
      if (!Number.isInteger(v) || v < 0 || v >= vertexCount) throw new Error(`頂点の index が範囲外：${k}`);
      out[v] = regionIdOf(name);
    }
  }
  return out;
}
