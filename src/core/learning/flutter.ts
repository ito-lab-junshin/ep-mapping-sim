import type { SimulationEngine } from '../sim/SimulationEngine';

/**
 * ハロー 20 極の興奮順序から、三尖弁輪を回る旋回の向きを読む（左前斜位で見た向き）。
 *  - 反時計回り（通常型）：側壁を下行する → 近位（H 19-20）から遠位（H 1-2）へ
 *  - 時計回り：側壁を上行する → 遠位から近位へ
 * 各電極の最後の興奮時刻を周期で割った位相に並べ、いちばん大きな隙間の後から順序を読む。
 * ハローが置かれていない、頻拍でない、または順序がはっきりしないときは null。
 */
export function flutterDirection(engine: SimulationEngine): 'ccw' | 'cw' | null {
  const h = engine.catheter('halo');
  const cl = engine.rhythm.currentCycleLength(engine.time);
  if (!h?.placed || !cl || engine.rhythm.state !== 'tachycardia') return null;
  const la = engine.ca.tissue.lastActivation;
  const items: { k: number; phase: number }[] = [];
  h.electrodes.forEach((e, k) => {
    if (k % 2 !== 0) return; // 双極の遠位側の電極（1, 3, …, 19）
    const v = e.contactVertex >= 0 ? e.contactVertex : engine.query.closestPoint(e.position).vertex;
    if (la[v] < 0 || engine.time - la[v] > 2 * cl) return;
    items.push({ k, phase: (((la[v] % cl) + cl) % cl) / cl });
  });
  if (items.length < 6) return null;
  items.sort((a, b) => a.phase - b.phase);
  let gapAt = 0, gap = -1;
  for (let i = 0; i < items.length; i++) {
    const next = i + 1 < items.length ? items[i + 1].phase : items[0].phase + 1;
    if (next - items[i].phase > gap) { gap = next - items[i].phase; gapAt = (i + 1) % items.length; }
  }
  const order = items.slice(gapAt).concat(items.slice(0, gapAt)).map((x) => x.k);
  // 順序と電極番号の相関（+：遠位→近位、−：近位→遠位）
  const n = order.length, mean = (n - 1) / 2;
  const km = order.reduce((a, b) => a + b, 0) / n;
  let cov = 0, va = 0, vb = 0;
  order.forEach((k, i) => { cov += (i - mean) * (k - km); va += (i - mean) ** 2; vb += (k - km) ** 2; });
  const r = cov / Math.sqrt(va * vb || 1);
  if (Math.abs(r) < 0.7) return null;
  return r < 0 ? 'ccw' : 'cw';
}
