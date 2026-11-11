import { useEffect, useRef, useState } from 'react';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';
import { ABLATION } from '../core/params';
import { ENERGY_LABEL } from '../core/ablation/LesionModel';
import { cryoOcclusion } from '../core/ablation/cryo';
import { PV_NAMES, type PvName } from '../core/geometry/regions';
import type { PfaShape } from '../core/ablation/pfa';
import type { AblationMetrics } from '../core/ablation/AblationController';
import type { EnergyId } from '../core/types';
import { Slider } from './CatheterTray';

const fmt = (x: number | undefined, d = 0) => (x === undefined ? '—' : x.toFixed(d));

/**
 * アブレーション操作盤（docs/DESIGN.md §7・§10）。
 * エネルギーはシナリオで使えるものだけ（クライオバルーン・PFA は AF の PV 隔離）。
 * 通電の時計は倍速（1×/5×/10×）で、EGM・伝播は実時間のまま進む。
 * 表示する指標はテーマの機能フラグ（接触圧・局所インピーダンス・病変指標）で出し分ける。
 */
export function AblationConsole() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const arrhythmia = useSim((s) => s.arrhythmia);
  const selected = useSim((s) => s.energy);
  const setEnergy = useSim((s) => s.setEnergy);
  const engine = useEngine();
  const ctl = engine.ablation;
  const energies = SCENARIOS[arrhythmia].energies;
  const energy: EnergyId = energies.includes(selected) ? selected : 'rf';
  const [, force] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lesionCount = useRef(engine.lesions.length);
  /** 実効の倍速（通電の時計の進み / 実時間）。計算が重い症例では設定より遅くなる */
  const clockSamples = useRef<{ wall: number; sim: number }[]>([]);
  const effective = useRef<number | null>(null);

  // 通電中は 200 ms ごとに表示を更新し、病変が増えたら 3D と根治判定に知らせる
  useEffect(() => {
    const id = setInterval(() => {
      const changed = engine.lesions.length !== lesionCount.current;
      if (changed) {
        lesionCount.current = engine.lesions.length;
        const s = useSim.getState();
        s.bumpPlacement();
        s.setCureChecks(null);
      }
      if (ctl.active) {
        const q = clockSamples.current, now = performance.now();
        if (q.length && ctl.active.elapsedS < q[q.length - 1].sim) q.length = 0; // 新しい通電
        q.push({ wall: now, sim: ctl.active.elapsedS });
        while (q.length > 2 && now - q[0].wall > 3000) q.shift();
        const dt = (q[q.length - 1].wall - q[0].wall) / 1000;
        if (dt >= 0.8) effective.current = (q[q.length - 1].sim - q[0].sim) / dt;
      } else { clockSamples.current = []; effective.current = null; }
      if (ctl.active || changed) force((x) => x + 1);
    }, 200);
    return () => clearInterval(id);
  }, [engine, ctl]);
  useEffect(() => { lesionCount.current = engine.lesions.length; }, [engine]);

  const update = (f: () => void) => { f(); force((x) => x + 1); };
  const start = (e: 'rf' | 'cryo') => { const err = ctl.start(e); setError(err); force((x) => x + 1); };
  const m: AblationMetrics | null = ctl.metrics();
  const shown = m && m.energy === energy ? m : null;
  const active = !!ctl.active;
  const f = theme.features;

  return (
    <div className="ablation">
      <label>エネルギー
        <select value={energy} disabled={active} onChange={(e) => setEnergy(e.target.value as EnergyId)}>
          {energies.map((x) => <option key={x} value={x}>{ENERGY_LABEL[x]}</option>)}
        </select>
      </label>
      {energies.length === 1 && <p className="note">この症例は RF のみ（クライオバルーン・PFA は AF の PV 隔離で使います）。</p>}

      {energy !== 'pfa' && (
        <label>通電の時計
          <select value={ctl.speed} onChange={(e) => update(() => { ctl.speed = Number(e.target.value); })}>
            {ABLATION.clockSpeeds.map((x) => <option key={x} value={x}>{x}×{x === 1 ? '（実時間）' : ''}</option>)}
          </select>
        </label>
      )}
      {energy !== 'pfa' && <p className="note">病変の成長だけを倍速で進めます（EGM・伝播は実時間）。通電時間はシミュレーション時間で、計算の重い症例（AF）では実効の倍速が設定より遅くなります。</p>}

      {energy === 'rf' && (
        <>
          <Slider label="出力" value={ctl.rf.powerW} min={ABLATION.rf.powerRangeW[0]} max={ABLATION.rf.powerRangeW[1]} step={5} unit="W"
            onChange={(v) => update(() => { ctl.rf.powerW = v; })} />
          <Slider label="通電時間（シミュレーション時間）" value={ctl.rf.durationS} min={5} max={ABLATION.rf.maxDurationS} step={5} unit="s"
            onChange={(v) => update(() => { ctl.rf.durationS = v; })} />
          <p className="note">ABL を先端で接触させて通電します（カテーテル欄で ABL を選び、3D 上で動かす・ホイールで押し込む）。</p>
        </>
      )}

      {energy === 'cryo' && (
        <>
          <PvSelect value={ctl.cryo.pv} disabled={active} onChange={(pv) => update(() => { ctl.cryo.pv = pv; })} />
          <Slider label="押し付け" value={ctl.cryo.push01 * 100} min={0} max={100} step={5} unit="%"
            onChange={(v) => update(() => { ctl.cryo.push01 = v / 100; })} />
          <Slider label="PV の軸とのずれ" value={ctl.cryo.misalignDeg} min={0} max={30} step={1} unit="°"
            onChange={(v) => update(() => { ctl.cryo.misalignDeg = v; })} />
          <Slider label="通電時間（シミュレーション時間）" value={ctl.cryo.durationS} min={60} max={240} step={30} unit="s"
            onChange={(v) => update(() => { ctl.cryo.durationS = v; })} />
          <p className="note">閉塞度（推定）{Math.round(cryoOcclusion(ctl.cryo.push01, ctl.cryo.misalignDeg) * 100)} %
            （{Math.round(ABLATION.cryo.fullRingOcclusion * 100)} % 未満は漏れのある側に隙間が残る）。</p>
        </>
      )}

      {energy === 'pfa' && (
        <>
          <PvSelect value={ctl.pfa.pv} onChange={(pv) => update(() => { ctl.pfa.pv = pv; })} />
          <label>カテーテルの形
            <select value={ctl.pfa.shape} onChange={(e) => update(() => { ctl.pfa.shape = e.target.value as PfaShape; })}>
              <option value="basket">バスケット型（PV 口の縁の輪）</option>
              <option value="flower">フラワー型（PV 口を覆う円盤）</option>
            </select>
          </label>
          <p className="note">1 回の通電は浅い（貫壁性 50 %）。同じ PV に 2 回以上で貫壁性になる。</p>
        </>
      )}

      <div className="row">
        {energy === 'pfa'
          ? <button style={{ borderColor: theme.colors.lesion }} onClick={() => update(() => { ctl.applyPfa(); setError(null); })}>PFA 通電（1 回）</button>
          : active
            ? <button style={{ borderColor: theme.colors.lesion }} onClick={() => update(() => ctl.stop())}>通電停止</button>
            : <button style={{ borderColor: theme.colors.lesion }} onClick={() => start(energy)}>通電開始</button>}
        <span className="note">病変タグ {engine.lesions.length} 個</span>
      </div>
      {error && <p className="warn">{error}</p>}

      {shown && (
        <dl className="ablation-metrics" style={{ borderColor: active ? theme.colors.lesion : theme.colors.egmGrid }}>
          {shown.energy !== 'pfa' && (<><dt>{shown.active ? '通電中' : '直近の通電'}（シミュレーション時間）</dt><dd>{fmt(shown.elapsedS)} s</dd></>)}
          {shown.active && (<><dt>通電の時計</dt>
            <dd>{ctl.speed}× 設定・実効 {effective.current === null ? '—' : `${effective.current.toFixed(1)}×`}</dd></>)}
          {shown.energy === 'rf' && (
            <>
              <dt>出力</dt><dd>{fmt(shown.powerW)} W</dd>
              {f.contactForce && (<><dt>接触圧（contact force）</dt><dd>{fmt(shown.contactForceG)} g</dd></>)}
              {f.localImpedance && (<><dt>{theme.terms.localImpedance ?? '局所インピーダンス'}</dt>
                <dd>{fmt(shown.localImpedanceOhm)} Ω（低下 {fmt(shown.liDropOhm)} Ω）</dd></>)}
              {f.ablationIndex && (<><dt>{theme.terms.lesionIndex ?? '病変指標'}（{shown.rfTarget === 'posterior' ? '後壁' : '前壁'}の目標）</dt>
                <dd>{fmt(shown.lesionIndexPct)} %</dd></>)}
              <dt>病変（教育用の推定）</dt><dd>径 {fmt(shown.radiusMm && shown.radiusMm * 2, 1)} mm・深さ {fmt(shown.depthMm, 1)} mm</dd>
              <dt>貫壁性（壁厚 {fmt(shown.wallMm, 1)} mm）</dt><dd>{fmt(shown.transmuralityPct)} %</dd>
              {shown.junctional && (<><dt>接合部調律</dt><dd>出現（遅伝導路の近く）</dd></>)}
            </>
          )}
          {shown.energy === 'cryo' && (
            <>
              <dt>閉塞度</dt><dd>{fmt(shown.occlusion && shown.occlusion * 100)} %</dd>
              <dt>バルーン温度</dt><dd>{fmt(shown.tempC)} ℃</dd>
              <dt>Time to isolation</dt><dd>{shown.timeToIsolationS == null ? '未隔離' : `${fmt(shown.timeToIsolationS)} s`}</dd>
            </>
          )}
          {shown.message && <dd className="warn full">{shown.message}</dd>}
        </dl>
      )}
      {f.ablationIndex && energy === 'rf' && (
        <p className="note">病変指標は本アプリ独自の尺度（その部位の目標量 = 100 %。30 W・20 g で後壁は約 30 秒、前壁は約 40 秒）で、実機の指標・目標値とは異なります。</p>
      )}
    </div>
  );
}

function PvSelect(props: { value: PvName; disabled?: boolean; onChange: (pv: PvName) => void }) {
  return (
    <label>標的の PV
      <select value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as PvName)}>
        {PV_NAMES.map((pv) => <option key={pv} value={pv}>{pv}</option>)}
      </select>
    </label>
  );
}
