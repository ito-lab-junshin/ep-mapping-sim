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
- 次は **Phase 4（4 シナリオ：基質・誘発・根治判定・刺激プロトコル）**。

## 決定済み事項（再確認不要）

- 解剖メッシュ：まずパラメトリック自作（設計書 §9.1）。glTF ローダは Phase 7。
- 解剖寸法：AF シナリオは afRemodeled、それ以外は normal。
- 伝導：一般心房筋 1.0 mm/ms、洞調律では優先伝導路なし。ボルテージ閾値の既定は 0.1 mV・0.5 mV（慣用値・出典未確認）。
- マップ：カテーテルで取得した点からの補間。補間の到達距離（fill threshold 相当）は UI で変更可能。方向非依存 EGM は Phase 3、接触圧・局所インピーダンスは Phase 5。出典を一次資料で確認できない値は「仮定値（教育用近似）」と書き、推測で出典名を書かない。
- 体表 ECG：誘導数を 1／3／12 から選択可能。Phase 1 で 1・3 誘導、12 誘導は Phase 7（それまで「準備中」表示）。
- 刺激プロトコル：教科書的既定値（S1 600 ms × 8、S2 は 10 ms 刻み。設計書 §5.6）。

## 質問すべきこと（例）

- パラメトリック形状の寸法（PV 口径・LA 径など）を文献値のどれに合わせるか
- 専門家レビューで指摘された内容の優先順位
- 設計書にない電気生理パラメータを新設するとき
