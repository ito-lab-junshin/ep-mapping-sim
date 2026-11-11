import type { BiatrialModel } from '../parametric/atria';
import { REGIONS, type RegionName } from '../regions';
import { parseGltf, writeGlb } from './gltf';
import { regionOverrides, type AnchorName, type LabelFile } from './labels';
import { components, boundaryLoops, pca } from './meshTopology';
import { estimateRegions } from './estimate';
import { deriveModel } from './derive';

/**
 * glTF ローダ（docs/DESIGN.md §9.1、Phase 7）。glTF の三角形メッシュと、領域ラベルの JSON（頂点 index → 領域名）から
 * BiatrialModel を作る。ラベルがない、または一部だけのときは、形から半自動で推定し（estimate.ts）、JSON の指定で上書きする。
 *  1. glTF のプリミティブを文書の順につなぐ（ラベルの頂点 index はこの通し番号）
 *  2. 同じ位置の頂点を溶接する（継ぎ目の重複をなくす）
 *  3. LA と RA に分ける：ラベル JSON の chambers → メッシュ名（LA／RA）→ 開口の数（LA 5・RA 4）→ 左右の位置
 *  4. 領域：JSON の全頂点指定 > 半自動推定＋JSON の部分指定
 *  5. 解剖の目印・開口・連結を求める（derive.ts）
 */
export interface GltfLoadResult {
  model: BiatrialModel;
  /** 領域を推定したか（JSON で全頂点が与えられていれば false） */
  estimated: boolean;
  /** 読み込んだメッシュの頂点 → glTF の通し番号（溶接で代表になった頂点） */
  sourceIndexOf: Int32Array;
}

