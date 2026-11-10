import type { MapPoint, SurfaceMesh, Vec3 } from '../types';
import { MinHeap } from '../util/MinHeap';
import { MAP_DEFAULTS } from '../params';

/** 各点から表面距離 maxReachMm 以内の頂点と距離（ダイクストラ法） */
interface Reach { vertices: Int32Array; dist: Float32Array }

/**
 * マップの取得点と、点からメッシュ全体への補間（docs/DESIGN.md §6）。
 * 補間：表面距離 d が到達距離（fill threshold 相当）以内の点を、重み 1/(d² + 1) で平均する。
 * 到達距離より遠い頂点は「データなし」（NaN）。点が少ないと粗く、増えるほど正確になる。
 * 表面距離はメッシュの辺をたどる最短経路（心房間の連結は通らない）。
 */
export class PointCollection {
  readonly points: MapPoint[] = [];
  private reach = new Map<number, Reach>();
  private nextId = 1;

  constructor(readonly mesh: SurfaceMesh, readonly maxReachMm = MAP_DEFAULTS.fillThresholdRangeMm[1]) {}

  add(p: Omit<MapPoint, 'id'>): MapPoint {
    const point: MapPoint = { ...p, id: this.nextId++ };
    this.points.push(point);
    this.reach.set(point.id, this.dijkstra(point.vertex, point.position));
    return point;
  }

  clear() {
    this.points.length = 0;
    this.reach.clear();
  }

  /** pos から distMm 以内に既存の点があるか */
  hasNear(pos: Vec3, distMm: number): boolean {
    return this.points.some((q) => Math.hypot(q.position.x - pos.x, q.position.y - pos.y, q.position.z - pos.z) < distMm);
  }

  /**
   * 頂点ごとの補間値（NaN = データなし）。kind = 'lat' は LAT が null の点を除く。
   */
  interpolate(kind: 'lat' | 'voltage', fillThresholdMm: number): Float32Array {
    const n = this.mesh.positions.length / 3;
    const num = new Float64Array(n), den = new Float64Array(n);
    const fill = Math.min(fillThresholdMm, this.maxReachMm);
    for (const p of this.points) {
      const val = kind === 'lat' ? p.latMs : p.voltageMv;
      if (val === null) continue;
      const r = this.reach.get(p.id)!;
      for (let i = 0; i < r.vertices.length; i++) {
        const d = r.dist[i];
        if (d > fill) continue;
        const w = 1 / (d * d + 1);
        num[r.vertices[i]] += w * val;
        den[r.vertices[i]] += w;
      }
    }
    const out = new Float32Array(n);
    for (let v = 0; v < n; v++) out[v] = den[v] > 0 ? num[v] / den[v] : Number.NaN;
    return out;
  }

  private dijkstra(start: number, pos: Vec3): Reach {
    const p = this.mesh.positions;
    const best = new Map<number, number>();
    const heap = new MinHeap();
    const d0 = Math.hypot(p[3 * start] - pos.x, p[3 * start + 1] - pos.y, p[3 * start + 2] - pos.z);
    best.set(start, d0);
    heap.push(d0, start);
    while (heap.size > 0) {
      const { time: d, v } = heap.pop();
      if (d > (best.get(v) ?? Infinity)) continue;
      for (const u of this.mesh.neighbors[v]) {
        const nd = d + Math.hypot(p[3 * u] - p[3 * v], p[3 * u + 1] - p[3 * v + 1], p[3 * u + 2] - p[3 * v + 2]);
        if (nd > this.maxReachMm || nd >= (best.get(u) ?? Infinity)) continue;
        best.set(u, nd);
        heap.push(nd, u);
      }
    }
    const vertices = new Int32Array(best.size), dist = new Float32Array(best.size);
    let i = 0;
    for (const [v, d] of best) { vertices[i] = v; dist[i] = d; i++; }
    return { vertices, dist };
  }
}
