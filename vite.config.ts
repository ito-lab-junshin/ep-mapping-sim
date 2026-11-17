import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://<user>.github.io/<repo>/ 配下で動くため base をリポジトリ名に合わせる。
// リポジトリ名を変えた場合はここも変更すること。
export default defineConfig({
  plugins: [react()],
  // ライブラリを別ファイルに分ける（並行して読み込め、公開し直してもライブラリ分はブラウザのキャッシュに残る）
  build: {
    // three.js 本体（約 690 kB）はこれ以上分けられないので、警告の上限を合わせる
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/')) return 'three';
          if (/[\\/](@react-three|three-stdlib|react-reconciler|its-fine|suspend-react|react-use-measure)[\\/]/.test(id)) return 'react-three';
          if (/[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  base: process.env.GITHUB_PAGES ? '/ep-mapping-sim/' : '/',
  // 単体テスト（vitest）は src の *.test.ts だけ。e2e/ は Playwright（npm run e2e）
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
