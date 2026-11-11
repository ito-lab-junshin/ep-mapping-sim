import { useEffect, useRef, useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { getAcquisition, getGoalTracker, getPoints, useEngine } from '../state/engine';
import { TUTORIALS, TUTORIAL_COVERAGE_RANGE_PCT, advanceTutorial, type TutorialContext } from '../core/learning/tutorials';
import { Slider } from './CatheterTray';

/**
 * チュートリアル（PVI（RF）・通常型 AFL（反時計回り／時計回り）・AVNRT・WPW）。操作パネルの上に今の手順を出し、完了すると自動で次へ進む。
 * 対象の操作欄（data-tutorial）を枠で強調し、そこまでスクロールする。
 */
export function TutorialPanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const step = useSim((s) => s.tutorialStep);
  const setStep = useSim((s) => s.setTutorialStep);
  const engine = useEngine();
  const [showHint, setShowHint] = useState(false);
  const coverageTarget = useSim((s) => s.tutorialCoveragePct);
  const setCoverageTarget = useSim((s) => s.setTutorialCoveragePct);
  const [, force] = useState(0);
  const tutorialId = useSim((s) => s.tutorialId);
  const setTutorialId = useSim((s) => s.setTutorialId);
  const confirmStep = useSim((s) => s.confirmTutorialStep);
  const T = TUTORIALS.find((t) => t.id === tutorialId) ?? TUTORIALS[0];

  // 500 ms ごとに完了を判定して進める（一時停止中も判定する）
  useEffect(() => {
    if (step === null) return;
    const id = setInterval(() => {
      const s = useSim.getState();
      if (s.tutorialStep === null) return;
      const tracker = getGoalTracker(engine, s.arrhythmia);
      const points = getPoints(engine).points;
      tracker.update(engine, points);
      const la = engine.mesh.parts![0];
      const ctx: TutorialContext = {
        engine, goals: tracker, points,
        ui: {
          arrhythmia: s.arrhythmia, geometryMode: s.geometryMode,
          laCoveragePct: getAcquisition(engine).coveragePct(la.vertexStart, la.vertexCount),
          coverageTargetPct: s.tutorialCoveragePct,
          cureOk: !!s.cureChecks && s.cureChecks.every((c) => c.ok),
          confirmed: new Set(s.tutorialConfirmed),
        },
      };
      const next = advanceTutorial(T, s.tutorialStep, ctx);
      if (next !== s.tutorialStep) { setStep(next); setShowHint(false); }
      ctxRef.current = ctx;
      force((x) => x + 1);
    }, 500);
    return () => clearInterval(id);
  }, [step, engine, setStep, T]);

  // 項目のチェック（PV ごとの entrance block など）の表示用に、直近の判定材料を残す
  const ctxRef = useRef<TutorialContext | null>(null);

  // 対象の操作欄を強調する
  const target = step !== null && step < T.steps.length ? T.steps[step].target : null;
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-tutorial]'));
    els.forEach((el) => el.classList.toggle('tutorial-target', el.dataset.tutorial === target));
    const el = els.find((x) => x.dataset.tutorial === target);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.documentElement.style.setProperty('--tutorial-accent', theme.colors.accent);
    return () => els.forEach((x) => x.classList.remove('tutorial-target'));
  }, [target, theme]);

  if (step === null) {
    return (
      <div className="tutorial idle">
        <label>チュートリアル
          <select value={tutorialId} onChange={(e) => setTutorialId(e.target.value)}>
            {TUTORIALS.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <button style={{ borderColor: theme.colors.accent }} onClick={() => { setStep(0); setShowHint(false); }}>
          チュートリアルを始める
        </button>
      </div>
    );
  }

  const done = step >= T.steps.length;
  const cur = done ? null : T.steps[step];
  return (
    <div className="tutorial" style={{ borderColor: theme.colors.accent }}>
      <div className="tutorial-head">
        <b>チュートリアル：{T.title}</b>
        <span>{done ? '完了' : `${step + 1} / ${T.steps.length}`}</span>
      </div>
      {cur ? (
        <>
          <p className="tutorial-title" style={{ color: theme.colors.accent }}>{cur.title}</p>
          <p>{cur.instruction}</p>
          {cur.id === 'build-la' && (
            <Slider label="被覆率の目安（設定）" value={coverageTarget} min={TUTORIAL_COVERAGE_RANGE_PCT[0]} max={TUTORIAL_COVERAGE_RANGE_PCT[1]}
              step={5} unit="%" onChange={setCoverageTarget} />
          )}
          {cur.items && ctxRef.current && (
            <ul className="tutorial-items">
              {cur.items(ctxRef.current).map((it) => <li key={it.label} className={it.done ? 'ok' : ''}>{it.done ? '✓' : '・'} {it.label}</li>)}
            </ul>
          )}
          {showHint && <p className="note">{cur.hint}</p>}
          {cur.confirmLabel && (
            <button style={{ borderColor: theme.colors.accent }} onClick={() => confirmStep(cur.id)}>{cur.confirmLabel}</button>
          )}
          <div className="row">
            <button onClick={() => setShowHint(!showHint)}>{showHint ? 'ヒントを隠す' : 'ヒント'}</button>
            <button onClick={() => { setStep(step + 1); setShowHint(false); }}>{cur.optional ? 'とばす（任意）' : 'この手順をとばす'}</button>
          </div>
        </>
      ) : (
        <p>{T.title} のチュートリアルを完了しました。{T.id === 'pvi-rf' ? 'ほかのエネルギー（クライオバルーン・PFA）にも挑戦してください。' : ''}{T.id.startsWith('afl') ? '反対向きの粗動の症例と見比べてください。' : ''}</p>
      )}
      <button className="tutorial-quit" onClick={() => setStep(null)}>{done ? '閉じる' : 'チュートリアルをやめる'}</button>
    </div>
  );
}
