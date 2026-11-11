import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { currentSession, startProtocol, stopProtocol, useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';
import { defaultProtocol, type ProtocolConfig, type ProtocolKind } from '../core/pacing/ProtocolSession';
import { PACING_SITE_LABEL, type PacingSite } from '../core/sim/SimulationEngine';
import { Slider } from './CatheterTray';

const STATUS_LABEL: Record<string, string> = {
  running: '刺激中', waiting: '速い興奮が続いている（持続を判定中）', induced: '誘発されました（頻拍が持続）',
  noninducible: '非誘発（下限まで、または有効不応期まで誘発されず）', stopped: '停止しました',
};

/**
 * 刺激パネル（docs/DESIGN.md §5.6）。既定値はシナリオの推奨（部位・方法）と教科書的な値。
 * 設定は URL パラメータに保存され、授業で共有できる。
 */
export function StimulationPanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  const stored = useSim((s) => s.protocol);
  const setProtocol = useSim((s) => s.setProtocol);
  useSim((s) => s.protocolTick);
  const engine = useEngine();
  const scenario = SCENARIOS[arrhythmia];
  const rec = scenario.induction;
  const cfg: ProtocolConfig = stored ?? defaultProtocol(rec.kind === 'burst' ? 'burst' : 'extrastimulus', rec.site);
  const set = (p: Partial<ProtocolConfig>) => setProtocol({ ...cfg, ...p });
  const session = currentSession();
  const mine = session && session.engine === engine ? session : null;
  const running = !!mine && !mine.done;

  return (
    <div className="stim">
      {rec.kind === 'spontaneous'
        ? <p className="note">この症例は PV トリガーで自然に始まります（刺激は任意）。</p>
        : <p className="note">推奨：{rec.kind === 'burst' ? 'バースト' : '期外刺激'}（{PACING_SITE_LABEL[rec.site]}）</p>}
      <div className="row">
        <label>方法
          <select value={cfg.kind} onChange={(e) => set({ kind: e.target.value as ProtocolKind })} disabled={running}>
            <option value="extrastimulus">期外刺激（S1-S2）</option>
            <option value="burst">バースト（burst）</option>
          </select>
        </label>
        <label>部位
          <select value={cfg.site} onChange={(e) => set({ site: e.target.value as PacingSite })} disabled={running}>
            {(Object.keys(PACING_SITE_LABEL) as PacingSite[]).map((k) => <option key={k} value={k}>{PACING_SITE_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      {cfg.kind === 'extrastimulus' ? (
        <>
          <Slider label="S1" value={cfg.s1Ms} min={300} max={1000} step={10} unit="ms" onChange={(v) => set({ s1Ms: v, s2StartMs: Math.min(cfg.s2StartMs, v - 10) })} />
          <Slider label="S1 の拍数" value={cfg.s1Beats} min={2} max={10} step={1} unit="拍" onChange={(v) => set({ s1Beats: v })} />
          <Slider label="S2 の開始" value={cfg.s2StartMs} min={150} max={cfg.s1Ms - 10} step={10} unit="ms" onChange={(v) => set({ s2StartMs: v })} />
          <Slider label="S2 の下限" value={cfg.s2MinMs} min={100} max={400} step={10} unit="ms" onChange={(v) => set({ s2MinMs: v })} />
          <label className="check"><input type="checkbox" checked={cfg.s3Ms !== null} onChange={(e) => set({ s3Ms: e.target.checked ? 300 : null })} /> S3 を加える</label>
          {cfg.s3Ms !== null && <Slider label="S3（S2 から）" value={cfg.s3Ms} min={150} max={500} step={10} unit="ms" onChange={(v) => set({ s3Ms: v })} />}
        </>
      ) : (
        <>
          <Slider label="バースト開始" value={cfg.burstFromMs} min={150} max={400} step={10} unit="ms" onChange={(v) => set({ burstFromMs: v })} />
          <Slider label="バースト終了" value={cfg.burstToMs} min={150} max={cfg.burstFromMs} step={10} unit="ms" onChange={(v) => set({ burstToMs: v })} />
          <Slider label="各列の拍数" value={cfg.burstBeats} min={4} max={20} step={1} unit="拍" onChange={(v) => set({ burstBeats: v })} />
        </>
      )}
      <div className="row">
        <button style={{ borderColor: theme.colors.accent }} disabled={running} onClick={() => startProtocol(engine, cfg)}>刺激を開始</button>
        <button disabled={!running} onClick={() => stopProtocol()}>停止</button>
      </div>
      {mine && (
        <>
          <p className="note map-message">{STATUS_LABEL[mine.status]}</p>
          <table className="stim-table">
            <thead><tr><th>列</th><th>捕捉</th><th>AH</th><th>エコー</th></tr></thead>
            <tbody>
              {mine.results.slice(-8).map((r, i) => (
                <tr key={i} className={r.induced ? 'induced' : ''}>
                  <td>{r.label} ms</td>
                  <td>{r.captured ? '○' : '×（ERP）'}</td>
                  <td>{r.ahMs === null ? '—' : `${Math.round(r.ahMs)} ms`}</td>
                  <td>{r.echo ? 'あり' : ''}{r.induced ? '・誘発' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">AH が急に 50 ms 以上延びたら「jump」（遅伝導路への切り替わり）。</p>
        </>
      )}
    </div>
  );
}
