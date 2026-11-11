import type { EnergyId, SurfaceMesh, TissueState } from '../types';
import { REGIONS } from '../geometry/regions';
import { ABLATION } from '../params';

/**
 * 病変の場（docs/DESIGN.md §7、教育用近似。各社製品のアルゴリズムとは無関係）。
 * 頂点ごとの貫壁性 t（病変の深さ / 壁厚、0〜1）を持ち、組織に反映する：
 *  - t ≧ 1：viability = 0（伝導遮断）、電位 0
 *  - t < 1：viability = 1 − 0.7 t（伝導は遅くなるが残る：浅い病変・隙間からの伝導）、電位 × (1 − t)
 * 貫壁性は増える一方（同じ部位を焼き足すと深くなる）。
 */
export const ENERGY_LABEL: Record<EnergyId, string> = {
  rf: '高周波（RF）',
  cryo: 'クライオバルーン',
  pfa: 'パルスフィールド（PFA）',
};

/** 部位の壁厚 mm（仮定値） */
export function wallThicknessMm(regionId: number): number {
  const r = REGIONS[regionId];
  const w = ABLATION.wallThicknessMm;
  if (r === 'cti') return w.cti;
  if (r.endsWith('_sleeve') || r.endsWith('_ostium')) return w.pv;
  if (r === 'his_region' || r === 'av_node' || r === 'slow_pathway') return w.koch;
  if (r.startsWith('la') || r === 'laa' || r === 'mitral_annulus' || r === 'bachmann_bundle') return w.la;
  return w.ra;
}

export class LesionField {
  /** 頂点ごとの貫壁性 0〜1 */
  readonly transmurality: Float32Array;
  private baseVoltage: Float32Array;

  constructor(readonly mesh: SurfaceMesh, readonly tissue: TissueState) {
    this.transmurality = new Float32Array(tissue.viability.length);
    this.baseVoltage = Float32Array.from(tissue.voltage);
  }

  /** 頂点 v の貫壁性を t 以上にする */
  raise(v: number, t: number) {
    if (t > this.transmurality[v]) { this.transmurality[v] = Math.min(1, t); this.applyVertex(v); }
  }

  /** 頂点 v の貫壁性に dt を足す（PFA の回数） */
  add(v: number, dt: number) {
    this.transmurality[v] = Math.min(1, this.transmurality[v] + dt);
    this.applyVertex(v);
  }

  /** 頂点 v の深さ depthMm を、その部位の壁厚で割った貫壁性にする */
  raiseDepth(v: number, depthMm: number) {
    this.raise(v, depthMm / wallThicknessMm(this.mesh.regionOfVertex[v]));
  }

  private applyVertex(v: number) {
    const t = this.transmurality[v];
    const viab = t >= 1 ? 0 : 1 - ABLATION.partialSlowing * t;
    this.tissue.viability[v] = Math.min(this.tissue.viability[v], viab);
    this.tissue.voltage[v] = Math.min(this.tissue.voltage[v], this.baseVoltage[v] * (1 - t));
  }
}
