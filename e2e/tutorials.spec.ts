import { test, expect, type Page } from '@playwright/test';
import { advance, chooseCase, expectNoErrors, open, select, state } from './helpers';

/**
 * チュートリアル 5 本を、画面の指示どおりに最後まで進める。
 * 画面の操作（症例・選択肢の選択、刺激の開始、通電・待機・判定のボタン、設問への回答、手順の「確認した」「とばす」）は本物の操作で、
 * 3D 上のカテーテル操作と時間の早送り・多数点の通電だけをテスト用の口（window.__ep）で行う。
 */
test.describe.configure({ timeout: 600_000 });

const title = (page: Page) => page.locator('.tutorial-title');
async function expectStep(page: Page, t: string | RegExp, timeout = 30_000) {
  await expect(title(page)).toHaveText(t, { timeout });
}
async function startTutorial(page: Page, name: string) {
  await select(page, 'チュートリアル').selectOption({ label: name });
  await page.getByRole('button', { name: 'チュートリアルを始める' }).click();
  await expectStep(page, '症例を選ぶ');
}
/** 症例を選んだ後に「この症例で始める」を押す（押すまで手順 1 は終わらない） */
async function beginCase(page: Page) {
  await page.locator('.tutorial').getByRole('button', { name: 'この症例で始める' }).click();
}
async function expectDone(page: Page) {
  await expect(page.locator('.tutorial-head')).toContainText('完了', { timeout: 30_000 });
}

/** 刺激パネルで方法と部位を選んで始め、終わるまで早送りする */
async function runStim(page: Page, kind: 'extrastimulus' | 'burst', site: string, maxMs = 300_000) {
  await page.locator('.stim label', { hasText: '方法' }).locator('select').selectOption(kind);
  await page.locator('.stim label', { hasText: '部位' }).locator('select').selectOption(site);
  await page.getByRole('button', { name: '刺激を開始' }).click();
  for (let t = 0; t < maxMs; t += 5000) {
    await advance(page, 5000);
    const s = await page.locator('.stim .map-message').textContent().catch(() => '');
    if (s && /誘発されました|非誘発|停止しました/.test(s)) return s;
  }
  throw new Error('刺激プロトコルが終わらない');
}

/** 再伝導の確認（待機 20 分）→ 根治の判定 */
async function reconnectionAndCure(page: Page) {
  await expectStep(page, '再伝導を確かめる（待機・アデノシン）');
  await page.getByRole('button', { name: '待機 20 分' }).click();
  await expectStep(page, '根治を判定する');
  await advance(page, 3000);
  await page.getByRole('button', { name: '根治を判定' }).click();
  await expectDone(page);
}

test('チュートリアル：PVI（RF）', async ({ page }) => {
  const o = await open(page);
  await startTutorial(page, 'PVI（RF）');
  // 既定の症例が AF でも、手順 1 はすぐには終わらない（QA の所見 12）
  await advance(page, 1500);
  await expectStep(page, '症例を選ぶ');
  await chooseCase(page, 'af');
  await beginCase(page);
  await expectStep(page, '収集モードにする');
  await select(page, 'ジオメトリー').selectOption('acquire');
  await expectStep(page, 'LA の形を作る');
  await page.evaluate(() => (window as any).__ep.sweepLa(25));
  await expectStep(page, '環状カテーテルで PV 電位を見る');
  await page.evaluate(() => (window as any).__ep.place('circ', { pv: 'LSPV' }, { diameterMm: 15 }));
  await advance(page, 1500);
  await expectStep(page, '（任意）ボルテージマップを作る');
  await page.getByRole('button', { name: 'とばす（任意）' }).click();
  await expectStep(page, 'LSPV を隔離する');
  // 視点のプリセット（PA）と隙間のヒント（教育用の補助、QA の所見 6〜8）
  await page.locator('.view-presets').getByRole('button', { name: 'PA', exact: true }).click();
  const gaps = page.locator('.gap-status');
  await expect(gaps).toHaveCount(0);
  await page.locator('.tutorial').getByLabel(/隙間のヒントを表示/).check();
  await expect(gaps).toContainText('LSPV：未隔離・まだ焼いていない');
  // 一周のうち 1 点を残すと、隔離にならず、隙間の印が出る
  await page.evaluate(() => { const ep = (window as any).__ep; const pts = ep.points.pvRing('LSPV'); ep.ablateRf(pts.filter((_: unknown, i: number) => i !== 3)); });
  await expect(gaps).toContainText('LSPV：未隔離・隙間の印あり', { timeout: 5000 });
  await expectStep(page, 'LSPV を隔離する');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.ablateRf([ep.points.pvRing('LSPV')[3]]); });
  await expectStep(page, '残りの PV も隔離する');
  await expect(gaps).toContainText('✓ LSPV：隔離');
  await page.evaluate(() => { const ep = (window as any).__ep; for (const pv of ['LIPV', 'RSPV', 'RIPV']) ep.ablateRf(ep.points.pvRing(pv)); });
  await expectStep(page, '4 本の PV で entrance block を確かめる');
  for (const pv of ['LSPV', 'LIPV', 'RSPV', 'RIPV']) {
    await page.evaluate((x) => (window as any).__ep.place('circ', { pv: x }, { diameterMm: 15 }), pv);
    // その PV に ✓ が付く（最後の PV では ✓ と同時に次の手順へ進み、項目の一覧が消えることがある）
    await expect.poll(async () => (await page.locator('.tutorial-items li.ok', { hasText: pv }).count()) > 0
      || (await title(page).textContent()) !== '4 本の PV で entrance block を確かめる', { timeout: 30_000 }).toBe(true);
  }
  await expectStep(page, 'exit block を確かめる');
  await runStim(page, 'burst', 'CIRC');
  await advance(page, 6000);
  await reconnectionAndCure(page);
  expectNoErrors(o);
});

