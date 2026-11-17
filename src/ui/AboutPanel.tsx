import { lazy, Suspense, useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';

/**
 * 免責（docs/DESIGN.md §14）の要約を操作パネルに常に出し、「このシミュレータについて」で全文（AboutDialog）を開く。
 * 全文は LIMITATIONS.md を含むので、開いたときに読み込む（ビルドの分割）
 */
const AboutDialog = lazy(() => import('./AboutDialog'));

/** 操作パネルの上に常に出す免責の要約と、全文を開くボタン */
export function DisclaimerBar() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="disclaimer-bar">
        教育目的の非公式シミュレータです。実際の診療判断・機器操作の代替ではありません。
        <button className="link" style={{ color: theme.colors.accent }} onClick={() => setOpen(true)}>このシミュレータについて</button>
      </p>
      {open && <Suspense fallback={null}><AboutDialog onClose={() => setOpen(false)} /></Suspense>}
    </>
  );
}

