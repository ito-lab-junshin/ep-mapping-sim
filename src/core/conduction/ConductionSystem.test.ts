import { describe, it, expect } from 'vitest';
import { ConductionSystem } from './ConductionSystem';
import { antegradeTime, slowPathway } from './AvNode';
import { AV_NODE, HV_MS } from '../params';

/** イベントを時刻 until まで進め、心房への出口を返す */
function run(c: ConductionSystem, until: number) {
  c.advance(until);
  return c.takeExits(until);
}

describe('房室結節の経路', () => {
  it('減衰伝導：連結期が ERP に近いほど AH が延び、ERP 未満はブロック', () => {
    const p = { name: 'fast' as const, ...AV_NODE.fast };
    expect(antegradeTime(p, 1000)).toBeCloseTo(AV_NODE.fast.ahMs, 0);
    expect(antegradeTime(p, AV_NODE.fast.erpMs + 10)!).toBeGreaterThan(AV_NODE.fast.ahMs + 25);
    expect(antegradeTime(p, AV_NODE.fast.erpMs - 1)).toBeNull();
  });
});

describe('ConductionSystem（速伝導路のみ）', () => {
  it('H = A + AH、V = H + HV。心室の ERP 内の興奮はブロック', () => {
    const c = new ConductionSystem(0);
    c.atrialArrival(0, 100);
    run(c, 1000);
    expect(c.hTimes).toEqual([100 + AV_NODE.fast.ahMs]);
    expect(c.vTimes).toEqual([100 + AV_NODE.fast.ahMs + HV_MS]);
    // 速伝導路の ERP 内の心房興奮は伝わらない
    c.atrialArrival(0, 300);
    run(c, 2000);
    expect(c.hTimes.length).toBe(1);
  });

  it('blocked = true なら房室伝導しない', () => {
    const c = new ConductionSystem(0);
    c.blocked = true;
    c.atrialArrival(0, 100);
    run(c, 1000);
    expect(c.vTimes.length).toBe(0);
  });
});

describe('ConductionSystem（AVNRT：2 経路）', () => {
  const make = () => {
    const c = new ConductionSystem(10);
    c.pathways.push(slowPathway(20));
    return c;
  };

  it('洞調律：速伝導路で伝わり、遅れて届く遅伝導路の興奮は共通路でブロック（エコーなし）', () => {
    const c = make();
    c.atrialArrival(0, 0);
    c.atrialArrival(1, 5);
    const exits = run(c, 1000);
    expect(c.hTimes).toEqual([AV_NODE.fast.ahMs]);
    expect(exits.length).toBe(0);
  });

  it('速伝導路の ERP 内の期外刺激は遅伝導路を下行し（AH ジャンプ ≧ 50 ms）、速伝導路を逆行してエコーになる', () => {
    const c = make();
    // S1
    c.atrialArrival(0, 0); c.atrialArrival(1, 5);
    run(c, 600);
    // S2（連結期 300 ms < 速伝導路 ERP 320 ms）
    c.atrialArrival(0, 300); c.atrialArrival(1, 305);
    const exits = run(c, 2000);
    const ah2 = c.hTimes[1] - 300;
    expect(ah2 - AV_NODE.fast.ahMs).toBeGreaterThanOrEqual(50);
    expect(exits.map((e) => e.via)).toEqual(['fast']);
    // エコーの A と V はほぼ同時（典型的 AVNRT）
    expect(Math.abs(exits[0].time - c.vTimes[1])).toBeLessThan(20);
  });
});

describe('ConductionSystem（WPW：副伝導路）', () => {
  it('洞調律：副伝導路から先に心室が興奮し（早期興奮）、His 経由の興奮が後から届く（融合）', () => {
    const c = new ConductionSystem(0);
    c.setAccessoryPathway([50]);
    c.atrialArrival(0, 20);
    c.apAtrialArrival(30);
    run(c, 1000);
    const beat = c.vBeats[0];
    expect(beat.source).toBe('ap');
    expect(beat.hisArrival! - beat.time).toBeGreaterThan(30);
  });

  it('副伝導路の順行性 ERP 内の期外刺激は房室結節だけを下行し、副伝導路を逆行して心房へ戻る（順行性 AVRT の始まり）', () => {
    const c = new ConductionSystem(0);
    c.setAccessoryPathway([50]);
    c.pathways[0].params.erpMs = 250; // 房室結節の ERP を副伝導路（280 ms）より短くした症例
    c.atrialArrival(0, 0); c.apAtrialArrival(10);
    run(c, 200);
    // 連結期 270 ms：副伝導路の順行性 ERP（280 ms）未満、房室結節の ERP（250 ms）以上
    c.atrialArrival(0, 270); c.apAtrialArrival(280);
    const exits = run(c, 2000);
    const last = c.vBeats[c.vBeats.length - 1];
    expect(last.source).toBe('his');
    expect(exits.some((e) => e.via === 'ap' && e.vertex === 50)).toBe(true);
  });

  it('RV 刺激は副伝導路を逆行して心房へ（偏心性の心房興奮）。房室結節の逆行より先に届く', () => {
    const c = new ConductionSystem(0);
    c.setAccessoryPathway([50]);
    c.paceVentricle(100);
    const exits = run(c, 500).sort((x, y) => x.time - y.time);
    expect(exits[0]).toMatchObject({ vertex: 50, via: 'ap' });
    const node = exits.find((e) => e.via === 'fast')!;
    expect(node.time).toBeGreaterThan(exits[0].time);
  });
});

describe('ConductionSystem（心室刺激での房室結節の逆行伝導：VA 伝導）', () => {
  const va = (cl: number, n: number) => {
    const c = new ConductionSystem(7);
    const times = Array.from({ length: n }, (_, i) => 100 + i * cl);
    for (const t of times) c.paceVentricle(t);
    const exits = run(c, 100 + n * cl + 500).filter((e) => e.via === 'fast');
    // 刺激ごとの VA（その刺激の後、次の刺激までに出た出口）
    return times.map((t) => { const e = exits.find((x) => x.time > t && x.time <= t + cl); return e ? e.time - t : null; });
  };

  it('刺激周期 600 ms：毎拍、速伝導路の入口（房室結節）から心房へ戻り、VA は約 130 ms（求心性）', () => {
    const r = va(600, 6);
    expect(r.every((x) => x !== null)).toBe(true);
    for (const x of r.slice(1)) { expect(x!).toBeGreaterThan(120); expect(x!).toBeLessThan(140); }
  });

  it('刺激周期 400 ms：VA が徐々に延びてから途絶える（逆行性 Wenckebach）', () => {
    const r = va(400, 14);
    const firstBlock = r.indexOf(null);
    expect(firstBlock).toBeGreaterThan(2);
    const before = r.slice(1, firstBlock) as number[];
    for (let i = 1; i < before.length; i++) expect(before[i]).toBeGreaterThanOrEqual(before[i - 1]);
    expect(before[before.length - 1] - before[0]).toBeGreaterThan(10);
  });

  it('His の不応期中（直前に順行の興奮が His を通った）は逆行しない（衝突）。房室伝導を止めていても逆行しない', () => {
    const c2 = new ConductionSystem(7);
    c2.blocked = true;
    c2.paceVentricle(100);
    expect(run(c2, 600).filter((e) => e.via === 'fast')).toHaveLength(0);
    const c3 = new ConductionSystem(7);
    c3.lastH = 100;
    c3.paceVentricle(110); // His への逆行の到着は 150 ms（His の不応期 250 ms の中）
    expect(run(c3, 600).filter((e) => e.via === 'fast')).toHaveLength(0);
  });
});
