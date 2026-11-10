import type { LatMethod, MapPoint, MapSettings, SampleBuffer, TachycardiaState, Vec3 } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import { GRID } from '../params';
import { annotate, estimateCycleLength, indexAt, referenceBeats } from './annotation';
import { effectiveWoi } from './woi';
import { omnipolar } from './omnipolar';

export interface AcquireResult {
  points: Omit<MapPoint, 'id'>[];
  /** 取得できなかった理由（points が空のとき） */
  reason?: 'no-reference' | 'no-contact' | 'not-placed';
  woi?: { beforeMs: number; afterMs: number; auto: boolean };
  cycleLengthMs?: number | null;
  referenceTime?: number;
}

/**
 * マッピングカテーテルの、接触している双極ごとに点を取得する（docs/DESIGN.md §6）。
 *  1. 基準チャンネルの興奮のうち、WOI の後端まで記録し終えた最新の拍を選ぶ
 *  2. 双極（隣り合う 2 電極）ごとに LAT と電位を注釈する。両電極が接触しているものだけ
 *  3. omnipolar = true のグリッドは、隣り合う 3 電極で方向非依存 EGM を使う
 * 注釈には電極の単極電位の差を使う（心室の遠隔電位の合成成分は含まない）。
 */
export function acquirePoints(
  engine: SimulationEngine, catheterId: string, settings: MapSettings,
  opts: { omnipolar: boolean; rhythm: TachycardiaState },
): AcquireResult {
  const spec = engine.spec(catheterId);
  if (!spec || !spec.catheter.placed) return { points: [], reason: 'not-placed' };
  const ref = engine.channels.find((c) => c.id === settings.referenceChannel);
  if (!ref) return { points: [], reason: 'no-reference' };
  const now = engine.time, dt = engine.sampleMs;
  const beats = referenceBeats(ref.buffer, now, dt);
  const cycleLengthMs = estimateCycleLength(beats);
  const woi = effectiveWoi(settings, opts.rhythm, cycleLengthMs);
  const hist0 = engine.unipolarHistory(catheterId, 0);
  if (!hist0) return { points: [], reason: 'not-placed' };
  const earliest = now - (hist0.length - 1) * dt;
  const tRef = beats.find((t) => t + woi.afterMs <= now && t + woi.beforeMs >= earliest);
  if (tRef === undefined) return { points: [], reason: 'no-reference', woi, cycleLengthMs };

  const cath = spec.catheter;
  const sampler = (buf: SampleBuffer) => (t: number) => {
    const i = indexAt(buf, t, now, dt);
    return i < 0 ? 0 : buf.at(i);
  };
  const uni = cath.electrodes.map((_, e) => sampler(engine.unipolarHistory(catheterId, e)!));
  const contact = (e: number) => cath.electrodes[e].contactVertex >= 0;
  const surfacePoint = (ps: Vec3[]) => {
    const c = ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, y: a.y + p.y / ps.length, z: a.z + p.z / ps.length }), { x: 0, y: 0, z: 0 });
    return engine.query.closestPoint(c);
  };
  const points: Omit<MapPoint, 'id'>[] = [];
  const method: LatMethod = settings.latMethod;

  if (opts.omnipolar && cath.kind === 'grid') {
    for (let r = 0; r < GRID.rows - 1; r++) for (let c = 0; c < GRID.cols - 1; c++) {
      const e0 = r * GRID.cols + c, ex = e0 + 1, ey = e0 + GRID.cols;
      if (![e0, ex, ey].every(contact)) continue;
      const b1: number[] = [], b2: number[] = [], ts: number[] = [];
      for (let t = tRef + woi.beforeMs; t <= tRef + woi.afterMs; t += dt) {
        ts.push(t);
        b1.push(uni[ex](t) - uni[e0](t));
        b2.push(uni[ey](t) - uni[e0](t));
      }
      const o = omnipolar(b1, b2);
      const omniAt = (t: number) => o.signal[Math.max(0, Math.min(ts.length - 1, Math.round((t - ts[0]) / dt)))];
      const a = annotate(omniAt, uni[e0], tRef, woi, dt, method);
      const hit = surfacePoint([e0, ex, ey].map((e) => cath.electrodes[e].position));
      points.push({ position: hit.point, vertex: hit.vertex, latMs: a.latMs, voltageMv: o.voltageMv, catheterId, signal: 'omnipolar', referenceTime: tRef });
    }
  } else {
    for (const ch of spec.channels) {
      const [a, b] = ch.pair;
      if (!contact(a) || !contact(b)) continue;
      const ann = annotate((t) => uni[a](t) - uni[b](t), uni[a], tRef, woi, dt, method);
      const hit = surfacePoint([cath.electrodes[a].position, cath.electrodes[b].position]);
      points.push({ position: hit.point, vertex: hit.vertex, latMs: ann.latMs, voltageMv: ann.voltageMv, catheterId, signal: 'bipolar', referenceTime: tRef });
    }
  }
  if (!points.length) return { points, reason: 'no-contact', woi, cycleLengthMs, referenceTime: tRef };
  return { points, woi, cycleLengthMs, referenceTime: tRef };
}
