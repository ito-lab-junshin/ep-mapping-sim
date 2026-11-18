import type { ArrhythmiaId, CaseOptions, EnergyId, GeometryMode, MapPoint } from '../types';
import type { SimulationEngine } from '../sim/SimulationEngine';
import type { GoalTracker } from './GoalTracker';
import { isolatedPvs } from '../arrhythmia/pv';
import { protocolEvents } from './conditions';
import { AF_TYPE_LABEL } from '../arrhythmia/af';

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
    /** 選んでいるエネルギー */
    energy: EnergyId;
    /** 収集モードの心房ごとの被覆率 %（LA・RA） */
    coveragePct: Record<'LA' | 'RA', number>;
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
  /** confirmLabel のボタンを出す条件（省略時は常に出す。例：症例を選んだ後だけ「この症例で始める」） */
  ready?(ctx: TutorialContext): boolean;
  /** 収集モードで形を作る手順：その心房の被覆率の目安（設定）を表示する */
  coverage?: 'LA' | 'RA';
  /** この手順で「隙間のヒントを表示」（PV の隙間の候補、教育用の補助）を選べる */
  gapHint?: boolean;
  /** 1 つずつチェックを付ける項目（例：PV ごとの entrance block） */
  items?(ctx: TutorialContext): { label: string; done: boolean }[];
  done(ctx: TutorialContext): boolean;
}

export interface Tutorial {
  id: string; title: string; scenario: ArrhythmiaId; steps: TutorialStep[];
  /** 症例の選択肢（例：AF の型）。手順 1 で選ぶもの */
  caseOptions?: CaseOptions;
}

/** 収集モードで LA の形を作る目安 % の既定値と、設定で選べる範囲（仮定値） */
export const TUTORIAL_LA_COVERAGE_PCT = 70;
export const TUTORIAL_COVERAGE_RANGE_PCT = [30, 95] as const;

/**
 * 症例を選ぶ手順は、選んだ後に「この症例で始める」を押して完了する（すでに選ばれていても、手順 1 の説明を読まずに進まないように。QA の所見 12）
 */
const START_LABEL = 'この症例で始める';

/** 再伝導の確認（浮腫・再伝導）：根治判定の前に、待機時間かアデノシン負荷で再伝導がないことを確かめる */
const reconnection: TutorialStep = {
  id: 'reconnection', title: '再伝導を確かめる（待機・アデノシン）', target: 'ablation',
  instruction: '通電の直後は、病変の周りの浮腫で伝導が止まって見えることがあります。通電欄の「待機（20 分）」か「アデノシン負荷」を押し、伝導が戻らないか（再伝導）を確かめます。戻ったら、その部位に焼き足して、もう一度確かめます。',
  hint: '浮腫は処置の時計で引いていきます（時定数 15 分）。アデノシン負荷のあいだ（20 秒）は浮腫の効果が消え、浅い病変の所の伝導が見えます（休眠伝導）。',
  done: (c) => c.goals.isAchieved('reconnection'),
};

const pvPotential: TutorialStep = {
  id: 'pv-potential', title: '環状カテーテルで PV 電位を見る', target: 'catheters',
  instruction: '環状カテーテルを LSPV の中（口から少し奥）に置き、3 極以上を壁に接触させます。EGM の CIRC の列に、鋭い PV 電位が出ます。',
  hint: 'カテーテルを選んでいないときに 3D 上の管にマウスを乗せると、視野の隅に領域の名前（LSPV・LSPV 口など）が出ます。ループ径を PV の太さ（15〜18 mm 程度）に合わせ、押し込み（ホイール）で接触させます。',
  done: (c) => c.goals.isAchieved('pv-potential'),
};

const pvEntrance: TutorialStep = {
  id: 'entrance', title: '4 本の PV で entrance block を確かめる', target: 'catheters',
  instruction: '環状カテーテルを 4 本の PV に 1 本ずつ入れ、PV 電位が消えたか、LA と無関係なリズムで出ている（解離）ことを確かめます。確かめた PV にチェックが付きます。',
  hint: 'トリガーのある LSPV・RSPV は、隔離後も PV の中だけで発火が続きます（解離した PV 電位）。実臨床でも見られる所見です。',
  done: (c) => c.goals.isAchieved('entrance'),
  items: (c) => c.goals.itemStatus('entrance', c.goals.context(c.engine, c.points)).map((x) => ({ label: x.label, done: x.done })),
};

const pvExitBlock: TutorialStep = {
  id: 'exit-block', title: 'exit block を確かめる', target: 'stimulation',
  instruction: '隔離した PV に環状カテーテルを置き、刺激部位を「環状（1-2）」にして刺激します。PV の中は捕捉されますが（局所の捕捉）、LA・CS には伝わりません。',
  hint: '刺激の方法はバーストでもかまいません。環状カテーテルが壁に接触していないと捕捉しません。',
  done: (c) => c.goals.isAchieved('exit-block'),
};

