import { describe, it, expect } from 'vitest';
import { caliper, msPerPx, visibleMs, visibleSamples } from './display';

describe('EGM 表示計算', () => {
  it('スイープ速度を倍にすると 1 px あたりの時間は半分', () => {
    expect(msPerPx(100, 4)).toBeCloseTo(2.5);
    expect(msPerPx(200, 4)).toBeCloseTo(1.25);
  });

  it('25 mm/s・幅 1000 px（96 dpi 相当）で約 10.6 s 表示する', () => {
    expect(visibleMs(1000, 25)).toBeCloseTo(10582, -1);
  });

  it('表示サンプル数はバッファ長で頭打ち', () => {
    expect(visibleSamples(1000, 100, 2, 100000, 4)).toBe(1251);
    expect(visibleSamples(1000, 25, 2, 300, 4)).toBe(300);
  });

  it('キャリパー：100 mm/s で 300 px（4 px/mm）は 750 ms・80 bpm', () => {
    const c = caliper(500, 200, 100, 4);
    expect(c.ms).toBeCloseTo(750);
    expect(c.bpm).toBeCloseTo(80);
  });
});
