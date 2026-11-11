import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { readUrl } from './state/url';

// URL パラメータ（症例・刺激プロトコル）を、最初の描画の前に 1 回だけ読む
readUrl();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