const pvScenario: TutorialStep = {
  id: 'scenario', title: '症例を選ぶ', target: 'scenario',
  instruction: '「不整脈」で「心房細動（PVI）」を選びます。「AF の型」は「発作性（PV トリガー）」（既定）のままにします。PV（主に上肺静脈）の中のトリガーが高頻度に発火して AF が続いています。',
  hint: '操作パネルのいちばん上の「不整脈」の選択肢です。選ぶと「この症例で始める」が出ます。',
  confirmLabel: START_LABEL,
  ready: (c) => c.ui.arrhythmia === 'af' && (c.engine.caseOptions.afType ?? 'pv') === 'pv',
  done: (c) => c.ui.arrhythmia === 'af' && (c.engine.caseOptions.afType ?? 'pv') === 'pv' && c.ui.confirmed.has('scenario'),
};

const pvCure: TutorialStep = {
  id: 'cure', title: '根治を判定する', target: 'cure',
  instruction: '「根治を判定」を押し、4 本の entrance block・exit block と、AF が止まったことを確かめます。',
  hint: '判定に ✗ が残ったら、その PV の線の隙間を探して焼き足します。',
  done: (c) => c.ui.cureOk,
};

export const PVI_TUTORIAL: Tutorial = {
  id: 'pvi-rf',
  title: 'PVI（RF）',
  scenario: 'af',
  steps: [
    pvScenario,
    {
      id: 'geometry-mode', title: '収集モードにする', target: 'geometry',
      instruction: '「ジオメトリー」を収集モードにします。カテーテルでなぞった部分だけが形として現れ、なぞっていない場所は穴のままです。',
      hint: '「ジオメトリー」の選択肢で「〜で収集」を選びます。',
      done: (c) => c.ui.geometryMode === 'acquire',
    },
    {
      id: 'build-la', title: 'LA の形を作る', target: 'catheters',
      instruction: 'ABL か多極カテーテルを選び、3D 上でドラッグして LA の壁をなぞります。4 本の PV の口・天蓋・後壁・前壁・LAA を含めて、目安の被覆率まで収集します。',
      hint: '「3D 表示」の「もう一方の心房」を「表示しない」にすると、なぞっている途中で RA に移りません。ドラッグは心腔の上から始めます。視点を回すときはカテーテルの選択を解除してドラッグするか、3D の右下の視点のボタン（AP・PA・LAO・RAO・LL・RL・上）を使います。前・横・後ろから 3〜4 回なぞると目安に届きます。多極カテーテル（多極スプライン／グリッド）は一度に広くなぞれます。穴の位置が「まだ点が足りない場所」です。',
      coverage: 'LA',
      done: (c) => c.ui.coveragePct.LA >= c.ui.coverageTargetPct,
    },
    pvPotential,
    {
      id: 'voltage-map', title: '（任意）ボルテージマップを作る', target: 'map', optional: true,
      instruction: 'マップの表示を「ボルテージ」にして、取得点を 20 点以上集めます。PV 口のまわりの電位を見ておくと、通電の線を決めやすくなります。',
      hint: 'マップ欄の「〜を取得」ボタン（テーマで名前が変わります）か、多極カテーテルの自動取得を使います。とばしてもかまいません。',
      done: (c) => c.points.length >= 20,
    },
    {
      id: 'ablate-lspv', title: 'LSPV を隔離する', target: 'ablation',
      instruction: 'エネルギーを RF にして、ABL を LSPV の口の前庭部（口から 1 cm ほど LA 側）に当て、隙間なく一周するように通電します。PVI は洞調律でも AF 中でも行います。隔離の確認は、PV 電位の消失または解離（LA と無関係なリズム）で判定します。',
      hint: '目安は 30 W・30 秒、点の間隔は約 5 mm 以内です。1 つの向きからは口の半周ほどしか見えないので、視点を回して後ろ側も焼きます（3D の右下の「PA」「LL」が便利です。領域の名前「LSPV 口」を目安に）。一周しても隔離にならないときは、この欄の「隙間のヒントを表示」で、残っている通り道の位置を 3D に出せます（教育用の補助）。接触圧が低いと病変が浅くなります。貫壁性の表示も見てください。',
      gapHint: true,
      done: (c) => isolatedPvs(c.engine).includes('LSPV'),
    },
    {
      id: 'all-pvs', title: '残りの PV も隔離する', target: 'ablation',
      instruction: 'LIPV・RSPV・RIPV も同じように一周して隔離します。右の 2 本は口が近いので、間の部分（carina）にも隙間を残さないようにします。',
      hint: 'ゴール一覧に隔離できた本数が出ます。「隙間のヒントを表示」で、PV ごとの状態と残っている通り道の位置を見られます（教育用の補助）。',
      gapHint: true,
      done: (c) => c.goals.isAchieved('isolation'),
    },
    pvEntrance,
    pvExitBlock,
    reconnection,
    pvCure,
  ],
};

