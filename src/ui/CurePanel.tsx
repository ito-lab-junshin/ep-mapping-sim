import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { checkCure, resetCase, useEngine } from '../state/engine';

/** 根治の判定（シナリオの構造的な基準＋非誘発）と、症例のリセット */
export function CurePanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  const checks = useSim((s) => s.cureChecks);
  useSim((s) => s.placementTick);
  const engine = useEngine();
  return (
    <div className="cure">
      <p className="note">通電：ABL を選んで先端を接触させ、「簡易通電」（半径 3 mm、Phase 5 でエネルギー別に置き換え）。病変 {engine.lesions.length} 個</p>
      <div className="row">
        <button style={{ borderColor: theme.colors.accent }} onClick={() => checkCure(engine, arrhythmia)}>根治を判定</button>
        <button onClick={() => resetCase(arrhythmia)}>症例をリセット</button>
      </div>
      {checks && (
        <ul className="checks">
          {checks.map((c) => <li key={c.id} className={c.ok ? 'ok' : 'ng'}>{c.ok ? '✓' : '✗'} {c.label}</li>)}
        </ul>
      )}
    </div>
  );
}
