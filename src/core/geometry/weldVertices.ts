/**
 * 同じ位置にある頂点を 1 つにまとめ、潰れた三角形を取り除く。
 *
 * 楕円体を緯度経度で張ると、極に (slices + 1) 個、経度 0° と 360° の継ぎ目に
 * 同じ座標の頂点が重複する。重複したままだと継ぎ目の両側が隣接リストで
 * つながらず、伝播上「解剖学的ブロック線」として振る舞ってしまう（旋回が
 * 継ぎ目で止まる）。また極では長さ 0 の辺ができ、EGM のラプラシアン計算が
 * 発散する。これらを防ぐため、メッシュ生成直後に必ず通す。
 */
export function weldVertices(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  epsilonMm = 1e-4,
): { positions: Float32Array; indices: Uint32Array } {
  const n = positions.length / 3;
  const remap = new Int32Array(n);
  const key = (i: number) => {
    const q = (x: number) => Math.round(x / epsilonMm);
    return `${q(positions[3 * i])},${q(positions[3 * i + 1])},${q(positions[3 * i + 2])}`;
  };
  const seen = new Map<string, number>();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const found = seen.get(k);
    if (found !== undefined) { remap[i] = found; continue; }
    const id = out.length / 3;
    seen.set(k, id);
    remap[i] = id;
    out.push(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
  }
  const tri: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue; // 潰れた三角形
    tri.push(a, b, c);
  }
  return { positions: Float32Array.from(out), indices: Uint32Array.from(tri) };
}