/** エネルギーを選ぶ手順（クライオバルーン・PFA の PVI） */
const chooseEnergy = (energy: EnergyId, label: string, why: string): TutorialStep => ({
  id: 'energy', title: `エネルギーを「${label}」にする`, target: 'ablation',
  instruction: `通電の欄の「エネルギー」で「${label}」を選びます。${why}`,
  hint: 'クライオバルーンと PFA は、この症例（AF）の PV 隔離だけで使えます。',
  done: (c) => c.ui.energy === energy,
});

/** 単発（single-shot）のデバイスで PV を 1 本ずつ隔離する手順 */
const singleShotPv = (id: string, title: string, instruction: string, hint: string, done: TutorialStep['done']): TutorialStep => ({
  id, title, target: 'ablation', instruction, hint, gapHint: true, done,
});

/**
 * クライオバルーンの PVI（Phase 6 の拡張）。形の収集は行わず既定の形で始める（クライオ・PFA は 3D マッピングを使わずに行うことも多い。先生と決定）
 */
export const CRYO_TUTORIAL: Tutorial = {
  id: 'pvi-cryo',
  title: 'PVI（クライオバルーン）',
  scenario: 'af',
  steps: [
    pvScenario,
    chooseEnergy('cryo', 'クライオバルーン', 'バルーン（28 mm）で PV の口をふさぎ、前庭部を一周まとめて冷凍します。形の収集は行わず、既定の形のまま進めます。'),
    pvPotential,
    singleShotPv('cryo-lspv', 'LSPV を冷凍する',
      '「標的の PV」を LSPV にし、「押し付け」を強く、「PV の軸とのずれ」を小さくして、閉塞度を 80 % 以上にします。閉塞がよいほど温度が下がり、口を一周する病変になります。「通電開始」で冷凍し、Time to isolation（隔離までの時間）と最低温度を見ます。',
      '閉塞度が 80 % 未満だと、漏れのある側に隙間が残り、隔離になりません。そのときは押し付けと軸を直して冷凍し直すか、エネルギーを RF に切り替えて隙間を焼き足します（タッチアップ）。「隙間のヒントを表示」で、残っている通り道の位置を見られます（教育用の補助）。隙間の印は PV の後ろ側にあることも多いので、3D の右下の「PA」「LL」で視点を変えて探します。',
      (c) => isolatedPvs(c.engine).includes('LSPV')),
    singleShotPv('cryo-all', '残りの PV も冷凍する',
      'LIPV・RSPV・RIPV も、閉塞度を 80 % 以上にして 1 本ずつ冷凍します。',
      'ゴール一覧に隔離できた本数が出ます。隔離にならない PV は、閉塞を直して冷凍し直すか、RF で焼き足します。',
      (c) => c.goals.isAchieved('isolation')),
    pvEntrance,
    pvExitBlock,
    reconnection,
    pvCure,
  ],
};

/**
 * PFA の PVI（Phase 6 の拡張）。形の収集は行わず既定の形で始める。PFA は浮腫を残さない（§7）
 */
export const PFA_TUTORIAL: Tutorial = {
  id: 'pvi-pfa',
  title: 'PVI（PFA）',
  scenario: 'af',
  steps: [
    pvScenario,
    chooseEnergy('pfa', 'パルスフィールド（PFA）', '電場で心筋だけを傷害する方法で、1 回の通電はごく短時間です。形の収集は行わず、既定の形のまま進めます。'),
    pvPotential,
    singleShotPv('pfa-lspv', 'LSPV に通電する',
      '「標的の PV」を LSPV にし、「カテーテルの形」を選んで「PFA 通電（1 回）」を押します。バスケット型は PV 口の縁の輪、フラワー型は前庭部まで覆う広い円盤の病変になります。このシミュレータでは、同じ PV に 2 回通電すると貫壁になります（教育用近似）。',
      '1 回だけでは貫壁にならず、隔離になりません。もう 1 回通電します。形を変えて、病変の広がりの違いも見てください。',
      (c) => isolatedPvs(c.engine).includes('LSPV')),
    singleShotPv('pfa-all', '残りの PV にも通電する',
      'LIPV・RSPV・RIPV にも、それぞれ 2 回ずつ通電します。',
      'ゴール一覧に隔離できた本数が出ます。',
      (c) => c.goals.isAchieved('isolation')),
    pvEntrance,
    pvExitBlock,
    {
      ...reconnection,
      hint: 'PFA は浮腫を残さないので、待機しても病変は変わりません（RF・クライオとの違い）。アデノシン負荷か待機のどちらかで確かめれば先へ進みます。',
    },
    pvCure,
  ],
};

