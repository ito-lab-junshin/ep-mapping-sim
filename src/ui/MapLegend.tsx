import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { getPoints, useEngine } from '../state/engine';
import { finiteRange } from '../core/mapping/colorScale';

/** カラーバー（3D ビューの右上）。LAT は ms、ボルテージは mV。名称と色はテーマから取る */
export function MapLegend() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const view = useSim((s) => s.mapType);
  const settings = useSim((s) => s.mapSettings);
  useSim((s) => s.mapVersion);
  const engine = useEngine();
  const points = getPoints(engine).points;
  if (view !== 'lat' && view !== 'voltage' && view !== 'propagation') return null;

  const title = view === 'lat' ? theme.terms.activationMap : view === 'voltage' ? theme.terms.voltageMap : theme.terms.propagationMap;
  const latRange = finiteRange(points.map((p) => p.latMs ?? Number.NaN));
  const ramp = view === 'voltage' ? theme.colors.voltageRamp : theme.colors.activationRamp;
  const gradient = `linear-gradient(to top, ${ramp.join(', ')})`;

  return (
    <div className="legend" style={{ color: theme.colors.text, background: theme.colors.panel }}>
      <div className="legend-title">{title}</div>
      <div className="legend-body">
        {view === 'voltage' ? (
          <>
            <div className="legend-bar-wrap">
              <div className="legend-bar" style={{ background: gradient }} />
              <div className="legend-scar" style={{ background: theme.colors.scar }} />
            </div>
            <div className="legend-labels">
              <span>≧ {settings.voltageNormalMv} mV（正常）</span>
              <span>{settings.voltageScarMv}〜{settings.voltageNormalMv} mV（低電位）</span>
              <span>&lt; {settings.voltageScarMv} mV（瘢痕）</span>
            </div>
          </>
        ) : (
          <>
            <div className="legend-bar-wrap"><div className="legend-bar" style={{ background: gradient }} /></div>
            <div className="legend-labels">
              <span>{latRange ? `${Math.round(latRange.max)} ms（最遅）` : '—'}</span>
              <span />
              <span>{latRange ? `${Math.round(latRange.min)} ms（最早）` : '—'}</span>
            </div>
          </>
        )}
      </div>
      <div className="legend-foot">
        <span className="legend-nodata" style={{ background: theme.colors.noData }} /> データなし（{settings.fillThresholdMm} mm より遠い）
        <br />{theme.terms.mapPoint} {points.length} 点・LAT は基準 {settings.referenceChannel} からの時間
      </div>
    </div>
  );
}
