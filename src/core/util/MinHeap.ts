/** 最小ヒープ（キー = 時刻や距離、値 = 頂点 index）。伝播のイベント処理とダイクストラ法で使う */
export class MinHeap {
  private times: number[] = [];
  private verts: number[] = [];
  get size() { return this.times.length; }
  peekTime() { return this.times[0]; }
  push(time: number, v: number) {
    const a = this.times, b = this.verts;
    let i = a.length;
    a.push(time); b.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [b[p], b[i]] = [b[i], b[p]];
      i = p;
    }
  }
  pop(): { time: number; v: number } {
    const a = this.times, b = this.verts;
    const top = { time: a[0], v: b[0] };
    const lt = a.pop()!, lv = b.pop()!;
    if (a.length > 0) {
      a[0] = lt; b[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}
