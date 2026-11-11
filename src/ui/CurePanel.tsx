import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { checkCure, resetCase, useEngine } from '../state/engine';

/** 根治の判定（シナリオの構造的な基準＋非誘発）と、症例のリセット */
export function CurePanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  const checks = useSim((s) => s.cureChecks);
  const engine = useEngine();
  return (
    <div className="cure">
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