for (const [name, dir, answer] of [['通常型 AFL（反時計回り）', 'afl_cti', '反時計回り'], ['通常型 AFL（時計回り）', 'afl_cti_cw', '時計回り']] as const) {
  test(`チュートリアル：${name}`, async ({ page }) => {
    const o = await open(page);
    await startTutorial(page, name);
    await chooseCase(page, dir);
    await beginCase(page);
    await expectStep(page, '粗動を誘発する');
    // 推奨（症例ごとのバースト）のまま始める
    await page.getByRole('button', { name: '刺激を開始' }).click();
    for (let t = 0; t < 120_000 && (await state(page)).rhythm !== 'tachycardia'; t += 5000) await advance(page, 5000);
    await expectStep(page, '旋回方向を答える');
    await page.locator('.goals').getByRole('button', { name: answer, exact: true }).click();
    // 正解するとゴールに ✓ が付き、次のゴールへ進む
    await expect(page.locator('.goals li.ok').first()).toContainText('旋回方向を答える');
    await expectStep(page, '（任意）RA の LAT マップを作る');
    // 答えは達成した行に残り、チュートリアルには前の手順が出る（QA の所見 11）
    await expect(page.locator('.goals li.ok .answer-ok')).toContainText(`正解です（${answer}）`);
    await expect(page.locator('.tutorial-prev')).toContainText('旋回方向を答える ✓');
    await page.getByRole('button', { name: 'とばす（任意）' }).click();
    await expectStep(page, 'CTI に線を引く');
    await page.evaluate(() => { const ep = (window as any).__ep; ep.ablateRf(ep.points.ctiLine(4), 40, 45); });
    await expectStep(page, '両方向性ブロックを確かめる');
    await advance(page, 8000);
    await runStim(page, 'burst', 'CS_OS');
    await runStim(page, 'burst', 'LOW_LATERAL_RA');
    await reconnectionAndCure(page);
    expectNoErrors(o);
  });
}

test('チュートリアル：AVNRT', async ({ page }) => {
  const o = await open(page);
  await startTutorial(page, 'AVNRT（遅伝導路）');
  await chooseCase(page, 'avnrt');
  await beginCase(page);
  // His カテーテルは最初から His 部位にあるので、His の手順はすぐ終わる
  await expectStep(page, 'AH ジャンプを確かめる');
  await runStim(page, 'extrastimulus', 'HRA');
  await expectStep(page, '遅伝導路で通電する');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.place('abl', { anchor: 'slowPathway' }); });
  await select(page, '通電の時計').selectOption('5');
  await page.getByRole('button', { name: '通電開始' }).click();
  await advance(page, 2000);
  await expect(page.locator('.ablation-metrics')).toContainText('接合部調律');
  await expectStep(page, '非誘発を確かめる');
  await advance(page, 8000);
  await expect(page.getByRole('button', { name: '通電開始' })).toBeVisible();
  await runStim(page, 'extrastimulus', 'HRA');
  await reconnectionAndCure(page);
  expectNoErrors(o);
});

test('チュートリアル：WPW（左側自由壁）', async ({ page }) => {
  const o = await open(page);
  await startTutorial(page, 'WPW（左側自由壁の副伝導路）');
  await chooseCase(page, 'wpw');
  await beginCase(page);
  await expectStep(page, 'デルタ波と短い PR を見る');
  await page.locator('.tutorial').getByRole('button', { name: '確認した' }).click();
  await expectStep(page, 'RV 刺激で偏心性の心房興奮を見る');
  await runStim(page, 'extrastimulus', 'RV');
  await expectStep(page, '心房の最早期部位を見つける');
  // RV 刺激中に、ABL で僧帽弁輪の側方を 8 点取る（画面の「点を取得」ボタン）
  await page.locator('.stim label', { hasText: '方法' }).locator('select').selectOption('burst');
  await page.getByRole('button', { name: '刺激を開始' }).click();
  await advance(page, 3000);
  const rim: number[] = await page.evaluate(() => (window as any).__ep.points.mitralLateral(8, 3));
  for (const v of rim) {
    await page.evaluate((x) => (window as any).__ep.place('abl', { vertex: x }), v);
    await advance(page, 700);
    await page.getByRole('button', { name: /を取得$/ }).click();
  }
  await expectStep(page, '副伝導路を焼く');
  await page.locator('.stim').getByRole('button', { name: '停止', exact: true }).click();
  await page.evaluate(() => { const ep = (window as any).__ep; ep.ablateRf([ep.points.apMid()], 30, 30); });
  await expectStep(page, 'デルタ波の消失と非誘発を確かめる');
  await advance(page, 3000);
  await runStim(page, 'extrastimulus', 'CS_DIST');
  await reconnectionAndCure(page);
  expectNoErrors(o);
});
