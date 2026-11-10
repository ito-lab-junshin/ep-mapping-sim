import { describe, it, expect } from 'vitest';
import { RingBuffer } from './RingBuffer';

describe('RingBuffer', () => {
  it('容量未満では入れた順に読める', () => {
    const b = new RingBuffer(4);
    b.push(1); b.push(2);
    expect(b.length).toBe(2);
    expect([b.at(0), b.at(1)]).toEqual([1, 2]);
  });

  it('一周しても古い順に読める', () => {
    const b = new RingBuffer(3);
    [1, 2, 3, 4, 5].forEach((x) => b.push(x));
    expect(b.length).toBe(3);
    expect([b.at(0), b.at(1), b.at(2)]).toEqual([3, 4, 5]);
    const out = new Float32Array(2);
    expect(b.readInto(out)).toBe(2);
    expect(Array.from(out)).toEqual([4, 5]);
  });

  it('範囲外は 0、clear で空になる', () => {
    const b = new RingBuffer(2);
    b.push(7);
    expect(b.at(5)).toBe(0);
    b.clear();
    expect(b.length).toBe(0);
  });
});
