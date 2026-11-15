import { test, expect } from '@playwright/test';
import { chooseCase, egmRows, expectNoErrors, open, select, state } from './helpers';

test('起動：ページが開き、エラーがなく、免責の要約と「このシミュレータについて」がある', async ({ page }) => {
  const o = await open(page);
  await expect(page.getByText('教育目的の非公式シミュレータです')).toBeVisible();
  await page.getByRole('button', { name: 'このシミュレータについて' }).click();
  await expect(page.getByText('既知の単純化と限界').first()).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  expectNoErrors(o);
});

test('症例：5 症例と選択肢（AF の型・副伝導路の部位・部位を伏せる）を切り替えると症例が作り直され、EGM にチャンネルが出る', async ({ page }) => {
  const o = await open(page);
  for (const id of ['af', 'afl_cti', 'afl_cti_cw', 'avnrt', 'wpw']) {
    await chooseCase(page, id);
    await expect.poll(async () => (await state(page)).arrhythmia).toBe(id);
    expect((await egmRows(page)).n).toBeGreaterThan(5);
  }
  // WPW の副伝導路の部位
  await select(page, '副伝導路の部位').selectOption('posteroseptal');
  await expect.poll(async () => (await state(page)).apSite).toBe('posteroseptal');
  await expect(page).toHaveURL(/ap=posteroseptal/);
  await page.getByLabel(/部位を伏せる/).check();
  await expect(page.getByText('副伝導路の部位：伏せています')).toBeVisible();
  await expect(page).toHaveURL(/aphide=1/);
  await expect(page.locator('.goals')).toContainText('体表 ECG のデルタ波の極性から');
  // AF の型
  await chooseCase(page, 'af');
  for (const t of ['pvSvc', 'persistent', 'pv']) {
    await select(page, 'AF の型').selectOption(t);
    await expect.poll(async () => (await state(page)).afType).toBe(t);
  }
  expectNoErrors(o);
});

test('テーマ：3 システムを切り替えると「〜風」の名前と機能フラグの表示が変わり、免責は消えない', async ({ page }) => {
  const o = await open(page, 'case=avnrt');
  const sys = select(page, 'マッピングシステム');
  const names = await sys.locator('option').allTextContents();
  expect(names.every((n) => n.endsWith('風'))).toBe(true);
  const seen = new Set<string>();
  for (const v of await sys.locator('option').evaluateAll((os) => os.map((x) => (x as HTMLOptionElement).value))) {
    await sys.selectOption(v);
    await expect(page.getByText('教育目的の非公式シミュレータです')).toBeVisible();
    await expect(page.locator('.note', { hasText: '非公式テーマ' })).toBeVisible();
    seen.add(await page.locator('.ablation').innerText());
  }
  // 機能フラグ（接触圧・局所インピーダンス・病変指標）の出し分けで、通電欄の表示がテーマごとに違う
  expect(seen.size).toBeGreaterThan(1);
  expectNoErrors(o);
});

test('体表 ECG：1・3・12 誘導の切り替えで EGM パネルの体表 ECG の行が変わる', async ({ page }) => {
  const o = await open(page, 'case=avnrt');
  const leads = select(page, '体表 ECG');
  const counts: Record<string, number> = {};
  for (const v of ['1', '3', '12']) {
    await leads.selectOption(v);
    await expect.poll(async () => (await egmRows(page)).labels.filter((l) => /^(I|II|III|aVR|aVL|aVF|V[1-6])$/.test(l)).length).toBe(Number(v));
    counts[v] = (await egmRows(page)).n;
  }
  expect(counts['12']).toBeGreaterThan(counts['3']);
  expectNoErrors(o);
});
