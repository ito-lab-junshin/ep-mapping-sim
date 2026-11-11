import type { ArrhythmiaId, GeometryMode, MapPoint } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import type { GoalTracker } from './GoalTracker';
import { isolatedPvs } from '../arrhythmia/pv';

/**
 * チュートリアル（docs/DESIGN.md §11・Phase 6）：手順を順に示し、完了条件を満たしたら次へ進む。
 * Phase 6 は PVI（RF）だけ。AFL・AVNRT・WPW の詳細なチュートリアルは Phase 7。
 */

/** 手順の完了を判定する材料（画面の状態は UI から渡す） */
export interface TutorialContext {
  engine: SimulationEngine;
  goals: GoalTracker;
  points: readonly MapPoint[];
  ui: {
    arrhythmia: ArrhythmiaId;
    geometryMode: GeometryMode;
    /** 収集モードの LA の被覆率 % */
    laCoveragePct: number;
    /** LA の形を作る目安 %（設定で変えられる。既定 TUTORIAL_LA_COVERAGE_PCT） */
    coverageTargetPct: number;
    /** 根治判定の結果がすべて ✓ */
    cureOk: boolean;
  };
}

/** 強調する操作欄 */
export type TutorialTarget = 'scenario' | 'geometry' | 'catheters' | 'map' | 'ablation' | 'stimulation' | 'cure' | 'goals';

export interface TutorialStep {
  id: string;
  title: string;
  instruction: string;
  hint: string;
  target: TutorialTarget;
  /** 任意の手順（とばしてもよい） */
  optional?: boolean;
  /** 1 つずつチェックを付ける項目（例：PV ごとの entrance block） */
  items?(ctx: TutorialContext): { label: string; done: boolean }[];
  done(ctx: TutorialContext): boolean;
}

export interface Tutorial { id: string; title: string; scenario: ArrhythmiaId; steps: TutorialStep[] }

/** 収集モードで LA の形を作る目安 % の既定値と、設定で選べる範囲（仮定値） */
export const TUTORIAL_LA_COVERAGE_PCT = 70;
export const TUTORIAL_COVERAGE_RANGE_PCT = [30, 95] as const;

export const PVI_TUTORIAL: Tutorial = {
  id: 'pvi-rf',
  title: 'PVI（RF）',
  scenario: 'af',
  steps: [
    {
      id: 'scenario', title: '症例を選ぶ', target: 'scenario',
      instruction: '「不整脈」で「心房細動（PVI）」を選びます。PV（主に上肺静脈）の中のトリガーが高頻度に発火して AF が続いています。',
      hint: '操作パネルのいちばん上の「不整脈」の選択肢です。',
      done: (c) => c.ui.arrhythmia === 'af',
    },
    {
      id: 'geometry-mode', title: '収集モードにする', target: 'geometry',
      instruction: '「ジオメトリー」を収集モードにします。カテーテルでなぞった部分だけが形として現れ、なぞっていない場所は穴のままです。',
      hint: '「ジオメトリー」の選択肢で「〜で収集」を選びます。',
      done: (c) => c.ui.geometryMode === 'acquire',
    },
    {
      id: 'build-la', title: 'LA の形を作る', target: 'catheters',
      instruction: 'ABL か多極カテーテルを選び、3D 上でドラッグして LA の壁をなぞります。4 本の PV の口・天蓋・後壁・前壁・LAA を含めて、目安の被覆率まで収集します。',
      hint: '多極カテーテル（多極スプライン／グリッド）は一度に広くなぞれます。視点を回すときはカテーテルの選択を解除します。穴の位置が「まだ点が足りない場所」です。',
      done: (c) => c.ui.laCoveragePct >= c.ui.coverageTargetPct,
    },
    {
      id: 'pv-potential', title: '環状カテーテルで PV 電位を見る', target: 'catheters',
      instruction: '環状カテーテルを LSPV の中（口から少し奥）に置き、3 極以上を壁に接触させます。EGM の CIRC の列に、鋭い PV 電位が出ます。',
      hint: 'ループ径を PV の太さ（15〜18 mm 程度）に合わせ、押し込み（ホイール）で接触させます。',
      done: (c) => c.goals.isAchieved('pv-potential'),
    },
    {
      id: 'voltage-map', title: '（任意）ボルテージマップを作る', target: 'map', optional: true,
      instruction: 'マップの表示を「ボルテージ」にして、取得点を 20 点以上集めます。PV 口のまわりの電位を見ておくと、通電の線を決めやすくなります。',
      hint: '「取得点を取得」か、多極カテーテルの自動取得を使います。とばしてもかまいません。',
      done: (c) => c.points.length >= 20,
    },
    {
      id: 'ablate-lspv', title: 'LSPV を隔離する', target: 'ablation',
      instruction: 'エネルギーを RF にして、ABL を LSPV の口の前庭部（口から 1 cm ほど LA 側）に当て、隙間なく一周するように通電します。',
      hint: '目安は 30 W・30 秒、点の間隔は約 5 mm 以内です。接触圧が低いと病変が浅くなります。貫壁性の表示も見てください。',
      done: (c) => isolatedPvs(c.engine).includes('LSPV'),
    },
    {
      id: 'all-pvs', title: '残りの PV も隔離する', target: 'ablation',
      instruction: 'LIPV・RSPV・RIPV も同じように一周して隔離します。右の 2 本は口が近いので、間の部分（carina）にも隙間を残さないようにします。',
      hint: 'ゴール一覧に隔離できた本数が出ます。',
      done: (c) => c.goals.isAchieved('isolation'),
    },
    {
      id: 'entrance', title: '4 本の PV で entrance block を確かめる', target: 'catheters',
      instruction: '環状カテーテルを 4 本の PV に 1 本ずつ入れ、PV 電位が消えたか、LA と無関係なリズムで出ている（解離）ことを確かめます。確かめた PV にチェックが付きます。',
      hint: 'トリガーのある LSPV・RSPV は、隔離後も PV の中だけで発火が続きます（解離した PV 電位）。実臨床でも見られる所見です。',
      done: (c) => c.goals.isAchieved('entrance'),
      items: (c) => c.goals.itemStatus('entrance', c.goals.context(c.engine, c.points)).map((x) => ({ label: x.label, done: x.done })),
    },
    {
      id: 'exit-block', title: 'exit block を確かめる', target: 'stimulation',
      instruction: '隔離した PV に環状カテーテルを置き、刺激部位を「環状（1-2）」にして刺激します。PV の中は捕捉されますが（局所の捕捉）、LA・CS には伝わりません。',
      hint: '刺激の方法はバーストでもかまいません。環状カテーテルが壁に接触していないと捕捉しません。',
      done: (c) => c.goals.isAchieved('exit-block'),
    },
    {
      id: 'cure', title: '根治を判定する', target: 'cure',
      instruction: '「根治を判定」を押し、4 本の entrance block・exit block と、AF が止まったことを確かめます。',
      hint: '判定に ✗ が残ったら、その PV の線の隙間を探して焼き足します。',
      done: (c) => c.ui.cureOk,
    },
  ],
};

export const TUTORIALS: Tutorial[] = [PVI_TUTORIAL];

/**
 * 現在の手順 index から、完了している手順をとばして次の未完了の手順へ進める（順番に、とばさずに判定する）。
 * すべて完了したら steps.length を返す。
 */
export function advanceTutorial(t: Tutorial, index: number, ctx: TutorialContext): number {
  let i = index;
  while (i < t.steps.length && t.steps[i].done(ctx)) i++;
  return i;
}
