import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { readUrl } from './state/url';
import { installE2eHooks } from './state/e2eHooks';

// URL パラメータ（症例・刺激プロトコル）を、最初の描画の前に 1 回だけ読む
readUrl();
// E2E テスト用の口（URL に ?e2e=1 を付けたときだけ。docs/DESIGN.md §13）
installE2eHooks();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
