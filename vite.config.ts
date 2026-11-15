import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<user>.github.io/<repo>/ 配下で動くため base をリポジトリ名に合わせる。
// リポジトリ名を変えた場合はここも変更すること。
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? '/ep-mapping-sim/' : '/',
  // 単体テスト（vitest）は src の *.test.ts だけ。e2e/ は Playwright（npm run e2e）
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
