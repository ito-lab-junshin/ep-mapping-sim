import { useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { answerEntrainment, currentEntrainment, currentSession, startEntrainment, useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';
import { ENTRAINMENT_CRITERIA, ENTRAINMENT_DEFAULTS } from '../core/pacing/entrainment';
import { Slider } from './CatheterTray';

const ms = (x: number | null) => (x === null ? '—' : `${x} ms`);
const RESPONSE_LABEL = { VAV: 'V-A-V', VAAV: 'V-A-A-V', terminated: '頻拍が停止' } as const;

/**
 * 頻拍中の心室刺激（エントレインメント、4-B、docs/DESIGN.md §5.6）：頻拍中に右室から「頻拍周期 − 差」で刺激し、
 * 止めた後の PPI − TCL と SA − VA を目安（Michaud ら）と並べて見せる。判定は学習者に任せ、AVNRT か AVRT かを答える設問を出す。
 * 刺激は表示中の症例で行う（刺激と心内電位が画面で見える）
 */
export function EntrainmentPanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  const rhythm = useSim((s) => s.tachycardia);
  useSim((s) => s.protocolTick);
  const engine = useEngine();
  const [offset, setOffset] = useState(ENTRAINMENT_DEFAULTS.offsetMs);
  const [feedback, setFeedback] = useState<string | null>(null);
  if (!SCENARIOS[arrhythmia].maneuvers?.includes('entrainment')) return null;
  const s = currentEntrainment();
  const mine = s && s.engine === engine ? s : null;
  const running = !!mine && !mine.done;
  const protocolRunning = !!currentSession() && currentSession()!.engine === engine && !currentSession()!.done;
  const r = mine?.result ?? null;
  const answer = (v: 'avnrt' | 'avrt' | 'at') => {
    const ok = answerEntrainment(engine, arrhythmia, v);
    setFeedback(ok ? '正解です' : '違います。止めた後の反応（V-A-V か V-A-A-V か）、PPI − TCL（心室から回路までの距離）、SA − VA（刺激の後の心房までの時間と頻拍中の VA の差）を見直しましょう');
  };
  const over = (x: number | null, th: number) => (x === null ? '' : x > th ? '（目安を超える）' : '（目安以下）');
  return (
    <div className="entrainment">
      <h4>エントレインメント（頻拍中の右室刺激）</h4>
      <p className="note">頻拍中に、右室から頻拍周期より少し短い周期で {ENTRAINMENT_DEFAULTS.beats} 拍刺激し、止めた後の反応を測ります。頻拍を誘発してから行います。</p>
      <Slider label="頻拍周期との差" value={offset} min={10} max={60} step={10} unit="ms" onChange={setOffset} />
      <button style={{ borderColor: theme.colors.accent }} disabled={rhythm !== 'tachycardia' || running || protocolRunning}
        onClick={() => { startEntrainment(engine, offset); setFeedback(null); }}>エントレインメントを行う</button>
      {rhythm !== 'tachycardia' && !running && <p className="note">頻拍中にだけ行えます。</p>}
      {running && <p className="note map-message">{mine!.pacing ? `刺激中（刺激周期 ${mine!.pclMs} ms）…` : '頻拍を観察中（頻拍中の VA を測っています）…'}</p>}
      {r && (
        <>
          <table className="stim-table">
            <tbody>
              <tr><td>頻拍周期（TCL）</td><td>{ms(r.tclMs)}</td></tr>
              <tr><td>刺激周期</td><td>{ms(r.pclMs)}</td></tr>
              <tr><td>心房の追従</td><td>{r.entrained ? 'あり（刺激周期に一致）' : 'なし'}</td></tr>
              <tr><td>止めた後の反応</td><td>{RESPONSE_LABEL[r.response]}</td></tr>
              <tr><td>PPI − TCL</td><td>{ms(r.ppiMinusTclMs)}{over(r.ppiMinusTclMs, ENTRAINMENT_CRITERIA.ppiMinusTclMs)}</td></tr>
              <tr><td>SA − VA</td><td>{ms(r.saMinusVaMs)}{over(r.saMinusVaMs, ENTRAINMENT_CRITERIA.saMinusVaMs)}</td></tr>
              <tr><td>（PPI・SA・VA）</td><td>{ms(r.ppiMs)}・{ms(r.saMs)}・{ms(r.vaMs)}</td></tr>
            </tbody>
          </table>
          {r.response === 'terminated'
            ? <p className="note">刺激で頻拍が止まりました。誘発し直し、頻拍周期との差を変えて試しましょう（このシミュレータでは、症例によって刺激で止まりやすいことがあります）。</p>
            : !r.entrained && <p className="note">心房が刺激の周期に追従していません。差を大きくして試しましょう。</p>}
          <p className="note">心房の時刻（SA・VA）は His 部位の心房で測ります。止めた後の反応が V-A-A-V なら心房頻拍（AT）を考えます。</p>
          <p className="note">目安：SA − VA &gt; {ENTRAINMENT_CRITERIA.saMinusVaMs} ms・PPI − TCL &gt; {ENTRAINMENT_CRITERIA.ppiMinusTclMs} ms なら AVNRT（{ENTRAINMENT_CRITERIA.source}）</p>
          <p className="note">この頻拍は AVNRT・AVRT・AT のどれですか。</p>
          <div className="row">
            <button onClick={() => answer('avnrt')}>AVNRT</button>
            <button onClick={() => answer('avrt')}>AVRT</button>
            <button onClick={() => answer('at')}>AT</button>
          </div>
          {feedback && <p className="note">{feedback}</p>}
        </>
      )}
    </div>
  );
}