export function loadGltfModel(data: ArrayBuffer | Uint8Array | string, labels?: LabelFile, opts: { name?: string; resources?: Record<string, Uint8Array> } = {}): GltfLoadResult {
  const prims = parseGltf(data, opts.resources);
  if (!prims.length) throw new Error('glTF に三角形メッシュがありません');
  // 1. つなぐ
  const total = prims.reduce((s, p) => s + p.positions.length / 3, 0);
  const pos = new Float32Array(total * 3);
  const primOf = new Int32Array(total);
  const tris: number[] = [];
  let off = 0;
  prims.forEach((p, pi) => {
    pos.set(p.positions, off * 3);
    primOf.fill(pi, off, off + p.positions.length / 3);
    for (const i of p.indices) tris.push(i + off);
    off += p.positions.length / 3;
  });
  // 単位：メートルなら mm に
  let lo = Infinity, hi = -Infinity;
  for (const x of pos) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  const unit = labels?.unit ?? (hi - lo < 2 ? 'm' : 'mm');
  if (unit === 'm') for (let i = 0; i < pos.length; i++) pos[i] *= 1000;

  // 2. 溶接（0.001 mm）
  const remap = new Int32Array(total);
  const firstOf: number[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const k = `${Math.round(pos[3 * i] * 1000)},${Math.round(pos[3 * i + 1] * 1000)},${Math.round(pos[3 * i + 2] * 1000)}`;
    const f = seen.get(k);
    if (f !== undefined) { remap[i] = f; continue; }
    remap[i] = firstOf.length; seen.set(k, firstOf.length); firstOf.push(i);
  }
  const nw = firstOf.length;
  const wTris: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = remap[tris[t]], b = remap[tris[t + 1]], c = remap[tris[t + 2]];
    if (a !== b && b !== c && a !== c) wTris.push(a, b, c);
  }
  const wPos = new Float32Array(nw * 3);
  firstOf.forEach((src, w) => wPos.set(pos.subarray(3 * src, 3 * src + 3), 3 * w));

  // 3. LA と RA
  const chamberOf = new Int8Array(nw).fill(-1); // 0 = LA, 1 = RA
  const byName = (pi: number): number => {
    const nm = prims[pi].name;
    if (labels?.chambers?.LA?.includes(nm)) return 0;
    if (labels?.chambers?.RA?.includes(nm)) return 1;
    if (/^(la|left[ _-]?atrium)\b/i.test(nm)) return 0;
    if (/^(ra|right[ _-]?atrium)\b/i.test(nm)) return 1;
    return -1;
  };
  firstOf.forEach((src, w) => { chamberOf[w] = byName(primOf[src]); });
  if (chamberOf.some((c) => c < 0)) {
    const { comp, count } = components(wTris, nw);
    const size = new Array(count).fill(0);
    comp.forEach((c) => size[c]++);
    const big = size.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => x[1]);
    if (big.length < 2) throw new Error('LA と RA の 2 つの心房に分けられません（メッシュ名を LA・RA にするか、ラベル JSON の chambers で指定してください）');
    const loopsOf = (ci: number) => boundaryLoops(wTris.filter((_, i) => comp[wTris[i - (i % 3)]] === ci), nw).length;
    const cx = (ci: number) => pca(Array.from({ length: nw }, (_, v) => v).filter((v) => comp[v] === ci).map((v) => ({ x: wPos[3 * v], y: wPos[3 * v + 1], z: wPos[3 * v + 2] }))).center.x;
    const [a, b] = big;
    const la = loopsOf(a) === 5 && loopsOf(b) === 4 ? a : loopsOf(b) === 5 && loopsOf(a) === 4 ? b : cx(a) > cx(b) ? a : b;
    for (let v = 0; v < nw; v++) if (chamberOf[v] < 0) chamberOf[v] = comp[v] === la ? 0 : comp[v] === (la === a ? b : a) ? 1 : -1;
  }
  // 並べ替え：LA → RA（どちらでもない頂点は捨てる）
  const order = [...Array.from({ length: nw }, (_, v) => v).filter((v) => chamberOf[v] === 0), ...Array.from({ length: nw }, (_, v) => v).filter((v) => chamberOf[v] === 1)];
  const newOf = new Int32Array(nw).fill(-1);
  order.forEach((w, i) => { newOf[w] = i; });
  const nLa = order.filter((w) => chamberOf[w] === 0).length;
  const laIdx: number[] = [], raIdx: number[] = [];
  for (let t = 0; t < wTris.length; t += 3) {
    const a = newOf[wTris[t]], b = newOf[wTris[t + 1]], c = newOf[wTris[t + 2]];
    if (a < 0 || b < 0 || c < 0) continue;
    const inLa = a < nLa;
    if (inLa !== (b < nLa) || inLa !== (c < nLa)) continue;
    (inLa ? laIdx : raIdx).push(a, b, c);
  }
  const positions = new Float32Array(order.length * 3);
  order.forEach((w, i) => positions.set(wPos.subarray(3 * w, 3 * w + 3), 3 * i));
  const indices = Uint32Array.from([...laIdx, ...raIdx]);
  const sourceIndexOf = Int32Array.from(order, (w) => firstOf[w]);
  const toNew = (src: number) => { const nv = newOf[remap[src]]; if (nv < 0) throw new Error(`頂点 ${src} は心房のメッシュにありません`); return nv; };

  // 4. 領域
  const over = regionOverrides(labels, total);
  const given = new Int16Array(order.length).fill(-1);
  over.forEach((r, src) => { if (r >= 0) { const nv = newOf[remap[src]]; if (nv >= 0) given[nv] = r; } });
  const complete = given.every((r) => r >= 0);
  const est = complete ? null : estimateRegions(positions, indices, nLa);
  const region = est ? est.region : Uint8Array.from(given);
  if (est) given.forEach((r, v) => { if (r >= 0) region[v] = r; });

  // 5. 目印・連結（JSON の頂点 index を読み込んだメッシュの番号に直す）
  // 目印：JSON の指定 > 推定の途中で決めた目印（推定したとき）> 領域ラベルから求める（derive.ts）
  const givenAnchors = labels?.anchors && Object.fromEntries(Object.entries(labels.anchors).map(([k, v]) => [k, toNew(v!)])) as Partial<Record<AnchorName, number>>;
  const mapped: LabelFile = {
    ...(labels ?? { format: 'ep-mapping-sim/labels', version: 1 }),
    anchors: { ...est?.anchors, ...givenAnchors },
    bridges: labels?.bridges?.map((b) => ({ name: b.name, pairs: b.pairs.map(([r, l]) => [toNew(r), toNew(l)] as [number, number]) })),
  };
  const model = deriveModel({ positions, indices, region, laVertexCount: nLa, laIndexCount: laIdx.length, name: opts.name }, mapped);
  return { model, estimated: !complete, sourceIndexOf };
}

/**
 * モデルを glTF（GLB）とラベル JSON に書き出す（往復テスト、Blender での手直しの出発点）。
 * メッシュは LA・RA の 2 つ。ラベル JSON の頂点 index は LA → RA の通し番号（GLB の頂点の順と同じ）
 */
export function exportModelToGltf(model: BiatrialModel): { glb: Uint8Array; labels: LabelFile } {
  const m = model.mesh, parts = m.parts!;
  const meshes = parts.map((p) => ({
    name: p.chamber,
    positionsMm: m.positions.slice(3 * p.vertexStart, 3 * (p.vertexStart + p.vertexCount)),
    indices: Uint32Array.from(m.indices.subarray(p.indexStart, p.indexStart + p.indexCount), (i) => i - p.vertexStart),
  }));
  const a = model.anatomy.anchors;
  const labels: LabelFile = {
    format: 'ep-mapping-sim/labels', version: 1, unit: 'm',
    chambers: { LA: ['LA'], RA: ['RA'] },
    regions: Array.from(m.regionOfVertex, (r) => REGIONS[r] as RegionName),
    anchors: Object.fromEntries(Object.entries(a).map(([k, x]) => [k, x.vertex])) as Partial<Record<AnchorName, number>>,
    lines: model.anatomy.lines,
    bridges: (m.bridges ?? []).map((b) => ({ name: b.name, pairs: b.pairs })),
  };
  return { glb: writeGlb(meshes), labels };
}