/** （任意）収集モードで心房の形を作る手順（AVNRT は RA、WPW の左側自由壁は LA。被覆率の目安は設定の値） */
const buildOptional = (chamber: 'LA' | 'RA', what: string): TutorialStep => ({
  id: chamber === 'LA' ? 'build-la' : 'build-ra', title: `（任意）収集モードで ${chamber} の形を作る`, target: 'geometry', optional: true, coverage: chamber,
  instruction: `「ジオメトリー」を収集モードにし、ABL か多極カテーテルで ${chamber} の壁をなぞります。${what}を含めて、目安の被覆率まで集めます。`,
  hint: `「3D 表示」の「もう一方の心房」を「表示しない」にすると、なぞっている途中で反対側の心房に移りません。視点はカテーテルの選択を解除して回すか、3D の右下の視点のボタンを使います。とばしてもかまいません（既定の形のままでも先へ進めます）。`,
  done: (c) => c.ui.geometryMode === 'acquire' && c.ui.coveragePct[chamber] >= c.ui.coverageTargetPct,
});

/** （任意）para-Hisian 刺激で逆行性伝導の経路を見る（4-A。学習ゴール para-hisian の達成で完了） */
const paraHisianStep: TutorialStep = {
  id: 'para-hisian', title: '（任意）para-Hisian 刺激で逆行の経路を見る', target: 'stimulation', optional: true,
  instruction: '刺激パネルの「para-Hisian 刺激を行う」を押し、高出力（His と心室を捕捉、狭い QRS）と低出力（心室だけ、広い QRS）で、HRA・His 部位・CS 遠位の S-A を比べます。逆行性伝導の経路（房室結節か副伝導路か）を答えます。',
  hint: '房室結節を逆行するなら、低出力では His まで心室を回る分だけ S-A が延びます。副伝導路を逆行するなら、その付着部に近い部位の S-A は変わりません。部位によって変わり方が違うこともあります。',
  done: (c) => c.goals.isAchieved('para-hisian'),
};

/** （任意）エントレインメントで頻拍の機序を見分ける（4-B。学習ゴール entrainment の達成で完了） */
const entrainmentStep = (before: string, extraHint: string): TutorialStep => ({
  id: 'entrainment', title: '（任意）エントレインメントで頻拍の機序を見分ける', target: 'stimulation', optional: true,
  instruction: `${before}刺激パネルの「エントレインメント（頻拍中の右室刺激）」で、頻拍周期より 20 ms 短い周期で右室から刺激します。止めた後の反応（V-A-V か V-A-A-V か）と PPI − TCL・SA − VA を、画面の目安と比べて AVNRT・AVRT・AT のどれかを答えます。`,
  hint: `刺激で頻拍が止まったら誘発し直し、頻拍周期との差を変えて試します。${extraHint}`,
  done: (c) => c.goals.isAchieved('entrainment'),
});

