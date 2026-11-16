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
  const gaps = page.locator('.tutorial .gap-status');
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

/** 4 本の PV に環状カテーテルを 1 本ずつ入れて entrance block を確かめる → 環状からの刺激で exit block */
async function entranceAndExit(page: Page) {
  await expectStep(page, '4 本の PV で entrance block を確かめる');
  for (const pv of ['LSPV', 'LIPV', 'RSPV', 'RIPV']) {
    await page.evaluate((x) => (window as any).__ep.place('circ', { pv: x }, { diameterMm: 15 }), pv);
    await expect.poll(async () => (await page.locator('.tutorial .tutorial-items li.ok', { hasText: pv }).count()) > 0
      || (await title(page).textContent()) !== '4 本の PV で entrance block を確かめる', { timeout: 30_000 }).toBe(true);
  }
  await expectStep(page, 'exit block を確かめる');
  await runStim(page, 'burst', 'CIRC');
  await advance(page, 6000);
}

/** 画面の操作で、クライオバルーン（既定の押し付け 100 %・ずれ 0°、180 秒）か PFA（2 回）を PV に行う */
async function singleShot(page: Page, energy: 'cryo' | 'pfa', pv: string) {
  await select(page, '標的の PV').selectOption(pv);
  if (energy === 'cryo') {
    await page.getByRole('button', { name: '通電開始' }).click();
    for (let t = 0; t < 60_000 && await page.getByRole('button', { name: '通電停止' }).count(); t += 5000) await advance(page, 5000);
  } else {
    const b = page.getByRole('button', { name: 'PFA 通電（1 回）' });
    await b.click(); await b.click();
  }
}

for (const [name, energy, label] of [['PVI（クライオバルーン）', 'cryo', 'LSPV を冷凍する'], ['PVI（PFA）', 'pfa', 'LSPV に通電する']] as const) {
  test(`チュートリアル：${name}`, async ({ page }) => {
    const o = await open(page);
    await startTutorial(page, name);
    await chooseCase(page, 'af');
    await beginCase(page);
    await expectStep(page, /^エネルギーを/);
    await select(page, 'エネルギー').selectOption(energy);
    if (energy === 'cryo') await select(page, '通電の時計').selectOption('10');
    // 形の収集の手順はなく、既定の形のまま PV 電位へ
    await expectStep(page, '環状カテーテルで PV 電位を見る');
    await page.evaluate(() => (window as any).__ep.place('circ', { pv: 'LSPV' }, { diameterMm: 15 }));
    await advance(page, 1500);
    await expectStep(page, label);
    await singleShot(page, energy, 'LSPV');
    await expectStep(page, /^残りの PV (も|にも)/);
    for (const pv of ['LIPV', 'RSPV', 'RIPV']) await singleShot(page, energy, pv);
    await entranceAndExit(page);
    await reconnectionAndCure(page);
    expectNoErrors(o);
  });
}

/** PVI をテスト用の口で（RF の一周を 4 本） */
async function pviByHook(page: Page) {
  await page.evaluate(() => { const ep = (window as any).__ep; for (const pv of ['LSPV', 'LIPV', 'RSPV', 'RIPV']) ep.ablateRf(ep.points.pvRing(pv)); });
}

/** AF が止まるまで早送りして「AF が止まったことを確かめる」を終える */
async function untilAfStops(page: Page) {
  // 通電の直後にすでに止まっていれば、この手順はすぐ終わって「再伝導」へ進む
  await expectStep(page, /^(AF が止まったことを確かめる|再伝導を確かめる)/);
  for (let t = 0; t < 60_000 && (await state(page)).rhythm === 'tachycardia'; t += 5000) await advance(page, 5000);
  await advance(page, 2000);
}

test('チュートリアル：AF（SVC トリガー）', async ({ page }) => {
  const o = await open(page);
  await startTutorial(page, 'AF（SVC トリガー）');
  await chooseCase(page, 'af');
  await select(page, 'AF の型').selectOption('pvSvc');
  await beginCase(page);
  await expectStep(page, 'PVI で 4 本の PV を隔離する');
  await pviByHook(page);
  await expectStep(page, 'PVI の後も AF が続くことを見る');
  await advance(page, 6000);
  expect((await state(page)).rhythm).toBe('tachycardia');
  await page.locator('.tutorial').getByRole('button', { name: '確認した' }).click();
  await expectStep(page, 'SVC 電位を記録する');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.place('circ', ep.points.svcInside(), { diameterMm: 20 }); });
  await advance(page, 3000);
  await expectStep(page, 'SVC を隔離する');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.ablateRf(ep.points.svcRing()); });
  await untilAfStops(page);
  await reconnectionAndCure(page);
  expectNoErrors(o);
});

