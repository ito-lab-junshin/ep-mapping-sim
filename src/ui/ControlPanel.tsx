import { SYSTEMS } from '../systems';
import { SCENARIOS } from '../core/arrhythmia';
import { ENERGY_LABEL } from '../core/ablation/LesionModel';
import { useSim } from '../state/store';
import { useEngine } from '../state/engine';
import { ECG_LEAD_OPTIONS } from '../core/ecg/SurfaceEcg';
import { CONTACT_THRESHOLD_MM } from '../core/params';
import type { ArrhythmiaId, EcgLeadCount, EnergyId, MappingSystemId } from '../core/types';

/** 数値スライダー（ラベル・現在値・単位つき） */
function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{props.label}<b>{props.value} {props.unit}</b></span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

const contactLabel = (h: number) => (h <= CONTACT_THRESHOLD_MM ? '接触' : '非接触');

export function ControlPanel() {
  const s = useSim();
  const theme = SYSTEMS[s.system];
  const scenario = SCENARIOS[s.arrhythmia];
  const engine = useEngine();
  const hra = engine.catheter('hra');
  const c = s.catheters;
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

      <label>体表 ECG
        <select value={s.ecgLeadCount} onChange={(e) => s.setEcgLeadCount(Number(e.target.value) as EcgLeadCount)}>
          {ECG_LEAD_OPTIONS.map((o) => <option key={o.count} value={o.count} disabled={!o.available}>{o.label}</option>)}
        </select>
      </label>

      <h2>カテーテル配置（Phase 1：スライダー）</h2>
      <Slider label="CS 挿入深さ（CS 口から）" value={c.csInsertionDeg} min={70} max={170} step={5} unit="°"
        onChange={(v) => s.setCatheters({ csInsertionDeg: v })} />
      <Slider label={`CS 壁からの距離（${contactLabel(c.csHeightMm)}）`} value={c.csHeightMm} min={1} max={10} step={0.5} unit="mm"
        onChange={(v) => s.setCatheters({ csHeightMm: v })} />
      <Slider label="ABL 位置（中隔から後壁回り）" value={c.ablAzimuthDeg} min={0} max={355} step={5} unit="°"
        onChange={(v) => s.setCatheters({ ablAzimuthDeg: v })} />
      <Slider label="ABL 高さ（下 − / 上 ＋）" value={c.ablElevationDeg} min={-60} max={60} step={5} unit="°"
        onChange={(v) => s.setCatheters({ ablElevationDeg: v })} />
      <Slider label={`ABL 壁からの距離（${contactLabel(c.ablHeightMm)}）`} value={c.ablHeightMm} min={1} max={10} step={0.5} unit="mm"
        onChange={(v) => s.setCatheters({ ablHeightMm: v })} />
      <p className="note">
        HRA：{hra?.source === 'outside' ? '未配置（この症例の心腔外）' : '高位右房'}／
        His・RV：房室伝導のタイミングから合成（Phase 2 で RA 連結後に置き換え）
      </p>

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
