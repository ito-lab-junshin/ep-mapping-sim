import { useEffect, useState } from 'react';
import { useSim } from '../state/store';
import { useEngine } from '../state/engine';
import { PV_NAMES } from '../core/geometry/regions';
import { pvGaps } from '../core/arrhythmia/pv';

/**
 * 隙間のヒント（教育用の補助。実機にはない機能）：チェックと PV ごとの状態。
 * 通電の欄（AF の症例）と PVI のチュートリアルの隔離の手順で同じ設定を共有する。オンのとき 3D に隙間の印（GapMarkers）が出る
 */
export function PvGapPanel() {
  const on = useSim((s) => s.gapHint);
  const set = useSim((s) => s.setGapHint);
  const engine = useEngine();
  const [, force] = useState(0);
  // オンの間は 1 秒ごとに状態を計算し直す
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
  return (
    <div className="gap-hint">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> 隙間のヒントを表示（教育用の補助。実機にはない機能）
      </label>
      {on && (
        <ul className="gap-status">
          {PV_NAMES.map((pv) => {
            const g = pvGaps(engine, pv);
            const text = g.isolated ? '隔離' : g.touchesLesion ? '未隔離・隙間の印あり' : g.encircled > 0 ? `未隔離・一周の約 ${Math.round(g.encircled * 100)} %` : '未隔離・まだ焼いていない';
            return <li key={pv} className={g.isolated ? 'ok' : ''}>{g.isolated ? '✓' : '・'} {pv}：{text}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