/** 症例を選ぶ手順 */
const chooseScenario = (id: ArrhythmiaId, label: string, why: string): TutorialStep => ({
  id: 'scenario', title: '症例を選ぶ', target: 'scenario',
  instruction: `「不整脈」で「${label}」を選びます。${why}`,
  hint: '操作パネルのいちばん上の「不整脈」の選択肢です。選ぶと「この症例で始める」が出ます。',
  confirmLabel: START_LABEL,
  ready: (c) => c.ui.arrhythmia === id,
  done: (c) => c.ui.arrhythmia === id && c.ui.confirmed.has('scenario'),
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

/** AF の型を選ぶ手順（SVC トリガー・持続性 AF のチュートリアル） */
const afTypeScenario = (type: 'pvSvc' | 'persistent', label: string, why: string): TutorialStep => ({
  id: 'scenario', title: '症例を選ぶ', target: 'scenario',
  instruction: `「不整脈」で「心房細動（PVI）」を選び、「AF の型」を「${label}」にします。${why}`,
  hint: '操作パネルのいちばん上の「不整脈」と、その下の「AF の型」の選択肢です。選ぶと「この症例で始める」が出ます。',
  confirmLabel: START_LABEL,
  ready: (c) => c.ui.arrhythmia === 'af' && c.engine.caseOptions.afType === type,
  done: (c) => c.ui.arrhythmia === 'af' && c.engine.caseOptions.afType === type && c.ui.confirmed.has('scenario'),
});

/** PVI を 1 つの手順で（SVC トリガー・持続性 AF のチュートリアル。エネルギーは自由） */
const pviAll: TutorialStep = {
  id: 'pvi', title: 'PVI で 4 本の PV を隔離する', target: 'ablation',
  instruction: '4 本の PV を隔離します。エネルギーは RF・クライオバルーン・PFA のどれでもかまいません。',
  hint: 'クライオバルーン（閉塞度 80 % 以上で 1 本 1 回）や PFA（1 本 2 回）を使うと早く済みます。RF なら前庭部を一周します。「隙間のヒントを表示」で PV ごとの状態を見られます（教育用の補助）。',
  gapHint: true,
  done: (c) => c.goals.isAchieved('isolation'),
};

/**
 * AF（SVC トリガー）：PVI の後も AF が続く → SVC 電位を記録 → SVC を隔離 → AF の停止（Phase 7 の追補 AF-2 の症例）
 */
export const SVC_TUTORIAL: Tutorial = {
  id: 'af-svc',
  title: 'AF（SVC トリガー）',
  scenario: 'af',
  caseOptions: { afType: 'pvSvc' },
  steps: [
    afTypeScenario('pvSvc', AF_TYPE_LABEL.pvSvc, 'PV に加えて SVC の心筋スリーブにもトリガーがある症例です。形の収集は行わず、既定の形のまま進めます。'),
    pviAll,
    look('af-persists', 'PVI の後も AF が続くことを見る', 'goals',
      '4 本の PV を隔離しても AF が止まりません。PV 以外のトリガー（非 PV トリガー）を疑います。代表的な部位は SVC です。',
      '隔離した PV の中では、トリガーが LA と無関係に発火し続けます（解離）。'),
    {
      id: 'svc-potential', title: 'SVC 電位を記録する', target: 'catheters',
      instruction: '環状カテーテルを SVC の中（SVC–RA 接合部より上）に置き、3 極以上を壁に接触させます。速く不規則な SVC 電位が出ます。',
      hint: 'カテーテルを選んでいないときに 3D 上の管にマウスを乗せると、領域の名前（SVC）が出ます。ループ径を SVC の太さに合わせ、押し込み（ホイール）で接触させます。',
      done: (c) => c.goals.isAchieved('svc-potential'),
    },
    {
      id: 'svc-isolation', title: 'SVC を隔離する', target: 'ablation', gapHint: true,
      instruction: 'エネルギーを RF にして、SVC–RA 接合部より少し上（SVC 側）を一周するように通電します。',
      hint: 'SVC は管なので、1 つの向きからは前か後ろの半分しか焼けません。3D の右下の視点のボタンで AP・PA に加えて RL・LL からも見て、一周に隙間を残さないようにします（AP と PA だけでは横に隙間が残りました）。「隙間のヒントを表示」で、SVC の残っている通り道の位置を見られます（教育用の補助）。前外側の洞結節の近くと、後外側の右横隔神経の走行の近くでは注意が出ます。注意が出たら、その場所を避けるか、出力・時間を控えます（合併症は再現しません）。貫壁にならない浅い通電は、待機の後に再伝導します。通電の欄の貫壁性の表示も見てください。',
      done: (c) => c.goals.isAchieved('svc-isolation'),
    },
    {
      id: 'af-stopped', title: 'AF が止まったことを確かめる', target: 'goals',
      instruction: 'PV と SVC の隔離が終わると、トリガーは隔離された静脈の中だけで発火し、心房は洞調律に戻ります。調律の表示と EGM で確かめます。',
      hint: '頻拍の判定が解けるまで 5 秒ほどかかります。',
      done: (c) => c.goals.isAchieved('af-stopped'),
    },
    reconnection,
    cure,
  ],
};

/**
 * 持続性 AF：PVI の後も AF が続く → ボルテージマップで天蓋の低電位領域を見つける → channel を横切る RF → AF の停止（AF-3 の症例）
 */
export const PERSISTENT_TUTORIAL: Tutorial = {
  id: 'af-persistent',
  title: '持続性 AF（天蓋の低電位領域）',
  scenario: 'af',
  caseOptions: { afType: 'persistent' },
  steps: [
    afTypeScenario('persistent', AF_TYPE_LABEL.persistent, 'LA 天蓋の低電位領域（中心の瘢痕と、その周りの遅い伝導の輪）を回る旋回が AF を駆動している症例です。形の収集は行わず、既定の形のまま進めます。'),
    pviAll,
    look('af-persists', 'PVI の後も AF が続くことを見る', 'goals',
      '4 本の PV を隔離しても AF が止まりません。持続性 AF では、PV 以外の心房筋の基質が AF を保っていることがあります。',
      'EGM の CS は不規則な興奮（細動様の伝導）のままです。'),
    {
      id: 'lva-map', title: 'ボルテージマップで低電位領域を見つける', target: 'map',
      instruction: 'マップの表示を「ボルテージ」にし、多極カテーテルか ABL で LA の点を集めます。天蓋に 0.5 mV 未満の点が 5 点以上取れると完了です。中心は 0.1 mV 未満の瘢痕です。',
      hint: '多極カテーテルの自動取得を使うと早く集まります。天蓋は 3D の右下の「上」や「AP」から見やすくなります。クライオバルーン・PFA で PVI をした後は、PV の前庭部の広い病変も低電位（灰色）に見えます。病変タグのない、天蓋の中央の低電位領域を探します。',
      done: (c) => c.goals.isAchieved('lva-map'),
    },
    {
      id: 'roof-driver', title: '天蓋の旋回を止める', target: 'ablation',
      instruction: 'エネルギーを RF にして、中心の瘢痕の縁から外側の線維化の輪まで、遅い伝導の輪（channel）を横切るように点を並べて通電します。低電位領域を囲んで隔離してもかまいません。',
      hint: 'channel は瘢痕の外側の、0.1〜0.5 mV 程度の帯です。瘢痕と正常な心房のあいだを、隙間なく 1 本の線でつなぎます。',
      done: (c) => c.goals.isAchieved('roof-driver'),
    },
    {
      id: 'af-stopped', title: 'AF が止まったことを確かめる', target: 'goals',
      instruction: 'PVI と天蓋の旋回の通電が終わると、心房は洞調律に戻ります。調律の表示と EGM で確かめます。',
      hint: '頻拍の判定が解けるまで 5 秒ほどかかります。',
      done: (c) => c.goals.isAchieved('persistent-af-stopped'),
    },
    reconnection,
    cure,
  ],
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
        hint: 'CS はどちらの向きでも近位 → 遠位です。見分けるのはハローの向きと、ハローの遠位（H 1-2）と CS 口（CS 9-10）のどちらが先かです。反対向きの症例と見比べると分かりやすくなります。ハローの遠位（H 1-2）は EGM パネルの下のほうにあるので、パネルをスクロールして見ます。体表 ECG の粗動波は、通電欄の「アデノシン負荷」で房室結節を数秒止めると、QRS に重ならず見やすくなります（粗動は止まりません）。',
        done: (c) => c.goals.isAchieved('direction'),
      },
      {
        id: 'build-ra', title: '（任意）収集モードで RA の形を作る', target: 'geometry', optional: true, coverage: 'RA',
        instruction: '「ジオメトリー」を収集モードにし、ABL か多極カテーテルで RA の壁をなぞります。三尖弁輪・CTI・IVC の口・CS 口を含めて、目安の被覆率まで集めます。粗動中のまま行ってかまいません。',
        hint: '「3D 表示」の「もう一方の心房」を「表示しない」にすると、なぞっている途中で LA に移りません。視点はカテーテルの選択を解除して回すか、3D の右下の視点のボタン（RAO・LAO・上など）を使います。三尖弁輪の下側と CTI は、RAO と LAO の両方からなぞると集めやすくなります。とばしてもかまいません（既定の形のままでも先へ進めます）。',
        done: (c) => c.ui.geometryMode === 'acquire' && c.ui.coveragePct.RA >= c.ui.coverageTargetPct,
      },
      {
        id: 'lat-map', title: '（任意）RA の LAT マップを作る', target: 'map', optional: true,
        instruction: 'マップの表示を「LAT」にして、三尖弁輪のまわりで 20 点以上取得します。色が弁輪を一周し、最早期と最遅が隣り合う（early meets late）ことを確かめます。',
        hint: '頻拍中は WOI が周期長に合わせて自動で調整されます。とばしてもかまいません。',
        done: (c) => c.points.length >= 20,
      },
      {
        id: 'cti-line', title: 'CTI に線を引く', target: 'ablation',
        instruction: 'ABL を三尖弁輪側の CTI に置き、IVC まで点状の通電を並べて連続した線にします。粗動中に CTI へ通電するのが標準です。通電中に粗動が止まるのが良い所見で、その後に両方向性ブロックを確かめます。',
        hint: '三尖弁輪の縁から、ホバーで「IVC」と出る所まで隙間なく焼きます（IVC 側の端を残すと、そこを粗動が抜けます）。三尖弁輪側は壁が厚い（5 mm）ので、30 W では貫壁しにくくなります。40 W か、接触圧を上げた長めの通電にします。貫壁性の表示を見ながら進めます。線が完成しないときは「隙間のヒントを表示」で、残っている通り道の位置を見られます（教育用の補助）。',
        gapHint: true,
        done: (c) => c.goals.isAchieved('cti-line'),
      },
      {
        id: 'bidirectional', title: '両方向性ブロックを確かめる', target: 'stimulation',
        instruction: '「CS 口」から刺激してハローが近位（H 19-20）→ 遠位（H 1-2）の順に下行すること、「低位外側 RA」（または「ハロー遠位」）から刺激して CS 口が遅れて興奮することを確かめます。',
        hint: '線の後に、両側から 1 回ずつ刺激プロトコルを行います。',
        done: (c) => c.goals.isAchieved('bidirectional'),
      },
      reconnection,
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
    buildOptional('RA', 'Koch 三角（His 部位・CS 口・三尖弁輪の中隔側）'),
    paraHisianStep,
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
    entrainmentStep('頻拍が続いているあいだに行います。', '刺激で頻拍が止まらないときは、通電の前に「アデノシン負荷」で止めます（遅伝導路の通電は洞調律が標準）。'),
    {
      id: 'junctional', title: '遅伝導路で通電する', target: 'ablation',
      instruction: 'ABL を Koch 三角の後下方（CS 口と三尖弁輪の間、「遅伝導路部位」の領域の中）に置き、RF で通電します。洞調律で通電するのが標準で、通電中の接合部調律が目印です。接合部調律のときに VA ブロック（房室ブロックの兆候）が出たら、すぐ通電を止めます。',
      hint: '頻拍が続いているときは、通電欄の「アデノシン負荷」で止めます（房室結節が数秒止まり、AVNRT は房室結節を回路に含むので止まります）。His 部位に近づきすぎると注意が出ます（房室ブロックの危険）。CS 口の高さより下で通電します。遅伝導路は領域なので、一部だけ焼けた状態（修飾）でも、jump は残ってエコーが出ず非誘発になることがあります。',
      done: (c) => c.goals.isAchieved('junctional'),
    },
    {
      id: 'noninducible', title: '非誘発を確かめる', target: 'stimulation',
      instruction: '通電の後に、同じ期外刺激をもう一度行い、頻拍が誘発されないことを確かめます。',
      hint: '速伝導路は保たれるので、長い連結期の AH は変わりません。',
      done: (c) => c.goals.isAchieved('noninducible'),
    },
    reconnection,
    cure,
  ],
};

