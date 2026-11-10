import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { acquireNow, clearPoints, mappingCatheters, useEngine } from '../state/engine';
import { Slider } from './CatheterTray';
import { MAP_DEFAULTS } from '../core/params';
import { effectiveWoi } from '../core/mapping/woi';
import type { LatMethod, MapType } from '../core/types';

/**
 * マップの操作（docs/DESIGN.md §6）。用語はテーマの terms、ボルテージ閾値は機能フラグに従う。
 */
export function MapControls() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const s = useSim();
  const engine = useEngine();
  const m = s.mapSettings;
  const cats = mappingCatheters(engine, theme);
  const refOptions = engine.channels.filter((c) => c.group === 'cs' || c.group === 'hra').map((c) => c.id);
  // 頻拍時の WOI の自動切り替えは取得時に周期長から決まる。ここでは現在の規則を表示する
  const woiNow = effectiveWoi(m, s.tachycardia, null);

  return (
    <div className="map-controls">
      <label>表示モード
        <select value={s.mapType} onChange={(e) => s.setMapType(e.target.value as MapType)}>
          <option value="live">伝播（実時間）</option>
          <option value="lat">{theme.terms.activationMap}</option>
          <option value="voltage">{theme.terms.voltageMap}</option>
          <option value="propagation">{theme.terms.propagationMap}</option>
          <option value="regions">解剖領域ラベル</option>
        </select>
      </label>

      <div className="row">
        <button onClick={() => acquireNow(engine, theme)} style={{ borderColor: theme.colors.accent }} disabled={!cats.length}>
          {theme.terms.mapPoint}を取得
        </button>
        <button onClick={() => clearPoints(engine)}>消去</button>
      </div>
      <p className="note">
        {cats.length ? `取得に使うカテーテル：${cats.map((c) => c.catheter.label).join('・')}（接触している電極の組ごとに 1 点）` : '環状・多極・ABL を心房に置くと取得できます。'}
      </p>
      {s.acquireMessage && <p className="note map-message">{s.acquireMessage}</p>}
      <label className="check"><input type="checkbox" checked={s.autoAcquire} onChange={(e) => s.setAutoAcquire(e.target.checked)} /> 多極カテーテルで 1 拍ごとに自動取得</label>
      <label className="check"><input type="checkbox" checked={s.showPoints} onChange={(e) => s.setShowPoints(e.target.checked)} /> {theme.terms.mapPoint}を表示</label>

      <label>基準チャンネル（reference）
        <select value={m.referenceChannel} onChange={(e) => s.setMapSettings({ referenceChannel: e.target.value })}>
          {refOptions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label>LAT の取り方
        <select value={m.latMethod} onChange={(e) => s.setMapSettings({ latMethod: e.target.value as LatMethod })}>
          <option value="bipolarPeak">双極の最大振幅（bipolar peak）</option>
          <option value="unipolarDvdt">単極の最大下降点（unipolar −dV/dt）</option>
        </select>
      </label>
      <Slider label="WOI 開始（基準から）" value={m.woiBeforeMs} min={-400} max={0} step={10} unit="ms"
        onChange={(v) => s.setMapSettings({ woiBeforeMs: v, woiManual: true })} />
      <Slider label="WOI 終了（基準から）" value={m.woiAfterMs} min={0} max={400} step={10} unit="ms"
        onChange={(v) => s.setMapSettings({ woiAfterMs: v, woiManual: true })} />
      <p className="note">
        {m.woiManual
          ? <>WOI は手動設定です（頻拍でも自動で変えません）。<button className="link" onClick={() => s.setMapSettings({ woiBeforeMs: MAP_DEFAULTS.woiBeforeMs, woiAfterMs: MAP_DEFAULTS.woiAfterMs, woiManual: false })}>既定（自動）に戻す</button></>
          : `頻拍中は、WOI が周期長を超えると「周期長 − 10 ms」の幅に自動で切り替えます（現在 ${woiNow.beforeMs}〜+${woiNow.afterMs} ms）。`}
      </p>
      <Slider label={theme.terms.fillThreshold} value={m.fillThresholdMm} min={MAP_DEFAULTS.fillThresholdRangeMm[0]} max={MAP_DEFAULTS.fillThresholdRangeMm[1]} step={1} unit="mm"
        onChange={(v) => s.setMapSettings({ fillThresholdMm: v })} />
      {theme.features.voltageThresholdSlider && (
        <>
          <Slider label="ボルテージ閾値（瘢痕）" value={m.voltageScarMv} min={0.05} max={1} step={0.05} unit="mV"
            onChange={(v) => s.setMapSettings({ voltageScarMv: Math.min(v, m.voltageNormalMv - 0.05) })} />
          <Slider label="ボルテージ閾値（正常）" value={m.voltageNormalMv} min={0.1} max={3} step={0.05} unit="mV"
            onChange={(v) => s.setMapSettings({ voltageNormalMv: Math.max(v, m.voltageScarMv + 0.05) })} />
        </>
      )}
      {theme.features.omnipolarEgm && <p className="note">グリッド型は隣り合う 3 電極で方向非依存 EGM（omnipolar 風）を使って電位と LAT を取ります。</p>}
    </div>
  );
}
