import { describe, it, expect } from 'vitest';
import { AvConduction } from './AvConduction';

describe('AvConduction', () => {
  it('H = A + AH、V = H + HV', () => {
    const av = new AvConduction({ ahMs: 80, hvMs: 45 });
    expect(av.atrialArrival(100)).toBe(true);
    expect(av.hTimes).toEqual([180]);
    expect(av.vTimes).toEqual([225]);
  });

  it('心室 ERP 内に来る興奮は伝導しない', () => {
    const av = new AvConduction({ ahMs: 80, hvMs: 45, ventricleErpMs: 250 });
    av.atrialArrival(0);
    expect(av.atrialArrival(200)).toBe(false);
    expect(av.vTimes.length).toBe(1);
    expect(av.aTimes.length).toBe(2);
    expect(av.atrialArrival(300)).toBe(true);
  });

  it('recent は未来の予定を含まない', () => {
    expect(AvConduction.recent([100, 200, 300], 250, 100)).toEqual([200]);
  });
});
