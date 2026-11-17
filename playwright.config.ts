import { defineConfig } from '@playwright/test';

/**
 * E2E テスト（docs/DESIGN.md §13）：本番と同じビルドを vite preview で開き、Chromium で画面の操作の流れを確かめる。
 * npm run e2e（ビルドしてから走らせる）。3D は WebGL をソフトウェアで描く（swiftshader）。
 * テスト用の口（window.__ep）は URL に ?e2e=1 を付けたときだけ出る（src/state/e2eHooks.ts）。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // テスト同士は独立しているので、ファイルの中でも並行して流す。手元（4 コア）は 4、CI は 3（2026-11-17 の計測：2 で約 4〜5 分、3 で 3.4 分、4 で 2.9 分）
  fullyParallel: true,
  workers: process.env.CI ? 3 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1400, height: 1000 },
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'off',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
