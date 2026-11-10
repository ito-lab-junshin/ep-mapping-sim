import { useEffect, useMemo, useRef, useState } from 'react';
import { SYSTEMS, type SystemTheme } from '../systems';
import { useSim } from '../state/store';
import { useEngine } from '../state/engine';
import { ecgLeadsFor } from '../core/ecg/SurfaceEcg';
import { SWEEP_SPEEDS_MM_S, caliper, msPerPx, visibleSamples, type SweepSpeed } from '../core/egm/display';
import type { EgmChannel, ChannelGroup } from '../core/types';
import type { SimulationEngine } from '../core/sim/SimulationEngine';

/** ラベル列の幅 px */
const LABEL_W = 76;
/** 1 mV あたりの振れ幅（行の高さに対する比、ゲイン 1 のとき） */
const ROW_SCALE_PER_MV: Record<ChannelGroup, number> = {
  ecg: 0.55, hra: 0.3, his: 0.45, cs: 0.3, abl: 0.3, rv: 0.2,
};
/** 時間目盛の間隔 ms */
const GRID_MS = 200;

interface Snapshot { endTime: number; data: Float32Array[] }

/**
 * 心内心電図パネル。
 * 1 枚の Canvas 2D に、体表 ECG → HRA → HIS → CS 9-10…1-2 → ABL d/p → RV の順でスクロール描画する。
 * 描画は requestAnimationFrame でエンジンのリングバッファを直接読み、React の再描画は起こさない。
 * フリーズ中（シミュレーションは継続）にクリックで 2 点キャリパーを置き、間隔 ms を測る。
 */
export function EgmPanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const { ecgLeadCount, sweepSpeed, gain, frozen, setSweepSpeed, setGain, setFrozen } = useSim();
  const engine = useEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const [calipers, setCalipers] = useState<number[]>([]);

  const rows = useMemo(() => {
    const leads = ecgLeadsFor(ecgLeadCount);
    return engine.channels.filter((c) => (c.group === 'ecg' ? (leads as string[]).includes(c.id) : true));
  }, [engine, ecgLeadCount]);

  // フリーズした瞬間のバッファを写し取る
  useEffect(() => {
    if (!frozen) { snapshot.current = null; setCalipers([]); return; }
    snapshot.current = {
      endTime: engine.time,
      data: engine.channels.map((c) => {
        const a = new Float32Array(c.buffer.length);
        for (let i = 0; i < a.length; i++) a[i] = c.buffer.at(i);
        return a;
      }),
    };
  }, [frozen, engine]);

  // 症例（心腔）を変えたらフリーズを解除
  useEffect(() => { setFrozen(false); }, [engine, setFrozen]);

  const calipersRef = useRef(calipers);
  calipersRef.current = calipers;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPanel(ctx, w, h, engine, rows, theme, sweepSpeed, gain, snapshot.current, calipersRef.current);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, rows, theme, sweepSpeed, gain]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (x < LABEL_W) return;
    if (!frozen) { setFrozen(true); setCalipers([x]); return; }
    setCalipers((c) => (c.length >= 2 ? [x] : [...c, x]));
  };

  const measured = calipers.length === 2 ? caliper(calipers[0], calipers[1], sweepSpeed) : null;

  return (
    <section className="egm" style={{ background: theme.colors.panel, color: theme.colors.text }}>
      <div className="egm-toolbar" style={{ borderColor: theme.colors.egmGrid }}>
        <label>スイープ
          <select value={sweepSpeed} onChange={(e) => setSweepSpeed(Number(e.target.value) as SweepSpeed)}>
            {SWEEP_SPEEDS_MM_S.map((s) => <option key={s} value={s}>{s} mm/s</option>)}
          </select>
        </label>
        <label>ゲイン
          <input type="range" min={-2} max={2} step={0.5} value={Math.log2(gain)} onChange={(e) => setGain(2 ** Number(e.target.value))} />
          <span className="egm-value">×{gain >= 1 ? gain : gain.toFixed(2)}</span>
        </label>
        <button onClick={() => setFrozen(!frozen)} style={{ borderColor: theme.colors.accent }}>
          {frozen ? 'フリーズ解除' : 'フリーズ（計測）'}
        </button>
        <span className="egm-caliper" style={{ color: theme.colors.accent }}>
          {measured
            ? `キャリパー ${Math.round(measured.ms)} ms（${Math.round(measured.bpm)} bpm）`
            : frozen ? '波形をクリックしてキャリパーを 2 本置く' : 'クリックでフリーズ＋キャリパー'}
        </span>
        <span className="egm-note">教育用モデル：実機の波形・アルゴリズムではありません</span>
      </div>
      <canvas ref={canvasRef} className="egm-canvas" onClick={onClick} />
    </section>
  );
}