export const WPW_TUTORIAL: Tutorial = {
  id: 'wpw', title: 'WPW（左側自由壁の副伝導路）', scenario: 'wpw',
  steps: [
    {
      ...chooseScenario('wpw', 'WPW（副伝導路）', '「副伝導路の部位」は「左側自由壁」（既定）のままにし、「部位を伏せる」は外します。僧帽弁輪の側方に副伝導路がある症例です。'),
      ready: (c) => c.ui.arrhythmia === 'wpw' && c.engine.conduction.ap?.site === 'leftFreeWall' && !c.engine.caseOptions.apHidden,
      done: (c) => c.ui.arrhythmia === 'wpw' && c.engine.conduction.ap?.site === 'leftFreeWall' && !c.engine.caseOptions.apHidden && c.ui.confirmed.has('scenario'),
    },
    look('delta', 'デルタ波と短い PR を見る', 'goals',
      '洞調律の体表 ECG で、PR が短く、QRS の立ち上がりがなだらか（デルタ波）なことを確かめます。V1 で陽性、I で陰性または平坦なデルタ波は左側自由壁の副伝導路を示します。',
      'EGM パネルの最上段が体表 ECG です。フリーズしてキャリパーで PR を測ってもかまいません。'),
    {
      id: 'rv-pacing', title: 'RV 刺激で偏心性の心房興奮を見る', target: 'stimulation',
      instruction: '刺激の部位を「RV（心室）」にして刺激します。副伝導路を逆行して、CS の遠位（CS 1-2）が近位より先に興奮する（偏心性）ことを確かめます。',
      hint: '期外刺激でもバーストでもかまいません。',
      done: (c) => protocolEvents(c.goals.context(c.engine, c.points), ['RV']).length > 0,
    },
    paraHisianStep,
    buildOptional('LA', '僧帽弁輪（とくに側方）と、そのまわりの LA の壁'),
    entrainmentStep('まず刺激の部位を「CS 遠位（1-2）」にして期外刺激で AVRT を誘発し、頻拍が続いているあいだに行います。', '目安（Michaud ら）は、非典型 AVNRT と中隔の副伝導路の AVRT を比べた研究の値です。次の手順の最早期部位は、AVRT 中に取ってもかまいません。'),
    {
      id: 'earliest', title: '心房の最早期部位を見つける', target: 'map',
      instruction: 'RV 刺激中（または頻拍中）に、ABL か多極カテーテルで僧帽弁輪の側方を中心に 5 点以上取得し、LAT マップで最早期の部位を見つけます。',
      hint: '最早期の点が副伝導路の心房付着部です。洞調律では最早期は洞結節になるので、逆行性の興奮中に取ります。',
      done: (c) => c.goals.isAchieved('earliest'),
    },
    {
      id: 'ablate', title: '副伝導路を焼く', target: 'ablation',
      instruction: '最早期の部位に ABL を置き、RF で通電します。洞調律（デルタ波の消失を目印に）か心房ペーシング中に通電するのが標準です。AVRT 中の通電もできますが、頻拍が止まるときにカテーテルがずれやすいので注意します。',
      hint: '僧帽弁輪の縁に近い部位です。副伝導路は 1 本の束なので、心房側の付着部が病変に入れば伝導は途絶えます。頻拍が続いているときは、通電欄の「アデノシン負荷」で止められます（房室結節が数秒止まる。副伝導路は止まらないので、そのあいだの洞調律はデルタ波が最大になります）。',
      done: (c) => c.goals.isAchieved('ap-ablation'),
    },
    {
      id: 'delta-gone', title: 'デルタ波の消失と非誘発を確かめる', target: 'stimulation',
      instruction: '洞調律でデルタ波が消え、PR が正常になったことを見て、CS 遠位からの期外刺激で頻拍が誘発されないことを確かめます。',
      hint: '刺激の部位は「CS 遠位（1-2）」です。',
      done: (c) => c.goals.isAchieved('delta-gone'),
    },
    reconnection,
    cure,
  ],
};

