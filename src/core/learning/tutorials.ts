import type { ArrhythmiaId, GeometryMode, MapPoint } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import type { GoalTracker } from './GoalTracker';
import { isolatedPvs } from '../arrhythmia/pv';
import { protocolEvents } from './conditions';

/**
 * チュートリアル（docs/DESIGN.md §11・Phase 6）：手順を順に示し、完了条件を満たしたら次へ進む。
 * Phase 6 で PVI（RF）、Phase 7 で通常型 AFL（反時計回り・時計回り）・AVNRT・WPW を加えた。
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
    /** 利用者が「確認した」を押した手順の id（見るだけの手順） */
    confirmed: ReadonlySet<string>;
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
  /** 見るだけの手順：このボタンを押したら完了（done の代わり） */
  confirmLabel?: string;
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

/** 症例を選ぶ手順 */
const chooseScenario = (id: ArrhythmiaId, label: string, why: string): TutorialStep => ({
  id: 'scenario', title: '症例を選ぶ', target: 'scenario',
  instruction: `「不整脈」で「${label}」を選びます。${why}`,
  hint: '操作パネルのいちばん上の「不整脈」の選択肢です。',
  done: (c) => c.ui.arrhythmia === id,
});

/** 見るだけの手順（「確認した」で完了） */
const look = (id: string, title: string, target: TutorialTarget, instruction: string, hint: string): TutorialStep => ({
  id, title, target, instruction, hint, confirmLabel: '確認した', done: (c) => c.ui.confirmed.has(id),
});

const cure: TutorialStep = {
  id: 'cure', title: '根治を判定する', target: 'cure',
  instruction: '「根治を判定」を押し、すべての基準が ✓ になることを確かめます。',
  hint: '✗ が残ったら、その基準の説明を読んで足りない操作を行います。',
  done: (c) => c.ui.cureOk,
};

/** 通常型 AFL（反時計回り・時計回り）。向き以外は同じ手順 */
function aflTutorial(direction: 'ccw' | 'cw'): Tutorial {
  const ccw = direction === 'ccw';
  const scenario: ArrhythmiaId = ccw ? 'afl_cti' : 'afl_cti_cw';
  const name = ccw ? '通常型心房粗動（CTI、反時計回り）' : '通常型心房粗動（CTI、時計回り）';
  return {
    id: ccw ? 'afl-ccw' : 'afl-cw', title: ccw ? '通常型 AFL（反時計回り）' : '通常型 AFL（時計回り）', scenario,
    steps: [
      chooseScenario(scenario, name, 'ハロー 20 極が三尖弁輪の側壁に、CS 10 極が CS に置かれています。'),
      {
        id: 'induce', title: '粗動を誘発する', target: 'stimulation',
        instruction: ccw
          ? '刺激の方法を「バースト」、部位を「CS 口」にして刺激を始めます。CTI は不応期が長く、中隔側 → 側壁側に通れないため、反時計回りの旋回が始まります。'
          : '刺激の方法を「バースト」、部位を「低位外側 RA」にして刺激を始めます。CTI は側壁側 → 中隔側に通れず、時計回りの旋回が始まります。',
        hint: '刺激をやめて 5 秒ほど続くと「頻拍」と判定されます。II 誘導の基線のない粗動波も見てください。',
        done: (c) => c.engine.rhythm.state === 'tachycardia',
      },
      {
        id: 'direction', title: '旋回方向を答える', target: 'goals',
        instruction: ccw
          ? 'EGM でハローと CS の順序を読みます。反時計回りでは H 19-20 → H 1-2（側壁を下行）→ CTI → CS 9-10 → CS 1-2 の順です。ゴール一覧の設問で旋回方向を選びます。'
          : 'EGM でハローと CS の順序を読みます。時計回りでは CS 9-10 → CS 1-2 と同じころに CTI → H 1-2 → H 19-20（側壁を上行）の順です。ゴール一覧の設問で旋回方向を選びます。',
        hint: 'CS はどちらの向きでも近位 → 遠位です。見分けるのはハローの向きと、ハローの遠位（H 1-2）と CS 口（CS 9-10）のどちらが先かです。反対向きの症例と見比べると分かりやすくなります。',
        done: (c) => c.goals.isAchieved('direction'),
      },
      {
        id: 'lat-map', title: '（任意）RA の LAT マップを作る', target: 'map', optional: true,
        instruction: 'マップの表示を「LAT」にして、三尖弁輪のまわりで 20 点以上取得します。色が弁輪を一周し、最早期と最遅が隣り合う（early meets late）ことを確かめます。',
        hint: '頻拍中は WOI が周期長に合わせて自動で調整されます。とばしてもかまいません。',
        done: (c) => c.points.length >= 20,
      },
      {
        id: 'cti-line', title: 'CTI に線を引く', target: 'ablation',
        instruction: 'ABL を三尖弁輪側の CTI に置き、IVC まで点状の通電を並べて連続した線にします。',
        hint: '三尖弁輪側は壁が厚い（5 mm）ので、30 W では貫壁しにくくなります。40 W か、接触圧を上げた長めの通電にします。貫壁性の表示を見ながら進めます。',
        done: (c) => c.goals.isAchieved('cti-line'),
      },
      {
        id: 'bidirectional', title: '両方向性ブロックを確かめる', target: 'stimulation',
        instruction: '「CS 口」から刺激してハローが近位（H 19-20）→ 遠位（H 1-2）の順に下行すること、「低位外側 RA」（または「ハロー遠位」）から刺激して CS 口が遅れて興奮することを確かめます。',
        hint: '線の後に、両側から 1 回ずつ刺激プロトコルを行います。',
        done: (c) => c.goals.isAchieved('bidirectional'),
      },
      cure,
    ],
  };
}