function drawPanel(
  ctx: CanvasRenderingContext2D, w: number, h: number, engine: SimulationEngine, rows: EgmChannel[],
  theme: SystemTheme, speed: number, gain: number, snap: Snapshot | null, calipers: number[],
) {
  ctx.fillStyle = theme.colors.panel;
  ctx.fillRect(0, 0, w, h);
  if (rows.length === 0) return;
  const rowH = h / rows.length;
  const plotW = w - LABEL_W;
  const pxPerMs = 1 / msPerPx(speed);
  const endTime = snap ? snap.endTime : engine.time;

  // 時間目盛（データと一緒に流れる）
  ctx.strokeStyle = theme.colors.egmGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startTime = endTime - plotW / pxPerMs;
  for (let t = Math.ceil(startTime / GRID_MS) * GRID_MS; t <= endTime; t += GRID_MS) {
    const x = LABEL_W + plotW - (endTime - t) * pxPerMs;
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  ctx.stroke();

  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  rows.forEach((ch, r) => {
    const y0 = r * rowH, yc = y0 + rowH / 2;
    // 行の区切り
    ctx.strokeStyle = theme.colors.egmGrid;
    ctx.beginPath(); ctx.moveTo(0, Math.round(y0 + rowH) - 0.5); ctx.lineTo(w, Math.round(y0 + rowH) - 0.5); ctx.stroke();

    const color = theme.colors.egmTrace[ch.group];
    ctx.fillStyle = color;
    ctx.fillText(ch.id, 8, yc);

    const cath = engine.catheter(ch.catheterId);
    if (cath?.source === 'outside') {
      ctx.fillStyle = theme.colors.text;
      ctx.globalAlpha = 0.45;
      ctx.fillText('未配置（心腔外）', LABEL_W + 12, yc);
      ctx.globalAlpha = 1;
      return;
    }

    const idx = engine.channels.indexOf(ch);
    const data = snap?.data[idx];
    const len = data ? data.length : ch.buffer.length;
    const n = visibleSamples(plotW, speed, engine.sampleMs, len);
    const scale = rowH * ROW_SCALE_PER_MV[ch.group] * gain * ch.gain;
    const dxPerSample = engine.sampleMs * pxPerMs;

    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, y0 - rowH * 0.4, plotW, rowH * 1.8); // 隣の行へ少しはみ出してよい（実機同様のクリップ）
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const i = len - n + k;
      const v = data ? data[i] : ch.buffer.at(i);
      const x = LABEL_W + plotW - (n - 1 - k) * dxPerSample;
      const y = yc - v * scale;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  });

  // ラベル列の区切り
  ctx.strokeStyle = theme.colors.egmGrid;
  ctx.beginPath(); ctx.moveTo(LABEL_W - 0.5, 0); ctx.lineTo(LABEL_W - 0.5, h); ctx.stroke();

  // キャリパー
  ctx.strokeStyle = theme.colors.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  for (const x of calipers) {
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (snap) {
    ctx.fillStyle = theme.colors.accent;
    ctx.textAlign = 'right';
    ctx.fillText('FREEZE', w - 8, 10);
    ctx.textAlign = 'left';
  }
}
