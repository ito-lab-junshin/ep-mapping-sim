import { useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { answerFlutterDirection, getGoalTracker, getPoints, useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';

/**
 * この症例の学習ゴール（§11）：達成した項目に ✓ を付け、次の項目には手がかりを出す。
 * AFL の「旋回方向」は、ハローと CS の興奮順序を見て答える設問にする。
 */
export function GoalList() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  useSim((s) => s.goalVersion);
  useSim((s) => s.tachycardia);
  const engine = useEngine();
  const tracker = getGoalTracker(engine, arrhythmia);
  const ctx = tracker.context(engine, getPoints(engine).points);
  const next = SCENARIOS[arrhythmia].goals.find((g) => !tracker.isAchieved(g.id));
  const [feedback, setFeedback] = useState<string | null>(null);

  const answer = (v: 'ccw' | 'cw') => {
    const r = answerFlutterDirection(engine, arrhythmia, v);
    setFeedback(r === null ? '粗動と判定されてから答えてください（刺激をやめて 5 秒ほど続くと「頻拍」と判定されます）'
      : r ? '正解です' : '違います。ハローの H 19-20 と H 1-2 のどちらが先か、CS の近位と遠位のどちらが先かを見直しましょう');
  };

  return (
    <div className="goals">
      <ol>
        {SCENARIOS[arrhythmia].goals.map((g) => {
          const done = tracker.isAchieved(g.id);
          const progress = !done && g.progress ? g.progress(ctx) : null;
          return (
            <li key={g.id} className={done ? 'ok' : g === next ? 'next' : ''} style={g === next ? { borderColor: theme.colors.accent } : undefined}>
              <span className="mark">{done ? '✓' : '・'}</span>
              <span>{g.label}{progress ? `（${progress}）` : ''}</span>
              {g === next && <p className="note">{g.hint}</p>}
              {g === next && g.id === 'direction' && (
                <div className="row">
                  <button onClick={() => answer('ccw')}>反時計回り</button>
                  <button onClick={() => answer('cw')}>時計回り</button>
                </div>
              )}
              {g === next && g.id === 'direction' && feedback && <p className="note">{feedback}</p>}
            </li>
          );
        })}
      </ol>
      {tracker.allAchieved && <p className="goals-done" style={{ color: theme.colors.accent }}>この症例のゴールをすべて達成しました</p>}
    </div>
  );
}
