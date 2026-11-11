import { ABLATION, ACCESSORY_PATHWAY, AF_SUBSTRATE, AFL_SUBSTRATE, AV_NODE, CONDUCTION, PROTOCOL, RHYTHM } from '../params';

/**
 * 研究用の拡張口（Phase 7、docs/DESIGN.md §4.3）：パラメータの上書き。
 * キーは「グループ名.項目」（例："CONDUCTION.atrialCv"、"AFL_SUBSTRATE.raCv"、"ABLATION.rf.dose.powerExp"、
 * "AV_NODE.slow.erpMs"）。値は数値か数値の配列。エンジンは作るときにパラメータを読むので、
 * 上書きしてからエンジンを作り、終わったら元に戻す（withParams）。
 */
export type ParamValue = number | readonly number[];
export type ParamOverrides = Record<string, ParamValue>;

/** 上書きできるパラメータのグループ（src/core/params.ts の値そのもの） */
export const PARAM_GROUPS: Record<string, object> = {
  CONDUCTION, AV_NODE, ACCESSORY_PATHWAY, AF_SUBSTRATE, AFL_SUBSTRATE, ABLATION, PROTOCOL, RHYTHM,
};

type Obj = Record<string, unknown>;

function resolve(key: string): { obj: Obj; leaf: string } {
  const [group, ...path] = key.split('.');
  let obj = PARAM_GROUPS[group] as Obj | undefined;
  if (!obj || !path.length) throw new Error(`未知のパラメータ：${key}`);
  for (const p of path.slice(0, -1)) {
    const next = obj[p];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) throw new Error(`未知のパラメータ：${key}`);
    obj = next as Obj;
  }
  const leaf = path[path.length - 1];
  const cur = obj[leaf];
  if (!(leaf in obj) || !(typeof cur === 'number' || Array.isArray(cur))) throw new Error(`数値でないパラメータ：${key}`);
  return { obj, leaf };
}

export function getParam(key: string): ParamValue {
  const { obj, leaf } = resolve(key);
  const v = obj[leaf];
  return Array.isArray(v) ? [...v] : (v as number);
}

/** 上書きする（元の値を返す）。型（数値／配列の長さ）が合わなければエラー */
export function setParams(overrides: ParamOverrides): ParamOverrides {
  const before: ParamOverrides = {};
  for (const [key, value] of Object.entries(overrides)) {
    const { obj, leaf } = resolve(key);
    const cur = obj[leaf];
    if (Array.isArray(cur) !== Array.isArray(value) || (Array.isArray(cur) && cur.length !== (value as readonly number[]).length)) {
      throw new Error(`パラメータの型が合いません：${key}`);
    }
    before[key] = Array.isArray(cur) ? [...cur] : (cur as number);
    obj[leaf] = Array.isArray(value) ? [...value] : value;
  }
  return before;
}

/** 上書きして fn を実行し、元に戻す */
export function withParams<T>(overrides: ParamOverrides, fn: () => T): T {
  const before = setParams(overrides);
  try { return fn(); } finally { setParams(before); }
}

/** すべての上書きできるパラメータの現在の値（書き出し用） */
export function snapshotParams(): ParamOverrides {
  const out: ParamOverrides = {};
  const walk = (prefix: string, o: Obj) => {
    for (const [k, v] of Object.entries(o)) {
      const key = `${prefix}.${k}`;
      if (typeof v === 'number') out[key] = v;
      else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) out[key] = [...v];
      else if (typeof v === 'object' && v !== null && !Array.isArray(v)) walk(key, v as Obj);
    }
  };
  for (const [g, o] of Object.entries(PARAM_GROUPS)) walk(g, o as Obj);
  return out;
}
