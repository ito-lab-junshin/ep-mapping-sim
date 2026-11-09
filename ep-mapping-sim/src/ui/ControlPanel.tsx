import { SYSTEMS } from '../systems';
import { SCENARIOS } from '../core/arrhythmia';
import { ENERGY_LABEL } from '../core/ablation/LesionModel';
import { useSim } from '../state/store';
import type { ArrhythmiaId, EnergyId, MappingSystemId } from '../core/types';

export function ControlPanel() {
  const s = useSim();
  const theme = SYSTEMS[s.system];
  const scenario = SCENARIOS[s.arrhythmia];
  return (
    <aside className="panel" style={{ background: theme.colors.panel, color: theme.colors.text }}>
      <h1>EP Mapping Simulator</h1>

      <label>マッピングシステム
        <select value={s.system} onChange={(e) => s.setSystem(e.target.value as MappingSystemId)}>
          {Object.values(SYSTEMS).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <p className="note">{theme.vendorNote}</p>

      <label>不整脈
        <select value={s.arrhythmia} onChange={(e) => s.setArrhythmia(e.target.value as ArrhythmiaId)}>
          {Object.values(SCENARIOS).map((sc) => <option key={sc.id} value={sc.id}>{sc.label}</option>)}
        </select>
      </label>

      <label>エネルギー
        <select value={s.energy} onChange={(e) => s.setEnergy(e.target.value as EnergyId)}>
          {(Object.keys(ENERGY_LABEL) as EnergyId[]).map((e) => <option key={e} value={e}>{ENERGY_LABEL[e]}</option>)}
        </select>
      </label>

      <label>ジオメトリー
        <select value={s.geometryMode} onChange={(e) => s.setGeometryMode(e.target.value as 'acquire' | 'preset')}>
          <option value="preset">プリセットモデル</option>
          <option value="acquire">{theme.terms.geometryAcquire}で収集</option>
        </select>
      </label>

      <button onClick={s.toggleRunning} style={{ borderColor: theme.colors.accent }}>
        {s.running ? '一時停止' : '再開'}
      </button>

      <h2>この症例のゴール</h2>
      <ol>
        {scenario.goals.map((g) => <li key={g}>{g}</li>)}
      </ol>

      <h2>状態</h2>
      <p>調律: {s.tachycardia}</p>
    </aside>
  );
}
