import { useEffect, useState, type ReactNode } from 'react';
import limitationsMd from '../../docs/LIMITATIONS.md?raw';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';

/**
 * 免責（docs/DESIGN.md §14）と既知の単純化と限界（docs/LIMITATIONS.md、§13）。
 * 要約は操作パネルに常に出し、「このシミュレータについて」で全文を開く。
 * LIMITATIONS はビルド時に Markdown をそのまま取り込む（文書を直せば画面も揃う）。
 */

/** §14 の免責文（設計書と同じ文。変えるときは設計書も直す） */
export const DISCLAIMER = [
  '本シミュレータは教育目的であり、実際の診療判断・機器操作の代替ではない。',
  '画面構成・用語は各社製品の印象を参考にした非公式のものであり、各社の承認・提携を受けていない。',
  '病変モデル・電気生理モデルは教育用に単純化した近似である。',
];

const TRADEMARKS = 'CARTO®（Biosense Webster / J&J MedTech）、EnSite™（Abbott）、OPAL HDx™（Boston Scientific）は各社の商標。本アプリの「CARTO 風」「EnSite 風」「OPAL HDx 風」は公開情報から受ける画面の印象を再現した非公式のテーマで、内部アルゴリズムは再現していない。';

/** Markdown の行内の `コード` を <code> にする */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/).map((t, i) => (t.startsWith('`') && t.endsWith('`') ? <code key={i}>{t.slice(1, -1)}</code> : t));
}

/** LIMITATIONS.md の箇条書き（「- 」で始まる行）と段落 */
function parseLimitations(md: string): { intro: string[]; items: string[] } {
  const intro: string[] = [], items: string[] = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('# ') || !line.trim()) continue;
    if (line.startsWith('- ')) items.push(line.slice(2));
    else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
    else intro.push(line.trim());
  }
  return { intro, items };
}

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
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const { items } = parseLimitations(limitationsMd);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="about-backdrop" onClick={onClose}>
      <div className="about" role="dialog" aria-modal="true" aria-label="このシミュレータについて"
        style={{ background: theme.colors.panel, color: theme.colors.text, borderColor: theme.colors.accent }}
        onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <h2>このシミュレータについて</h2>
          <button onClick={onClose}>閉じる</button>
        </div>
        <h3>免責</h3>
        {DISCLAIMER.map((t) => <p key={t}>{t}</p>)}
        <h3>商標</h3>
        <p>{TRADEMARKS}</p>
        <h3>既知の単純化と限界</h3>
        <p className="note">値の多くは仮定値（教育用近似）です。出典を一次資料で確認できた値だけに出典を記しています。</p>
        <ul>{items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>
      </div>
    </div>
  );
}