test('チュートリアル：持続性 AF', async ({ page }) => {
  const o = await open(page);
  await startTutorial(page, '持続性 AF（天蓋の低電位領域）');
  await chooseCase(page, 'af');
  await select(page, 'AF の型').selectOption('persistent');
  await beginCase(page);
  await expectStep(page, 'PVI で 4 本の PV を隔離する');
  await pviByHook(page);
  await expectStep(page, 'PVI の後も AF が続くことを見る');
  await page.locator('.tutorial').getByRole('button', { name: '確認した' }).click();
  await expectStep(page, 'ボルテージマップで低電位領域を見つける');
  // ABL を channel の頂点に 1 点ずつ当てて点を取る（画面の「点を取得」と同じ）
  // （接触の条件や拍の取り直しで取れない点もあるので、低電位の点が 6 点そろうまで続ける）
  const vs: number[] = await page.evaluate(() => (window as any).__ep.points.roofChannel(30));
  for (const v of vs) {
    await page.evaluate((x) => (window as any).__ep.place('abl', { vertex: x }), v);
    await advance(page, 800);
    await page.evaluate(() => (window as any).__ep.acquire());
    const low = (await page.evaluate(() => (window as any).__ep.mapPoints())).filter((p: { voltageMv: number }) => p.voltageMv < 0.5).length;
    if (low >= 6) break;
  }
  await advance(page, 600);
  await expectStep(page, '天蓋の旋回を止める');
  await page.evaluate(() => { const ep = (window as any).__ep; ep.ablateRf(ep.points.channelCut()); });
  await untilAfStops(page);
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
    await expectStep(page, '（任意）収集モードで RA の形を作る');
    // 答えは達成した行に残り、チュートリアルには前の手順が出る（QA の所見 11）
    await expect(page.locator('.goals li.ok .answer-ok')).toContainText(`正解です（${answer}）`);
    await expect(page.locator('.tutorial-prev')).toContainText('旋回方向を答える ✓');
    if (dir === 'afl_cti') {
      // 反時計回りでは RA を収集する（時計回りではとばす）。被覆率の目安は RA の値で判定する
      await expect(page.locator('.tutorial')).toContainText('RA の被覆率の目安（設定）');
      await select(page, 'ジオメトリー').selectOption('acquire');
      await page.evaluate(() => (window as any).__ep.sweepRa(25));
      expect((await state(page)).raCoveragePct).toBeGreaterThan(70);
      expect((await state(page)).laCoveragePct).toBeLessThan(5);
    } else {
      await page.getByRole('button', { name: 'とばす（任意）' }).click();
    }
    await expectStep(page, '（任意）RA の LAT マップを作る');
    await page.getByRole('button', { name: 'とばす（任意）' }).click();
    await expectStep(page, 'CTI に線を引く');
    // 隙間のヒント（教育用の補助）：線の隣り合う 2 点（約 8 mm）を残すと隙間の印、残りを焼くと完成
    await page.locator('.tutorial').getByLabel(/隙間のヒントを表示/).check();
    const gaps = page.locator('.tutorial .gap-status');
    await expect(gaps).toContainText('CTI の線：未完成・まだ焼いていない');
    await page.evaluate(() => { const ep = (window as any).__ep; const pts = ep.points.ctiLine(4); ep.ablateRf(pts.filter((_: unknown, i: number) => i !== 3 && i !== 4), 40, 45); });
    await expect(gaps).toContainText('CTI の線：未完成・隙間の印あり', { timeout: 5000 });
    await page.evaluate(() => { const ep = (window as any).__ep; const pts = ep.points.ctiLine(4); ep.ablateRf([pts[3], pts[4]], 40, 45); });
    await expectStep(page, '両方向性ブロックを確かめる');
    await expect(page.locator('.ablation .gap-status')).toContainText('✓ CTI の線：完成');
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
  // His カテーテルは最初から His 部位にあるので、His の手順はすぐ終わる。（任意）RA の収集はとばす
  await expectStep(page, '（任意）収集モードで RA の形を作る');
  await page.getByRole('button', { name: 'とばす（任意）' }).click();
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
  await expectStep(page, '（任意）収集モードで LA の形を作る');
  await page.getByRole('button', { name: 'とばす（任意）' }).click();
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
