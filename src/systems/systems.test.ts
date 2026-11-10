import { describe, it, expect } from 'vitest';
import { SYSTEMS } from './index';

describe('テーマ（3 システム）', () => {
  const themes = Object.values(SYSTEMS);

  it('3 テーマとも同じ項目（色・用語・機能フラグ）をもつ', () => {
    const keys = (o: object) => Object.keys(o).sort();
    for (const t of themes) {
      expect(keys(t.colors)).toEqual(keys(themes[0].colors));
      expect(keys(t.features)).toEqual(keys(themes[0].features));
      for (const k of ['activationMap', 'voltageMap', 'propagationMap', 'mapPoint', 'fillThreshold'] as const) expect(t.terms[k]).toBeTruthy();
    }
  });

  it('商標は「〜風」と表記し、免責（非公式）を残す', () => {
    for (const t of themes) {
      expect(t.name).toMatch(/風$/);
      expect(t.vendorNote).toContain('非公式');
    }
  });

  it('LAT の色：EnSite 風は最早期が白、ほかは赤から始まる', () => {
    expect(SYSTEMS.ensite.colors.activationRamp[0].toLowerCase()).toBe('#ffffff');
    expect(SYSTEMS.carto.colors.activationRamp[0].toLowerCase()).not.toBe('#ffffff');
    expect(SYSTEMS.opal.colors.activationRamp[0].toLowerCase()).not.toBe('#ffffff');
  });

  it('方向非依存 EGM はグリッド型をもつテーマだけ', () => {
    for (const t of themes) if (t.features.omnipolarEgm) expect(t.features.hdGridLikeCatheter).toBe(true);
  });
});
