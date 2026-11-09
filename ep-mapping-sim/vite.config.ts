import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<user>.github.io/<repo>/ 配下で動くため base をリポジトリ名に合わせる。
// リポジトリ名を変えた場合はここも変更すること。
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? '/ep-mapping-sim/' : '/',
  test: { environment: 'node' },
});
