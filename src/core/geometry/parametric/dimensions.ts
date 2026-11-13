/**
 * パラメトリック解剖形状の寸法（単位 mm）。
 * docs/DESIGN.md §9.1「パラメトリック形状の寸法」の表と一致させること。
 *
 * - normal：洞調律の心房（AFL・AVNRT・WPW シナリオで使う）
 * - afRemodeled：AF によるリモデリング後の心房（AF シナリオで使う）
 * - aflRemodeled：通常型 AFL の患者の拡大した右房（AFL シナリオで使う）
 *
 * 出典を一次資料で確認できた値だけに出典を書き、それ以外は「仮定値（教育用近似）」とする。
 * 寸法を変えるときはこのファイルだけを編集する。
 */

import type { AnatomyDimensionSet } from '../../types';

export type DimensionSetId = AnatomyDimensionSet;

/** PV 口（上下径 × 前後径）。上下径を長軸とする楕円で作る */
export interface PvOstium { si: number; ap: number }

export interface AnatomyDimensions {
  id: DimensionSetId;
  label: string;
  la: { apDiameter: number; lrDiameter: number; siDiameter: number };
  ra: { minorDiameter: number; majorDiameter: number; apDiameter: number };
  pv: { LSPV: PvOstium; LIPV: PvOstium; RSPV: PvOstium; RIPV: PvOstium; sleeveLength: number };
  laa: { length: number; ostiumDiameter: number };
  /** 右心耳：開口の長軸径 × 短軸径、開口から先端までの長さ（深さ） */
  raa: { ostiumMajor: number; ostiumMinor: number; length: number };
  annulus: { mitral: number; tricuspid: number };
  vein: { svc: number; ivc: number; length: number; csOstium: number };
}

const normal: AnatomyDimensions = {
  id: 'normal',
  label: '正常（洞調律）',
  la: {
    /** 前後径。Lang RM ほか, J Am Soc Echocardiogr 2015（Supplemental Table 9）、Skowerski M ほか, BMC Cardiovasc Disord 2018;18:146 Table 2 の対照群 35.4 mm */
    apDiameter: 35,
    /** 左右径。仮定値（教育用近似） */
    lrDiameter: 46,
    /** 上下径。仮定値（教育用近似） */
    siDiameter: 44,
  },
  /** RA の径。仮定値（教育用近似） */
  ra: { minorDiameter: 38, majorDiameter: 50, apDiameter: 40 },
  pv: {
    /** Skowerski M ほか, BMC Cardiovasc Disord 2018;18:146 Table 3（対照群）。上下径 × 前後径 */
    RSPV: { si: 14.8, ap: 13.7 },
    RIPV: { si: 13.9, ap: 13.6 },
    LSPV: { si: 15.1, ap: 12.0 },
    LIPV: { si: 13.7, ap: 10.3 },
    /** PV 口から先の管の長さ（筋スリーブを含む）。仮定値（教育用近似） */
    sleeveLength: 15,
  },
  /** 左心耳。仮定値（教育用近似） */
  laa: { length: 22, ostiumDiameter: 16 },
  /**
   * 右心耳。仮定値（教育用近似）。開口の長軸径 20 mm は、ユーザー提示の文献情報
   * （Folia Morphologica 掲載の解剖学的検討、平均 約 20 mm。原文は未確認）に合わせた。
   * 断面は幅広い三角形の袋に近づけるため楕円（20 × 14 mm、断面積 約 2.2 cm²）。長さは仮定値
   */
  raa: { ostiumMajor: 20, ostiumMinor: 14, length: 25 },
  /** 弁輪径。仮定値（教育用近似） */
  annulus: { mitral: 30, tricuspid: 35 },
  /** SVC・IVC 径、RA から先の静脈の長さ、CS 口径。仮定値（教育用近似） */
  vein: { svc: 18, ivc: 21, length: 12, csOstium: 12 },
};

/** LA 前後径の比（41 / 35）。左右径・上下径は同じ比で拡大する（仮定値・教育用近似） */
const AF_LA_SCALE = 41 / 35;

const afRemodeled: AnatomyDimensions = {
  ...normal,
  id: 'afRemodeled',
  label: 'AF リモデリング',
  la: {
    /** 前後径。Skowerski M ほか, BMC Cardiovasc Disord 2018;18:146 Table 2 の AF 群 41.2 mm */
    apDiameter: 41,
    /** 左右径。仮定値（教育用近似）：正常値を前後径と同じ比で拡大 */
    lrDiameter: Math.round(normal.la.lrDiameter * AF_LA_SCALE),
    /** 上下径。仮定値（教育用近似）：同上 */
    siDiameter: Math.round(normal.la.siDiameter * AF_LA_SCALE),
  },
  pv: {
    /** Skowerski M ほか, BMC Cardiovasc Disord 2018;18:146 Table 3（AF 群）。上下径 × 前後径 */
    RSPV: { si: 18.5, ap: 16.5 },
    RIPV: { si: 16.8, ap: 15.2 },
    LSPV: { si: 18.2, ap: 14.7 },
    LIPV: { si: 16.1, ap: 12.4 },
    sleeveLength: normal.pv.sleeveLength,
  },
};

/** RA と三尖弁輪の拡大率（AFL）。仮定値（教育用近似）。目標の周期長（220〜260 ms）から調整する */
export const AFL_RA_SCALE = 1.2;

const aflRemodeled: AnatomyDimensions = {
  ...normal,
  id: 'aflRemodeled',
  label: '右房拡大（AFL）',
  /** RA の径。仮定値（教育用近似）：正常の AFL_RA_SCALE 倍 */
  ra: {
    minorDiameter: Math.round(normal.ra.minorDiameter * AFL_RA_SCALE),
    majorDiameter: Math.round(normal.ra.majorDiameter * AFL_RA_SCALE),
    apDiameter: Math.round(normal.ra.apDiameter * AFL_RA_SCALE),
  },
  /** 三尖弁輪径。仮定値（教育用近似）：旋回は三尖弁輪の縁に沿うので、回路の長さは主に弁輪の周長で決まる */
  annulus: { ...normal.annulus, tricuspid: Math.round(normal.annulus.tricuspid * AFL_RA_SCALE) },
};

export const DIMENSION_SETS: Record<DimensionSetId, AnatomyDimensions> = { normal, afRemodeled, aflRemodeled };

/**
 * CTI 長の目安（生成後にこの範囲に収まることをテストで確認する）。仮定値（教育用近似）。形状から決まる結果であり、入力値ではない。
 * 三尖弁輪を下へ傾けたため（AFL の II の粗動波を陰性優位にするため）、正常の大きさの RA では約 15 mm になる。
 * CTI の長さが効く AFL の解剖（aflRemodeled）は AFL_CTI_MIN_MM 以上を別に確かめる
 */
export const CTI_LENGTH_RANGE_MM = [14, 40] as const;
/** AFL の解剖（拡大した RA）の CTI 長の下限。仮定値（教育用近似） */
export const AFL_CTI_MIN_MM = 20;

/** 両心房の配置・心房間の連結。仮定値（教育用近似） */
export const LAYOUT = {
  /** 心房間の連結（Bachmann 束・卵円窩縁・CS 筋束）の接続範囲の半径 */
  bridgeRadius: 4,
} as const;

/** メッシュ生成の格子間隔（辺長の目安）。数値計算上の設定 */
export const MESH_GRID_MM = 2;
