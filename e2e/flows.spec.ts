import { test, expect, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { advance, chooseCase, expectNoErrors, open, select, state } from './helpers';

/** 刺激プロトコルが終わるまで早送りする（最大 maxMs） */
async function runProtocol(page: Page, maxMs = 240_000) {
  for (let t = 0; t < maxMs; t += 5000) {
    await advance(page, 5000);
    const s = await page.locator('.stim .map-message').textContent().catch(() => '');
    if (s && /誘発されました|非誘発|停止しました/.test(s)) return s;
  }
  return page.locator('.stim .map-message').textContent();
}

test('マップ：点を取得 → LAT・ボルテージ・伝播の表示とカラーバー → 消去', async ({ page }) => {
  const o = await open(page, 'case=avnrt');
  const take = page.getByRole('button', { name: /を取得$/ });
  const wall: number[] = await page.evaluate(() => (window as any).__ep.points.laWall(6));
  for (const v of wall) {
    await page.evaluate((x) => (window as any).__ep.place('abl', { vertex: x }), v);
    await advance(page, 900);
    await take.click();
  }
  await expect.poll(async () => (await state(page)).points).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.map-message')).toContainText('取得');
  const mode = select(page, '表示モード');
  for (const v of ['lat', 'voltage', 'propagation']) {
    await mode.selectOption(v);
    await expect(page.locator('.legend')).toBeVisible();
  }
  await mode.selectOption('live');
  await page.locator('.map-controls').getByRole('button', { name: '消去' }).click();
  await expect.poll(async () => (await state(page)).points).toBe(0);
  expectNoErrors(o);
});

test('刺激：AVNRT で推奨の期外刺激を始めると、早送りで「誘発」と結果の表（AH・エコー）が出る', async ({ page }) => {
  const o = await open(page, 'case=avnrt');
  await expect(page.locator('.stim')).toContainText('推奨：期外刺激');
  await page.getByRole('button', { name: '刺激を開始' }).click();
  const msg = await runProtocol(page);
  expect(msg).toContain('誘発されました');
  await expect(page.locator('.stim-table tbody tr').first()).toBeVisible();
  await expect.poll(async () => (await state(page)).rhythm).toBe('tachycardia');
  expectNoErrors(o);
});

test('通電・浮腫・根治判定：WPW の副伝導路に画面のボタンで RF → 病変タグ・指標 → 待機・アデノシン → 根治判定の項目', async ({ page }) => {
  const o = await open(page, 'case=wpw');
  // 未治療の根治判定は ✗
  await page.getByRole('button', { name: '根治を判定' }).click();
  await expect(page.locator('.checks li.ng').first()).toBeVisible();
  await page.evaluate(() => { const ep = (window as any).__ep; ep.place('abl', ep.points.apMid()); });
  await select(page, '通電の時計').selectOption('10');
  await page.getByRole('button', { name: '通電開始' }).click();
  await expect(page.getByRole('button', { name: '通電停止' })).toBeVisible();
  await expect(page.locator('.ablation-metrics')).toContainText('貫壁性');
  await advance(page, 4000);
  await expect(page.locator('.ablation')).toContainText('病変タグ 1 個');
  // 浮腫・再伝導の欄
  await expect(page.locator('.reconnection')).toContainText(/浮腫のある頂点 [1-9]/);
  await page.getByRole('button', { name: '待機 20 分' }).click();
  await expect(page.locator('.reconnection')).toContainText(/処置の時計 2\d\.\d 分/);
  await page.getByRole('button', { name: 'アデノシン負荷' }).click();
  await expect(page.locator('.reconnection')).toContainText('アデノシン負荷中');
  await advance(page, 21000);
  await expect(page.locator('.reconnection')).not.toContainText('アデノシン負荷中');
  await advance(page, 2500);
  await page.getByRole('button', { name: '根治を判定' }).click();
  await expect(page.locator('.checks')).toContainText('再伝導');
  await expect(page.locator('.checks li', { hasText: '副伝導路の部位に病変' })).toHaveClass(/ok/);
  expectNoErrors(o);
});

test('通電の注意：前中隔の副伝導路で His、AF（SVC トリガー）の洞結節で洞結節の注意が出る', async ({ page }) => {
  const o = await open(page, 'case=wpw&ap=anteroseptal');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.place('abl', ep.points.apMid()); });
  await page.getByRole('button', { name: '通電開始' }).click();
  await expect(page.locator('.ablation-metrics .warn')).toContainText('His');
  await page.getByRole('button', { name: '通電停止' }).click();
  await chooseCase(page, 'af');
  await select(page, 'AF の型').selectOption('pvSvc');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.place('abl', { anchor: 'sinusNode' }); });
  await page.getByRole('button', { name: '通電開始' }).click();
  await expect(page.locator('.ablation-metrics .warn')).toContainText('洞結節');
  await page.getByRole('button', { name: '通電停止' }).click();
  expectNoErrors(o);
});

