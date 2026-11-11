/**
 * 解剖領域ラベル（SurfaceMesh.regionOfVertex の値 = この配列の index）。
 * 1 頂点に 1 ラベル。重なる場合は解剖ごとの優先順位で決める（parametric/atria.ts）。
 */
export const REGIONS = [
  // 左房
  'la_body', 'la_septum', 'la_roof', 'la_posterior', 'la_anterior', 'laa', 'mitral_annulus', 'bachmann_bundle',
  'lspv_sleeve', 'lipv_sleeve', 'rspv_sleeve', 'ripv_sleeve',
  'lspv_ostium', 'lipv_ostium', 'rspv_ostium', 'ripv_ostium',
  // 右房
  'ra_body', 'ra_septum', 'fossa_ovalis', 'sinus_node', 'crista_terminalis', 'eustachian_ridge', 'cti', 'cs_os',
  'his_region', 'av_node', 'slow_pathway', 'tricuspid_annulus', 'svc', 'ivc',
] as const;

export type RegionName = (typeof REGIONS)[number];

export const REGION_ID: Record<RegionName, number> = Object.fromEntries(REGIONS.map((r, i) => [r, i])) as Record<RegionName, number>;

/** 画面表示用の日本語名（専門用語は英語併記） */
export const REGION_LABEL_JA: Record<RegionName, string> = {
  la_body: 'LA 本体', la_septum: 'LA 中隔', la_roof: 'LA 天蓋（roof）', la_posterior: 'LA 後壁', la_anterior: 'LA 前壁',
  laa: '左心耳（LAA）', mitral_annulus: '僧帽弁輪', bachmann_bundle: 'Bachmann 束',
  lspv_sleeve: 'LSPV', lipv_sleeve: 'LIPV', rspv_sleeve: 'RSPV', ripv_sleeve: 'RIPV',
  lspv_ostium: 'LSPV 口', lipv_ostium: 'LIPV 口', rspv_ostium: 'RSPV 口', ripv_ostium: 'RIPV 口',
  ra_body: 'RA 本体', ra_septum: 'RA 中隔', fossa_ovalis: '卵円窩', sinus_node: '洞結節', crista_terminalis: '分界稜', eustachian_ridge: 'Eustachian 稜',
  cti: '峡部（CTI）', cs_os: 'CS 口', his_region: 'His 束部位', av_node: '房室結節', slow_pathway: '遅伝導路部位',
  tricuspid_annulus: '三尖弁輪', svc: 'SVC', ivc: 'IVC',
};

export const PV_NAMES = ['LSPV', 'LIPV', 'RSPV', 'RIPV'] as const;
export type PvName = (typeof PV_NAMES)[number];

export const PV_SLEEVE: Record<PvName, RegionName> = { LSPV: 'lspv_sleeve', LIPV: 'lipv_sleeve', RSPV: 'rspv_sleeve', RIPV: 'ripv_sleeve' };
export const PV_OSTIUM: Record<PvName, RegionName> = { LSPV: 'lspv_ostium', LIPV: 'lipv_ostium', RSPV: 'rspv_ostium', RIPV: 'ripv_ostium' };

/** 領域に属する頂点 */
export function verticesInRegion(regionOfVertex: Uint8Array, region: RegionName): number[] {
  const id = REGION_ID[region];
  const out: number[] = [];
  for (let v = 0; v < regionOfVertex.length; v++) if (regionOfVertex[v] === id) out.push(v);
  return out;
}
