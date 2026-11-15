import { expect, type Page } from '@playwright/test';

/**
 * E2E の共通処理。window.__ep（src/state/e2eHooks.ts、?e2e=1 のときだけ）は型を共有しないので、
 * page.evaluate の中では any として呼ぶ。
 */
export interface Opened { errors: string[] }

/** ページを開く（?e2e=1 を付ける）。コンソールのエラーとページの例外を集める */
export async function open(page: Page, query = ''): Promise<Opened> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const q = new URLSearchParams(query);
  q.set('e2e', '1');
  await page.goto(`/?${q.toString()}`);
  await page.waitForFunction(() => !!(window as any).__ep);
  await expect(page.locator('canvas').first()).toBeVisible();
  return { errors };
}

/** ラベル（文字）を含む <label> の中の <select> */
export const select = (page: Page, label: string) => page.locator('label', { hasText: label }).locator('select').first();

/** シミュレーションを早送りする */
export async function advance(page: Page, ms: number) {
  await page.evaluate((x) => (window as any).__ep.advance(x), ms);
}

/** 状態の要約 */
export async function state(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as any).__ep.state());
}

/** EGM パネルの行数とラベル */
export async function egmRows(page: Page): Promise<{ n: number; labels: string[] }> {
  const c = page.getByTestId('egm-canvas');
  const n = Number(await c.getAttribute('data-rows'));
  const labels = (await c.getAttribute('data-labels'))?.split(',') ?? [];
  return { n, labels };
}

/** 症例を選ぶ（画面の選択で） */
export async function chooseCase(page: Page, id: string) {
  await select(page, '不整脈').selectOption(id);
}

/** エラーがないこと（WebGL のソフトウェア描画の警告は除く） */
export function expectNoErrors(o: Opened) {
  const real = o.errors.filter((e) => !/GPU stall|WebGL|swiftshader|GL Driver/i.test(e));
  expect(real, real.join('\n')).toEqual([]);
}