export const AT_TUTORIAL: Tutorial = {
  id: 'at', title: '心房頻拍（巣状 AT）', scenario: 'at',
  steps: [
    chooseScenario('at', '心房頻拍（巣状 AT、分界稜）', 'RA のどこかに、速く発火する巣がある症例です。'),
    buildOptional('RA', 'RA の側壁（分界稜のあたり）・中隔・天蓋'),
    {
      id: 'induce', title: '頻拍を誘発する', target: 'stimulation',
      instruction: '刺激の方法を「バースト」、部位を「HRA」にして刺激を始めます。刺激をやめた後も頻拍が続けば誘発です。',
      hint: '刺激パネルの結果の表と、操作パネルの上の調律の表示（頻拍・周期長）を見ます。',
      done: (c) => c.goals.isAchieved('induced'),
    },
    look('activation', '頻拍の心房の興奮順序を見る', 'goals',
      '頻拍中の EGM で、HRA・His・CS の心房の興奮の順序と、A と V の関係を見ます。HRA が His・CS より早く、CS は近位から遠位へ興奮します。A から次の V までが短く、V から次の A までが長い頻拍（long RP）です。',
      'EGM パネルをフリーズして、キャリパーで A と V の間隔を測ってもかまいません。'),
    {
      id: 'adenosine-at', title: '（任意）アデノシン負荷で房室ブロックを見る', target: 'ablation', optional: true,
      instruction: '頻拍中に、通電欄の「アデノシン負荷」を押します。房室結節が数秒止まって心室の拍がなくなっても、心房の頻拍が続くことを確かめます（房室結節を回路に含む AVNRT・AVRT なら止まる）。',
      hint: 'アデノシン負荷の後に、EGM で A が続き V が抜けることを見て「確認した」を押します。臨床では、アデノシンで止まる巣状 AT もあります。',
      confirmLabel: '確認した',
      ready: (c) => c.goals.context(c.engine, c.points).events.some((e) => e.kind === 'adenosine'),
      done: (c) => c.ui.confirmed.has('adenosine-at'),
    },
    entrainmentStep('頻拍が続いているあいだに行います。', '止めた後に、心室の前に心房が何回興奮するか（V-A-V か V-A-A-V か）を見ます。'),
    {
      id: 'earliest', title: '心房の最早期部位を見つける', target: 'map',
      instruction: '頻拍中に、ABL か多極カテーテルで RA の壁を広く 5 点以上取得し、LAT マップで最も早い部位を見つけます。そこから興奮が同心円状に広がります。',
      hint: '早い部位が見つかったら、そのまわりを細かく取ります。最早期の点が巣です。',
      done: (c) => c.goals.isAchieved('earliest'),
    },
    {
      id: 'focus-ablation', title: '巣を焼く', target: 'ablation',
      instruction: '最早期の部位に ABL を置き、頻拍中に RF で通電します。通電中に頻拍が止まるのが良い所見です。',
      hint: '巣は 1 点なので、最早期の点に正確に当てます。頻拍が止まらなければ、マップを見直して最早期の部位を探し直します。',
      done: (c) => c.goals.isAchieved('focus-ablation'),
    },
    {
      id: 'noninducible', title: '非誘発を確かめる', target: 'stimulation',
      instruction: '通電の後に、HRA からもう一度バーストを行い、頻拍が誘発されないことを確かめます。',
      hint: '刺激の方法は「バースト」、部位は「HRA」です。',
      done: (c) => c.goals.isAchieved('noninducible'),
    },
    reconnection,
    cure,
  ],
};

export const TUTORIALS: Tutorial[] = [PVI_TUTORIAL, CRYO_TUTORIAL, PFA_TUTORIAL, SVC_TUTORIAL, PERSISTENT_TUTORIAL, AFL_CCW_TUTORIAL, AFL_CW_TUTORIAL, AVNRT_TUTORIAL, WPW_TUTORIAL, AT_TUTORIAL];

/**
 * 現在の手順 index から、完了している手順をとばして次の未完了の手順へ進める（順番に、とばさずに判定する）。
 * すべて完了したら steps.length を返す。
 */
export function advanceTutorial(t: Tutorial, index: number, ctx: TutorialContext): number {
  let i = index;
  while (i < t.steps.length && t.steps[i].done(ctx)) i++;
  return i;
}
