/** 三角形インデックスから頂点ごとの隣接リストを作る（伝播計算の前処理） */
export function buildNeighbors(vertexCount: number, indices: Uint32Array): Int32Array[] {
  const sets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Int32Array.from(s));
}
