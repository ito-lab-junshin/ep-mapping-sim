# 研究用の拡張口（Phase 7）

教育用シミュレータの値は **教育用近似** である（`docs/DESIGN.md` §4.2・§7、`docs/LIMITATIONS.md`）。
ここに書く機能は、パラメータを変えたときのふるまいを系統的に調べるためのもので、結果を臨床の予測に使うことはできない。

## 1. 一括実行（Node、ブラウザ不要）

```bash
npm run batch -- examples/batch-afl-ra-cv.json results.csv
```

- 第 1 引数：条件の JSON、第 2 引数：結果の CSV（省くと標準出力）。進み具合は標準エラーに出る
- 条件（パラメータの組）ごとに 1 行。CSV の先頭に、実行時の設定（名前・版・開始／終了時刻・条件の JSON 全体・Node の版）を `# ` で始まるコメント行で残す

### 条件の JSON

```json
{
  "name": "AFL：RA の伝導速度と CTI の線",
  "scenario": "afl_cti",
  "base": { "AFL_SUBSTRATE.ctiCv": 0.3 },
  "sweep": { "AFL_SUBSTRATE.raCv": [0.5, 0.6, 0.8] },
  "conditions": [
    { "id": "rf30", "ablation": { "energy": "rf", "powerW": 30, "durationS": 30 } },
    { "id": "rf40", "ablation": { "energy": "rf", "powerW": 40, "durationS": 45 } }
  ],
  "induction": { "observeMs": 1000 },
  "inductionAfterAblation": true
}
```

| 項目 | 意味 |
|---|---|
| `scenario` | 既定の症例：`af`／`afl_cti`（反時計回り）／`afl_cti_cw`（時計回り）／`avnrt`／`wpw` |
| `base` | すべての条件に共通のパラメータの上書き |
| `sweep` | パラメータごとの値の列。直積で条件を作る |
| `conditions` | 明示した条件（`id`・`scenario`・`params`・`ablation`・`induction`）。`sweep` があれば各条件に掛ける。id は「条件の id-s番号」 |
| `ablation` | 症例ごとの標準の通電（下表）。省くと通電しない |
| `induction` | 誘発の刺激プロトコルの上書き（`s1Beats`・`s2StartMs`・`observeMs`・`site` など） |
| `inductionAfterAblation` | 通電の後にもう一度誘発を試す（既定 true） |

上書きは `base` → 条件の `params` → `sweep` の順に重なる。

### パラメータのキー

「グループ名.項目」で、`src/core/params.ts` の値を指す（入れ子は `.` でつなぐ）。数値か数値の配列（長さは元と同じ）。

| グループ | 例 |
|---|---|
| `CONDUCTION` | `CONDUCTION.atrialCv`、`CONDUCTION.bridgeCv.bachmann` |
| `AV_NODE` | `AV_NODE.fast.erpMs`、`AV_NODE.slow.ahMs` |
| `ACCESSORY_PATHWAY` | `ACCESSORY_PATHWAY.antegradeErpMs` |
| `AF_SUBSTRATE` | `AF_SUBSTRATE.triggerClMs`（配列 [最小, 最大]）、`AF_SUBSTRATE.pvSleeveCv` |
| `AFL_SUBSTRATE` | `AFL_SUBSTRATE.raCv`、`AFL_SUBSTRATE.ctiErpMs` |
| `ABLATION` | `ABLATION.rf.dose.powerExp`、`ABLATION.rf.saturationDepthMm`、`ABLATION.wallThicknessMm.ctiTv`、`ABLATION.cryo.fullRingOcclusion` |
| `PROTOCOL`・`RHYTHM` | `PROTOCOL.s1Ms`、`RHYTHM.sustainMs` |

すべてのキーと現在の値は、ブラウザの「研究用（JSON）」で書き出した JSON の `params` で確かめられる。

### 標準の通電（`ablation`）

| 症例 | RF | クライオ・PFA |
|---|---|---|
| AF | 4 本の PV の前庭部を一周（口の半径 + 3 mm、点の間隔 `spacingMm`、既定 5 mm） | PV ごと（クライオ：`push01`・`misalignDeg`・`durationS`、PFA：`shape`・`applications`） |
| AFL | CTI の線（三尖弁輪 → IVC、間隔 既定 4 mm） | — |
| AVNRT | 遅伝導路の部位 1 点 | — |
| WPW | 副伝導路の部位 1 点 | — |

RF は `powerW`・`durationS`・`heightMm`（先端の壁からの距離。接触圧はここから。既定 1 mm）。

### 出力の列

| 列 | 意味 |
|---|---|
| `id`・`scenario`・パラメータの列 | 条件 |
| `induced` | 誘発の成否（1／0） |
| `tachy_cl_ms` | 頻拍の周期長 |
| `p_wave_ms` | 洞調律 1 拍の両心房の総興奮時間（最初の興奮 → 最後の頂点の興奮。P 波幅の指標。AF のトリガーは止めて測る） |
| `energy`・`power_w`・`duration_s`・`height_mm`・`spacing_mm`・`push01`・`misalign_deg`・`pfa_shape`・`pfa_applications` | 通電の条件 |
| `lesions`・`transmurality_min_pct`・`transmurality_mean_pct` | 病変の数と、病変の中心の貫壁性 % |
| `isolated_pvs`・`pvi_complete` | 隔離できた PV の数と PVI の完了（AF のみ） |
| `induced_after_ablation` | 通電の後の誘発 |

## 2. 症例の状態の書き出し・読み込み（ブラウザ）

操作パネルの「研究用（JSON）」：パラメータ（上書きできる全項目）・カテーテルの配置・病変（頂点ごとの貫壁性と病変タグ）を JSON にする。
読み込むと、パラメータを反映して症例を作り直し、配置と病変を戻す。パラメータはページを再読み込みすると既定に戻る。
形式は `src/core/research/caseState.ts` の `CaseState`（`format: "ep-mapping-sim/case"`、`version: 1`）。

## 3. 伝播モデルの差し替え

`CellularAutomaton` の公開 API（`stimulate()`／`step()`／`reset()`）を保ったまま、反応拡散モデルに置き換えられるようにする方針は §4.3 のとおり（未実装）。
