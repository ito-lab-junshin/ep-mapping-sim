import { useEffect, useState } from 'react';
import { useSim } from '../state/store';
import { useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';
import type { GapHint } from '../core/types';

/** 隙間のヒント 1 項目の状態の文言 */
export function gapHintText(g: GapHint): string {
  if (g.complete) return g.completeLabel;
  if (g.showGaps) return `${g.incompleteLabel}・隙間の印あり`;
  if (g.coverage > 0) return `${g.incompleteLabel}・${g.coverageLabel}の約 ${Math.round(g.coverage * 100)} %`;
  return `${g.incompleteLabel}・まだ焼いていない`;
}

/**
 * 隙間のヒント（教育用の補助。実機にはない機能）：チェックと項目ごとの状態（AF は PV 4 本、AFL は CTI の線。症例の gapHints）。
 * 通電の欄とチュートリアルの通電の手順で同じ設定を共有する。オンのとき 3D に隙間の印（GapMarkers）が出る
 */
export function GapHintPanel() {
  const on = useSim((s) => s.gapHint);
  const set = useSim((s) => s.setGapHint);
  const arrhythmia = useSim((s) => s.arrhythmia);
  const engine = useEngine();
  const [, force] = useState(0);
  // オンの間は 1 秒ごとに状態を計算し直す
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
  const hints = SCENARIOS[arrhythmia].gapHints;
  if (!hints) return null;
  return (
    <div className="gap-hint">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> 隙間のヒントを表示（教育用の補助。実機にはない機能）
      </label>
      {on && (
        <ul className="gap-status">
          {hints(engine).map((g) => (
            <li key={g.name} className={g.complete ? 'ok' : ''}>{g.complete ? '✓' : '・'} {g.name}：{gapHintText(g)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
