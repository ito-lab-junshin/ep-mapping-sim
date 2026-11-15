import { useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { answerApSite, answerFlutterDirection, getGoalTracker, getPoints, useEngine } from '../state/engine';
import { AP_SITE_IDS, type ApSite } from '../core/params';
import { AP_SITES } from '../core/arrhythmia/wpw';

/**
 * この症例の学習ゴール（§11）：達成した項目に ✓ を付け、次の項目には手がかりを出す。
 * AFL の「旋回方向」は、ハローと CS の興奮順序を見て答える設問にする。
 * WPW で部位を伏せたときは、体表 ECG のデルタ波から副伝導路の部位を答える設問を出す。
 * この症例の設定で扱わないゴール（applies が false）は出さない。
 */
export function GoalList() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  useSim((s) => s.goalVersion);
  useSim((s) => s.tachycardia);
  const engine = useEngine();
  const tracker = getGoalTracker(engine, arrhythmia);
  const ctx = tracker.context(engine, getPoints(engine).points);
  const goals = tracker.activeGoals(ctx);
  const next = goals.find((g) => !tracker.isAchieved(g.id));
  const [feedback, setFeedback] = useState<string | null>(null);

  const answer = (v: 'ccw' | 'cw') => {
    const r = answerFlutterDirection(engine, arrhythmia, v);
    setFeedback(r === null ? '粗動と判定されてから答えてください（刺激をやめて 5 秒ほど続くと「頻拍」と判定されます）'
      : r ? '正解です' : '違います。ハローの H 19-20 と H 1-2 のどちらが先か、CS の近位と遠位のどちらが先かを見直しましょう');
  };
  const answerSite = (v: ApSite) => {
    const r = answerApSite(engine, arrhythmia, v);
    setFeedback(r === null ? '副伝導路がありません' : r ? '正解です'
      : '違います。V1 の極性（陽性なら左側）、I・aVL の極性、下壁誘導（II・III・aVF）の極性、移行帯の位置を見直しましょう');
  };

  /** 正解した設問は、達成した行に答えを残す（次のゴールへ進んでも消えない。症例を作り直すと消える） */
  const correctAnswer = (goalId: string): string | null => {
    const q = goalId === 'direction' ? 'afl-direction' : goalId === 'ap-site' ? 'ap-site' : null;
    const e = q ? ctx.events.find((x) => x.kind === 'answer' && x.question === q && x.correct) : undefined;
    if (!e || e.kind !== 'answer') return null;
    return e.question === 'afl-direction' ? (e.value === 'ccw' ? '反時計回り' : '時計回り') : AP_SITES[e.value as ApSite].label;
  };

  return (
    <div className="goals">
      <ol>
        {goals.map((g) => {
          const done = tracker.isAchieved(g.id);
          const progress = !done && g.progress ? g.progress(ctx) : null;
          return (
            <li key={g.id} className={done ? 'ok' : g === next ? 'next' : ''} style={g === next ? { borderColor: theme.colors.accent } : undefined}>
              <span className="mark">{done ? '✓' : '・'}</span>
              <span>{g.label}{progress ? `（${progress}）` : ''}</span>
              {g.items && (
                <span className="goal-items">
                  {tracker.itemStatus(g.id, ctx).map((it) => <span key={it.id} className={it.done ? 'ok' : ''}>{it.done ? '✓' : '・'}{it.label}</span>)}
                </span>
              )}
              {g === next && <p className="note">{g.hint}</p>}
              {g === next && g.id === 'direction' && (
                <div className="row">
                  <button onClick={() => answer('ccw')}>反時計回り</button>
                  <button onClick={() => answer('cw')}>時計回り</button>
                </div>
              )}
              {g === next && g.id === 'ap-site' && (
                <div className="row">
                  {AP_SITE_IDS.map((s) => <button key={s} onClick={() => answerSite(s)}>{AP_SITES[s].label}</button>)}
                </div>
              )}
              {g === next && (g.id === 'direction' || g.id === 'ap-site') && feedback && <p className="note">{feedback}</p>}
              {done && correctAnswer(g.id) && <p className="note answer-ok">正解です（{correctAnswer(g.id)}）</p>}
            </li>
          );
        })}
      </ol>
      {tracker.allAchieved && <p className="goals-done" style={{ color: theme.colors.accent }}>この症例のゴールをすべて達成しました</p>}
    </div>
  );
}
