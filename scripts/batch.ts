/**
 * 一括実行（研究用、docs/DESIGN.md §4.3）。
 *   npm run batch -- 条件.json [結果.csv]
 * 結果の CSV を出す（出力先を省くと標準出力）。条件の書き方は docs/RESEARCH.md。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch, toCsv, type BatchConfig } from '../src/core/research/batch';

const [configPath, outPath] = process.argv.slice(2).filter((a) => a !== '--');
if (!configPath) {
  console.error('使い方：npm run batch -- 条件.json [結果.csv]');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as BatchConfig;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const started = new Date();
const rows = runBatch(cfg, (r, i, n) => {
  console.error(`[${i + 1}/${n}] ${r.id} ${r.scenario} 誘発 ${r.induced ? 'あり' : 'なし'}${r.tachyClMs ? `（周期長 ${Math.round(r.tachyClMs)} ms）` : ''}`);
});
const csv = toCsv(rows, cfg, {
  name: cfg.name ?? '',
  version: pkg.version,
  started: started.toISOString(),
  finished: new Date().toISOString(),
  config_file: configPath,
  node: process.version,
});
if (outPath) { writeFileSync(outPath, csv); console.error(`書き出し：${outPath}（${rows.length} 行）`); } else process.stdout.write(csv);
