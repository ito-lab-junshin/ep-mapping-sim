import { useSim } from '../state/store';
import { setCaseOptions } from '../state/engine';
import { AP_SITE_IDS, type ApSite } from '../core/params';
import { AP_SITES, apSiteOf } from '../core/arrhythmia/wpw';
import type { ArrhythmiaId } from '../core/types';

/**
 * 症例の選択肢（docs/DESIGN.md §5.4）：WPW の副伝導路の部位と、部位を伏せるか。
 * 変えると症例を作り直す（病変・取得点・ゴールは消える）。
 * 部位を伏せると無作為に選び、学習ゴールに「体表 ECG から部位を推定する」設問が加わる。
 */
export function CaseOptionsPanel() {
  const arrhythmia = useSim((s) => s.arrhythmia);
  const options = useSim((s) => s.caseOptions[s.arrhythmia]);
  if (arrhythmia !== 'wpw') return null;
  const site = apSiteOf(options);
  const hidden = !!options?.apHidden;
  const id: ArrhythmiaId = 'wpw';

  const choose = (apSite: ApSite) => setCaseOptions(id, { apSite, apHidden: false });
  const hide = (on: boolean) => {
    if (!on) { setCaseOptions(id, { apSite: site, apHidden: false }); return; }
    const random = AP_SITE_IDS[Math.floor(Math.random() * AP_SITE_IDS.length)];
    setCaseOptions(id, { apSite: random, apHidden: true });
  };

  return (
    <div className="case-options">
      {hidden
        ? <p className="note">副伝導路の部位：伏せています（無作為に選びました）。体表 ECG（12 誘導）のデルタ波とマップから推定してください。</p>
        : (
          <label>副伝導路の部位
            <select value={site} onChange={(e) => choose(e.target.value as ApSite)}>
              {AP_SITE_IDS.map((s) => <option key={s} value={s}>{AP_SITES[s].label}（{AP_SITES[s].where}）</option>)}
            </select>
          </label>
        )}
      <label className="check">
        <input type="checkbox" checked={hidden} onChange={(e) => hide(e.target.checked)} /> 部位を伏せる（無作為に選び、ECG から推定する設問を出す）
      </label>
      {hidden && <p className="note">チェックを外すと部位が表示されます（答え合わせ）。部位を変えると症例は最初の状態に戻ります。</p>}
    </div>
  );
}
