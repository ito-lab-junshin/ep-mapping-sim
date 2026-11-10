import type { SampleBuffer } from '../types';

/** 固定長の Float32 リングバッファ。満杯になると最古のサンプルから上書きする */
export class RingBuffer implements SampleBuffer {
  private data: Float32Array;
  private head = 0; // 次に書く位置
  private count = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get length() { return this.count; }

  push(x: number) {
    this.data[this.head] = x;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  at(i: number): number {
    if (i < 0 || i >= this.count) return 0;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return this.data[(start + i) % this.capacity];
  }

  /** 古い順に out へコピーする（out.length まで） */
  readInto(out: Float32Array): number {
    const n = Math.min(out.length, this.count);
    for (let i = 0; i < n; i++) out[i] = this.at(this.count - n + i);
    return n;
  }

  clear() { this.head = 0; this.count = 0; }
}
