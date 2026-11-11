# CLAUDE.md — Claude Code への指示

このリポジトリは「不整脈アブレーション 3D マッピング教育シミュレータ」。
仕様の正本は `docs/DESIGN.md`。迷ったら設計書を読み、設計書にない判断は**憶測で進めずユーザー（伊藤先生）に質問する**こと。

## 役割

あなたは不整脈専門医であり、同時にフロントエンド実装者である。電気生理の内容が設計書と矛盾する、または臨床的に不自然だと思ったら、実装前に指摘する。

## コマンド

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # vitest（src/core の単体テスト）
npm run lint     # tsc --noEmit
npm run build    # tsc -b && vite build
```

変更のたびに `npm run lint && npm run test` を通してからコミットする。

## 構成とルール

- `src/core/**` — UI 非依存の純 TypeScript。React / Three.js を import しない。必ず単体テストを添える。
- `src/systems/index.ts` — 3 システムの差（配色・用語・機能フラグ）はここだけに書く。UI で `if (system === 'carto')` は禁止。`theme.features.xxx` / `theme.terms.xxx` を使う。
- `src/three/**` — react-three-fiber。重い計算は core に置き、ここでは描画だけ。
- `src/ui/**` — React コンポーネント。文言は日本語、専門用語は実機慣習に合わせ英語併記。
- 単位は mm と ms。数値と単位の間は半角スペース（例：`250 ms`）。
- 型を変えたら `docs/DESIGN.md §3` も更新する。
- 商標（CARTO / EnSite / OPAL HDx）は必ず「〜風」と表記し、免責を消さない。

## 作業の進め方

1. `docs/DESIGN.md §12` の Phase 順に進める。1 Phase を 1 つの PR（またはコミット群）にする。
2. 各 Phase の最初に、実装計画（触るファイル・追加する型・テスト項目）を箇条書きで提示し、承認を得てから書き始める。
3. 電気生理パラメータ（伝導速度・ERP・病変径など）を新たに置くときは、設計書 §4.2 / §7 の表に追記し「教育用近似」であることをコメントに残す。
4. 完了した Phase は `docs/DESIGN.md §12` の表に ✅ を付ける。

## 現在の状態

- Phase 0 完了：雛形・CI（GitHub Pages）・設計書・楕円体メッシュ上のセルオートマトン・テーマ切り替え。
- Phase 1 完了：φ モデルの EGM（`src/core/egm`）、房室伝導（`src/core/conduction`）、体表 ECG（`src/core/ecg`、1・3 誘導、T 波あり）、`SimulationEngine`（`src/core/sim`）、EGM パネル（スイープ・ゲイン・フリーズ・キャリパー）、スライダーによるカテーテル配置。
- Phase 2 完了：パラメトリック両心房メッシュ（`src/core/geometry/parametric`、寸法は `dimensions.ts` の normal／afRemodeled）、領域ラベル（`regions.ts`）、心房間の連結、`ChamberLoader`・`MeshQuery`、カテーテル配置（経路：CS・His・HRA、自由：ABL・環状・多極、`src/core/catheter`）、3D 上のクリック・ドラッグ・ホイール操作。クライオバルーン・PFA の配置は Phase 5。
- Phase 2 の追補：セルオートマトンをイベント駆動＋三角形更新にして数値誤差を 5 % 以内に修正。一般心房筋 1.0 mm/ms（P 波幅 < 120 ms）。異方性伝導（`fiber` / `cvLongitudinal`）と連結ごとの伝導速度の仕組みを追加（洞調律では優先伝導路なし。分界稜の異方性は Phase 4 の AFL で設定）。
- Phase 3 完了：マッピング（`src/core/mapping`：点の取得・LAT/電位の注釈・方向非依存 EGM・補間・色・伝播再生・WOI の規則）、マップ表示（LAT／ボルテージ／伝播アニメーション）、カラーバー、取得点、マップの設定、テーマの用語・色・取得点の印の完全対応。
- Phase 4 完了：刺激伝導系（`src/core/conduction`：2 経路の房室結節・His・心室・副伝導路）、刺激装置と刺激プロトコル（`src/core/pacing`）、調律の判定（`src/core/rhythm`）、電気ベクトルの体表 ECG（デルタ波・ペーシング QRS）、4 シナリオ（`src/core/arrhythmia`。AF は PV トリガー、AFL は aflRemodeled、WPW の誘発は CS 遠位）、簡易通電、刺激パネル・根治判定・URL 共有。
- Phase 5 完了：病変モデル（`src/core/ablation`：頂点ごとの貫壁性 = 深さ / 壁厚、1 で遮断）、RF（§7 の式・接触圧・局所インピーダンス・独自の病変指標）、クライオバルーン（閉塞度・隙間・time-to-isolation）、PFA（バスケット／フラワー、2 回で貫壁性）、通電の状態機械（`engine.ablation`、通電の時計 1×/5×/10×）、接合部調律、His 近傍の警告、操作盤・3D のデバイスと病変タグ。簡易通電は UI から外した（テスト用に残す）。
- Phase 6 完了：収集モード（`src/core/geometry/acquisition.ts`、収集した部分だけを表示し未収集は穴）、学習ゴール判定（`src/core/learning`：`LearningGoal`・`GoalTracker`・出来事）、PVI（RF）のチュートリアル（`tutorials.ts`・`TutorialPanel`）、ハロー 20 極（AFL で三尖弁輪に置く、旋回方向の設問）、環状カテーテル・ハローからの刺激（非接触は捕捉しない）。
- 次は **Phase 7（専門家レビュー反映・12 誘導 ECG・glTF ローダ・研究用拡張口・AFL／AVNRT／WPW の詳細なチュートリアル）**。

## 決定済み事項（再確認不要）

- 解剖メッシュ：まずパラメトリック自作（設計書 §9.1）。glTF ローダは Phase 7。
- 解剖寸法：AF シナリオは afRemodeled、それ以外は normal。
- 伝導：一般心房筋 1.0 mm/ms、洞調律では優先伝導路なし。AFL の基質は RA 0.6 mm/ms（拡大した RA）。ボルテージ閾値の既定は 0.1 mV・0.5 mV（慣用値・出典未確認）。
- マップ：カテーテルで取得した点からの補間。補間の到達距離（fill threshold 相当）は UI で変更可能。方向非依存 EGM は Phase 3、接触圧・局所インピーダンスは Phase 5。出典を一次資料で確認できない値は「仮定値（教育用近似）」と書き、推測で出典名を書かない。
- 体表 ECG：誘導数を 1／3／12 から選択可能。Phase 1 で 1・3 誘導、12 誘導は Phase 7（それまで「準備中」表示）。
- 刺激プロトコル：教科書的既定値（S1 600 ms × 8、S2 は 10 ms 刻み。設計書 §5.6）。
- 収集モード：収集した部分だけを表示し、未収集は穴（楕円体・凸包からの変形は使わない）。チュートリアルは Phase 6 では PVI（RF）だけ、3 症例の詳細は Phase 7。AFL はハロー 20 極で旋回方向を読む。PVI の exit block は環状カテーテルからの刺激が標準（ABL も選べる）。収集の目安は被覆率 70 %（下げない。設定で変更可）。entrance block は 4 本すべての PV に環状カテーテルを置き、消失または解離を PV ごとにチェック。時計回りの AFL は Phase 7 の候補。
- 通電：病変の成長だけ倍速（既定 5×）、実効の倍速も表示し、通電時間はシミュレーション時間。壁厚 LA 2・PV 1.5・RA 2・Koch 2 mm、CTI は弁輪側 5 mm → IVC 側 3.5 mm（仮定値）。RF は通電量（出力・接触圧で重みづけ）を積算し、病変は飽和する。病変指標は独自尺度（部位の目標量 = 100 %：30 W・20 g で後壁 約 30 秒・前壁 約 40 秒、臨床経験に基づく教育用近似）で各社の目標値は使わない。指標 100 % で径 6〜8 mm・深さ 3〜4 mm。指標 100 % は貫壁を意味しないため、貫壁性（教育用の推定）を全テーマで別に表示する。目標の区分は LA の後半分（天蓋を除く）と Koch 三角が後壁、LA の前半分・天蓋・RA（CTI を含む）が前壁。合併症は再現せず His 近傍の注意だけ。クライオ・PFA は AF のみ。

## 質問すべきこと（例）

- パラメトリック形状の寸法（PV 口径・LA 径など）を文献値のどれに合わせるか
- 専門家レビューで指摘された内容の優先順位
- 設計書にない電気生理パラメータを新設するとき