test('クライオ・PFA：AF でクライオバルーンを 1 回、PFA を 2 回（回数の表示）', async ({ page }) => {
  const o = await open(page, 'case=af');
  const energy = select(page, 'エネルギー');
  await energy.selectOption('cryo');
  await select(page, '標的の PV').selectOption('RSPV');
  await select(page, '通電の時計').selectOption('10');
  await page.getByRole('button', { name: '通電開始' }).click();
  await expect(page.locator('.ablation-metrics')).toContainText('閉塞度');
  await advance(page, 25000);
  await expect(page.locator('.ablation')).toContainText('病変タグ 1 個');
  await energy.selectOption('pfa');
  await select(page, '標的の PV').selectOption('LSPV');
  const pfa = page.getByRole('button', { name: 'PFA 通電（1 回）' });
  await pfa.click(); await pfa.click();
  await expect(page.locator('.ablation-metrics')).toContainText('LSPV に 2 回目');
  await expect(page.locator('.ablation')).toContainText('病変タグ 3 個');
  expectNoErrors(o);
});

test('URL：症例・選択肢・刺激プロトコルが URL に入り、開き直すと戻る', async ({ page }) => {
  const o = await open(page, 'case=wpw&ap=rightFreeWall&kind=extrastimulus&site=CS_PROX&s1=500&n=6&s2=400&s2min=200');
  await expect.poll(async () => (await state(page)).apSite).toBe('rightFreeWall');
  await expect(page.locator('.stim label', { hasText: '部位' }).locator('select')).toHaveValue('CS_PROX');
  await expect(page.locator('.stim')).toContainText('500 ms');
  await chooseCase(page, 'af');
  await select(page, 'AF の型').selectOption('persistent');
  await expect(page).toHaveURL(/case=af/);
  await expect(page).toHaveURL(/aftype=persistent/);
  // 画面の URL には症例・選択肢・刺激プロトコルだけが残る（テスト用の e2e=1 は付け直す）
  const url = new URL(page.url());
  expect(url.searchParams.get('e2e')).toBeNull();
  url.searchParams.set('e2e', '1');
  await page.goto(url.toString());
  await page.waitForFunction(() => !!(window as any).__ep);
  await expect.poll(async () => (await state(page)).afType).toBe('persistent');
  expectNoErrors(o);
});

test('研究用 JSON：書き出し → 症例のリセット → 読み込みで、病変・浮腫・処置の時計が戻る', async ({ page }, info) => {
  const o = await open(page, 'case=wpw');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.ablateRf([ep.points.apMid()], 30, 30); });
  await page.getByRole('button', { name: '待機 10 分' }).click();
  const before = await state(page);
  expect(before.lesions).toBe(1);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '症例を JSON で書き出す' }).click();
  // 保存先は短い ASCII のパスにする（日本語の長いテスト名の出力フォルダだと、ファイル選択への受け渡しが失敗した）
  const file = path.join(os.tmpdir(), `ep-case-${info.workerIndex}-${Date.now()}.json`);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: '症例をリセット' }).click();
  await expect.poll(async () => (await state(page)).lesions).toBe(0);
  // 作り直した症例のエンジンが 3D の時計で進んでいる（リセットの後に古いエンジンを進め続ける不具合の回帰）
  await expect.poll(async () => (await state(page)).time, { timeout: 15_000 }).toBeGreaterThan(500);
  // 利用者と同じ操作：「JSON を読み込む」→ ファイルの選択
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'JSON を読み込む' }).click();
  await (await chooser).setFiles(file);
  await expect(page.locator('.research')).toContainText('読み込みました');
  const after = await state(page);
  expect(after.lesions).toBe(1);
  expect(after.edemaVertices).toBe(before.edemaVertices);
  // 処置の時計は読み込みの後もシミュレーション時間で少し進む
  expect(Math.abs(after.procedureMin - before.procedureMin)).toBeLessThan(0.5);
  expectNoErrors(o);
});

test('収集モード：カテーテルを動かすと収集した面が増え、被覆率が上がる', async ({ page }) => {
  const o = await open(page, 'case=af');
  await select(page, 'ジオメトリー').selectOption('acquire');
  await expect(page.locator('.coverage')).toBeVisible();
  const c0 = (await state(page)).laCoveragePct;
  // 3D の収集（100 ms ごと）に任せて、ABL を LA の壁に沿って動かす
  for (let v = 0; v < 3000; v += 150) {
    await page.evaluate((x) => (window as any).__ep.place('abl', { vertex: x }), v);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await state(page)).laCoveragePct).toBeGreaterThan(c0 + 5);
  await page.getByRole('button', { name: '収集した形を消去' }).click();
  await expect.poll(async () => (await state(page)).laCoveragePct).toBeLessThan(1);
  expectNoErrors(o);
});