export const AFL_CCW_TUTORIAL = aflTutorial('ccw');
export const AFL_CW_TUTORIAL = aflTutorial('cw');

export const AVNRT_TUTORIAL: Tutorial = {
  id: 'avnrt', title: 'AVNRT（遅伝導路）', scenario: 'avnrt',
  steps: [
    chooseScenario('avnrt', 'AVNRT（遅伝導路）', '速伝導路と遅伝導路の 2 つの経路をもつ房室結節の症例です。'),
    {
      id: 'his', title: 'His 束電位を記録する', target: 'catheters',
      instruction: 'His カテーテルの遠位を三尖弁輪の His 部位に接触させ、HIS d に A・H・V の 3 つの電位が出ることを確かめます。His 部位が Koch 三角の頂点です。',
      hint: 'カテーテル欄で His を選び、経路上の位置を調整します。',
      done: (c) => c.goals.isAchieved('his'),
    },
    {
      id: 'ah-jump', title: 'AH ジャンプを確かめる', target: 'stimulation',
      instruction: '刺激の方法を「期外刺激」、部位を「HRA」にして刺激を始めます。S2 を短くしていくと、速伝導路の不応期で AH が 50 ms 以上延びます（遅伝導路への乗り換え）。',
      hint: '刺激パネルの結果の表で、AH の列を見ます。',
      done: (c) => c.goals.isAchieved('ah-jump'),
    },
    {
      id: 'induced', title: '頻拍の A と V を見る', target: 'stimulation',
      instruction: 'ジャンプに続いてエコーから頻拍が誘発されます。頻拍中は A と V がほぼ同時（slow-fast）で、HIS d・CS で A が V に重なることを確かめます。',
      hint: '誘発されなかったら、S3 を加えるか、期外刺激をもう一度行います。',
      done: (c) => protocolEvents(c.goals.context(c.engine, c.points)).some((e) => e.status === 'induced'),
    },
    {
      id: 'junctional', title: '遅伝導路で通電する', target: 'ablation',
      instruction: 'ABL を Koch 三角の後下方（CS 口と三尖弁輪の間）に置き、RF で通電します。接合部調律が出ることを確かめます。',
      hint: 'His 部位に近づきすぎると注意が出ます（房室ブロックの危険）。CS 口の高さより下で通電します。',
      done: (c) => c.goals.isAchieved('junctional'),
    },
    {
      id: 'noninducible', title: '非誘発を確かめる', target: 'stimulation',
      instruction: '通電の後に、同じ期外刺激をもう一度行い、頻拍が誘発されないことを確かめます。',
      hint: '速伝導路は保たれるので、長い連結期の AH は変わりません。',
      done: (c) => c.goals.isAchieved('noninducible'),
    },
    cure,
  ],
};

