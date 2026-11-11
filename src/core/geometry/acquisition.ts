import type { Catheter, SurfaceMesh, Vec3 } from '../types';
import { ACQUISITION } from '../params';

/**
 * 収集モード（FAM 風、docs/DESIGN.md §9.2）。
 * プリセットのメッシュを「真の解剖」として隠し持ち、カテーテルの電極が壁の近く（wallReachMm 以内）を通った
 * まわり（revealRadiusMm）の頂点を「収集済み」にする。表示するのは 3 頂点とも収集済みの三角形だけで、
 * 未収集の部分は穴になる（点が足りない場所は形が分からない）。
 * 伝導・EGM・病変の計算はつねに真のメッシュで行う。表示メッシュは真のメッシュと同じ頂点なので、
 * マップ・病変はそのまま重ねられる。
 */
export class GeometryAcquisition {
  /** 頂点ごとの収集済みの印（一度収集すれば消えない。clear で消す） */
  readonly revealed: Uint8Array;
  /** 記録した電極の位置（間隔 pointSpacingMm 以上） */
  readonly points: Vec3[] = [];
  /** 収集済みの頂点が変わるたびに増える（表示の作り直し用） */
  version = 0;
  private pointKeys = new Set<string>();
  private grid = new Map<string, number[]>();
  private readonly cell = ACQUISITION.revealRadiusMm;

  constructor(readonly mesh: SurfaceMesh) {
    const p = mesh.positions;
    this.revealed = new Uint8Array(p.length / 3);
    for (let v = 0; v < p.length / 3; v++) {
      const k = this.key(p[3 * v], p[3 * v + 1], p[3 * v + 2], this.cell);
      let list = this.grid.get(k);
      if (!list) { list = []; this.grid.set(k, list); }
      list.push(v);
    }
  }

  private key(x: number, y: number, z: number, size: number) {
    return `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
  }

  /** 電極の位置 1 つを記録する。壁の近くなら、まわりの頂点を収集済みにする。収集済みが増えたら true */
  addElectrode(position: Vec3, distanceToWallMm: number): boolean {
    const pk = this.key(position.x, position.y, position.z, ACQUISITION.pointSpacingMm);
    if (!this.pointKeys.has(pk)) { this.pointKeys.add(pk); this.points.push({ ...position }); }
    if (distanceToWallMm > ACQUISITION.wallReachMm) return false;
    const r = ACQUISITION.revealRadiusMm, r2 = r * r, p = this.mesh.positions;
    const cx = Math.floor(position.x / this.cell), cy = Math.floor(position.y / this.cell), cz = Math.floor(position.z / this.cell);
    let changed = false;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const list = this.grid.get(`${cx + i},${cy + j},${cz + k}`);
      if (!list) continue;
      for (const v of list) {
        if (this.revealed[v]) continue;
        const d2 = (p[3 * v] - position.x) ** 2 + (p[3 * v + 1] - position.y) ** 2 + (p[3 * v + 2] - position.z) ** 2;
        if (d2 <= r2) { this.revealed[v] = 1; changed = true; }
      }
    }
    if (changed) this.version++;
    return changed;
  }

  /** 置かれているカテーテル（メッシュ上の電極をもつもの）の電極をすべて記録する */
  collect(catheters: Catheter[]): boolean {
    let changed = false;
    for (const c of catheters) {
      if (!c.placed || c.source !== 'mesh') continue;
      for (const e of c.electrodes) changed = this.addElectrode(e.position, e.heightMm) || changed;
    }
    return changed;
  }

  /** 3 頂点とも収集済みの三角形の index（範囲 [start, start + count)） */
  revealedIndices(start = 0, count = this.mesh.indices.length): Uint32Array {
    const idx = this.mesh.indices, out: number[] = [];
    for (let t = start; t < start + count; t += 3) {
      if (this.revealed[idx[t]] && this.revealed[idx[t + 1]] && this.revealed[idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    return Uint32Array.from(out);
  }

  /** 頂点の範囲のうち収集済みの割合 %（被覆率） */
  coveragePct(vertexStart = 0, vertexCount = this.revealed.length): number {
    let n = 0;
    for (let v = vertexStart; v < vertexStart + vertexCount; v++) n += this.revealed[v];
    return vertexCount ? (100 * n) / vertexCount : 0;
  }

  clear() {
    this.revealed.fill(0);
    this.points.length = 0;
    this.pointKeys.clear();
    this.version++;
  }
}
