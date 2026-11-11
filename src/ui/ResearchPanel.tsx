import { useRef, useState } from 'react';
import { useSim } from '../state/store';
import { getEngine, resetCase, useEngine } from '../state/engine';
import { exportCase, importCase, isCaseState } from '../core/research/caseState';
import { setParams } from '../core/research/params';

/**
 * 研究用（Phase 7、docs/DESIGN.md §4.3）：パラメータと症例の状態（カテーテルの配置・病変）を JSON で書き出し・読み込みする。
 * 読み込むとパラメータを反映して症例を作り直し、配置と病変を戻す（パラメータはページを再読み込みすると既定に戻る）。
 * 条件を振った一括実行は Node で行う（npm run batch。docs/RESEARCH.md）。
 */
export function ResearchPanel() {
  const arrhythmia = useSim((s) => s.arrhythmia);
  const engine = useEngine();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([JSON.stringify(exportCase(engine, arrhythmia), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ep-case-${arrhythmia}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const load = async (f: File) => {
    try {
      const state = JSON.parse(await f.text());
      if (!isCaseState(state)) throw new Error('この JSON は症例の状態の形式ではありません');
      setParams(state.params);
      const s = useSim.getState();
      s.setArrhythmia(state.scenario);
      resetCase(state.scenario);
      importCase(getEngine(state.scenario), state);
      s.bumpPlacement();
      setMessage(`読み込みました（病変 ${state.lesions.length} 個。パラメータはページを再読み込みすると既定に戻ります）`);
    } catch (e) {
      setMessage(`読み込めませんでした：${(e as Error).message}`);
    }
  };

  return (
    <div className="research">
      <div className="row">
        <button onClick={download}>症例を JSON で書き出す</button>
        <button onClick={() => file.current?.click()}>JSON を読み込む</button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
      {message && <p className="note">{message}</p>}
      <p className="note">パラメータ（伝導速度・ERP・病変モデルの係数など）、カテーテルの配置、病変を保存します。条件を振った一括実行は npm run batch（docs/RESEARCH.md）。</p>
    </div>
  );
}