export const WPW_TUTORIAL: Tutorial = {
  id: 'wpw', title: 'WPW（左側自由壁の副伝導路）', scenario: 'wpw',
  steps: [
    chooseScenario('wpw', 'WPW（副伝導路）', '僧帽弁輪の側方（左側自由壁）に副伝導路がある症例です。'),
    look('delta', 'デルタ波と短い PR を見る', 'goals',
      '洞調律の体表 ECG で、PR が短く、QRS の立ち上がりがなだらか（デルタ波）なことを確かめます。V1 で陽性、I で陰性または平坦なデルタ波は左側自由壁の副伝導路を示します。',
      'EGM パネルの最上段が体表 ECG です。フリーズしてキャリパーで PR を測ってもかまいません。'),
    {
      id: 'rv-pacing', title: 'RV 刺激で偏心性の心房興奮を見る', target: 'stimulation',
      instruction: '刺激の部位を「RV（心室）」にして刺激します。副伝導路を逆行して、CS の遠位（CS 1-2）が近位より先に興奮する（偏心性）ことを確かめます。',
      hint: '期外刺激でもバーストでもかまいません。',
      done: (c) => protocolEvents(c.goals.context(c.engine, c.points), ['RV']).length > 0,
    },
    {
      id: 'earliest', title: '心房の最早期部位を見つける', target: 'map',
      instruction: 'RV 刺激中（または頻拍中）に、ABL か多極カテーテルで僧帽弁輪の側方を中心に 5 点以上取得し、LAT マップで最早期の部位を見つけます。',
      hint: '最早期の点が副伝導路の心房付着部です。洞調律では最早期は洞結節になるので、逆行性の興奮中に取ります。',
      done: (c) => c.goals.isAchieved('earliest'),
    },
    {
      id: 'ablate', title: '副伝導路を焼く', target: 'ablation',
      instruction: '最早期の部位に ABL を置き、RF で通電します。通電中にデルタ波が消えることを見ます。',
      hint: '僧帽弁輪の縁に近い部位です。',
      done: (c) => c.goals.isAchieved('ap-ablation'),
    },
    {
      id: 'delta-gone', title: 'デルタ波の消失と非誘発を確かめる', target: 'stimulation',
      instruction: '洞調律でデルタ波が消え、PR が正常になったことを見て、CS 遠位からの期外刺激で頻拍が誘発されないことを確かめます。',
      hint: '刺激の部位は「CS 遠位（1-2）」です。',
      done: (c) => c.goals.isAchieved('delta-gone'),
    },
    cure,
  ],
};

export const TUTORIALS: Tutorial[] = [PVI_TUTORIAL, AFL_CCW_TUTORIAL, AFL_CW_TUTORIAL, AVNRT_TUTORIAL, WPW_TUTORIAL];

/**
 * 現在の手順 index から、完了している手順をとばして次の未完了の手順へ進める（順番に、とばさずに判定する）。
 * すべて完了したら steps.length を返す。
 */
export function advanceTutorial(t: Tutorial, index: number, ctx: TutorialContext): number {
  let i = index;
  while (i < t.steps.length && t.steps[i].done(ctx)) i++;
  return i;
}
