import { useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { answerParaHisian, useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';
import { paraHisianResponse, type ParaHisianResult } from '../core/pacing/paraHisian';

const ms = (x: number | null) => (x === null ? '—' : `${x} ms`);
const diff = (a: number | null, b: number | null) => (a === null || b === null ? '—' : `${b - a >= 0 ? '+' : ''}${b - a} ms`);

/**
 * para-Hisian 刺激（4-A、docs/DESIGN.md §5.6）：His 近傍から高出力（His＋心室を捕捉）と低出力（心室だけ）で 1 発ずつ刺激し、
 * 刺激から心房までの時間（S-A）を HRA・His 部位・CS 遠位で並べる。判定は学習者に任せ、逆行性伝導の経路を答える設問を出す。
 * 計算は同じ症例・病変の複製で行う（画面の症例は進めない）
 */
export function ParaHisianPanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  const engine = useEngine();
  const [result, setResult] = useState<ParaHisianResult | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const scenario = SCENARIOS[arrhythmia];
  if (!scenario.maneuvers?.includes('paraHisian')) return null;
  const run = () => { setResult(paraHisianResponse(engine, scenario)); setFeedback(null); };
  const answer = (v: 'node' | 'ap') => {
    const ok = answerParaHisian(engine, arrhythmia, v);
    setFeedback(ok ? '正解です' : '違います。低出力（His を捕捉しない）で S-A が延びたか、どの部位の S-A が変わらなかったかを見直しましょう');
    useSim.getState().bumpGoals();
  };
  const rows: [string, keyof ParaHisianResult['high']][] = [['HRA', 'saHraMs'], ['His 部位', 'saHisMs'], ['CS 遠位（1-2）', 'saCsDistMs']];
  return (
    <div className="para-hisian">
      <h4>para-Hisian 刺激</h4>
      <p className="note">His 近傍から、高出力（His と心室を捕捉、狭い QRS）と低出力（心室だけを捕捉、広い QRS）で 1 発ずつ刺激し、刺激から心房までの時間（S-A）を比べます。洞調律を止めた症例の複製で計算します。</p>
      <button style={{ borderColor: theme.colors.accent }} onClick={run}>para-Hisian 刺激を行う</button>
      {result && (
        <>
          <table className="stim-table">
            <thead><tr><th>S-A</th><th>高出力</th><th>低出力</th><th>差</th></tr></thead>
            <tbody>
              {rows.map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{ms(result.high[key] as number | null)}</td>
                  <td>{ms(result.low[key] as number | null)}</td>
                  <td>{diff(result.high[key] as number | null, result.low[key] as number | null)}</td>
                </tr>
              ))}
              <tr><td>QRS</td><td>{result.high.qrs === 'narrow' ? '狭い' : '広い'}</td><td>{result.low.qrs === 'narrow' ? '狭い' : '広い'}</td><td /></tr>
            </tbody>
          </table>
          <p className="note">逆行性伝導の経路はどちらですか（低出力で S-A が延びれば房室結節、変わらなければ副伝導路。部位によって変わり方が違うこともあります）。</p>
          <div className="row">
            <button onClick={() => answer('node')}>房室結節</button>
            <button onClick={() => answer('ap')}>副伝導路</button>
          </div>
          {feedback && <p className="note">{feedback}</p>}
        </>
      )}
    </div>
  );
}
