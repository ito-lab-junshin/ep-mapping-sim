import { SYSTEMS } from '../systems';
import { SCENARIOS } from '../core/arrhythmia';
import { useSim } from '../state/store';
import { MapControls } from './MapControls';
import { StimulationPanel } from './StimulationPanel';
import { CurePanel } from './CurePanel';
import { CatheterTray } from './CatheterTray';
import { AblationConsole } from './AblationConsole';
import { GeometryControls } from './GeometryControls';
import { GoalList } from './GoalList';
import { TutorialPanel } from './TutorialPanel';
import { DisclaimerBar } from './AboutPanel';
import { ResearchPanel } from './ResearchPanel';
import { ECG_LEAD_OPTIONS } from '../core/ecg/SurfaceEcg';
import type { ArrhythmiaId, EcgLeadCount, MappingSystemId } from '../core/types';

const RHYTHM_LABEL: Record<string, string> = {
  sinus: '洞調律（sinus）', pacing: '刺激中・判定中（pacing）', tachycardia: '頻拍（tachycardia）',
  terminated: '頻拍が停止（terminated）', noninducible: '非誘発（noninducible）',
};

export function ControlPanel() {
  const s = useSim();
  const theme = SYSTEMS[s.system];
  return (
    <aside className="panel" style={{ background: theme.colors.panel, color: theme.colors.text }}>
      <h1>EP Mapping Simulator</h1>
      <DisclaimerBar />

      <TutorialPanel />

      <label>マッピングシステム
        <select value={s.system} onChange={(e) => s.setSystem(e.target.value as MappingSystemId)}>
          {Object.values(SYSTEMS).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <p className="note">{theme.vendorNote}</p>

      <label data-tutorial="scenario">不整脈
        <select value={s.arrhythmia} onChange={(e) => s.setArrhythmia(e.target.value as ArrhythmiaId)}>
          {Object.values(SCENARIOS).map((sc) => <option key={sc.id} value={sc.id}>{sc.label}</option>)}
        </select>
      </label>

      <div data-tutorial="geometry"><GeometryControls /></div>

      <label>体表 ECG
        <select value={s.ecgLeadCount} onChange={(e) => s.setEcgLeadCount(Number(e.target.value) as EcgLeadCount)}>
          {ECG_LEAD_OPTIONS.map((o) => <option key={o.count} value={o.count} disabled={!o.available}>{o.label}</option>)}
        </select>
      </label>

      <section data-tutorial="stimulation">
        <h2>刺激（pacing）</h2>
        <StimulationPanel />
      </section>

      <section data-tutorial="ablation">
        <h2>通電（ablation）</h2>
        <AblationConsole />
      </section>

      <section data-tutorial="cure">
        <h2>根治判定</h2>
        <CurePanel />
      </section>

      <section data-tutorial="map">
        <h2>マップ（mapping）</h2>
        <MapControls />
      </section>

      <h2>3D 表示</h2>
      <label>もう一方の心房
        <select value={s.otherAtrium} onChange={(e) => s.setOtherAtrium(e.target.value as 'translucent' | 'hidden')}>
          <option value="translucent">半透明で表示</option>
          <option value="hidden">表示しない</option>
        </select>
      </label>

      <section data-tutorial="catheters">
        <h2>カテーテル</h2>
        <CatheterTray />
      </section>

      <button onClick={s.toggleRunning} style={{ borderColor: theme.colors.accent }}>
        {s.running ? '一時停止' : '再開'}
      </button>

      <h2>研究用（JSON）</h2>
      <ResearchPanel />

      <section data-tutorial="goals">
        <h2>この症例のゴール</h2>
        <GoalList />
      </section>

      <h2>調律</h2>
      <p className="rhythm" style={{ color: s.tachycardia === 'tachycardia' ? theme.colors.accent : undefined }}>
        {RHYTHM_LABEL[s.tachycardia]}{s.cycleLengthMs ? `（周期長 ${Math.round(s.cycleLengthMs)} ms）` : ''}
      </p>
    </aside>
  );
}
