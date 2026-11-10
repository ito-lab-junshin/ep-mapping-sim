import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import { ChamberMesh } from './ChamberMesh';
import { CatheterMarkers } from './CatheterMarkers';
import { PointMarkers } from './PointMarkers';
import { MapLegend } from '../ui/MapLegend';
import { referenceBeats } from '../core/mapping/annotation';
import type { SystemTheme } from '../systems';
import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { acquireNow, useEngine } from '../state/engine';
import { SCENARIOS } from '../core/arrhythmia';
import type { SimulationEngine } from '../core/sim/SimulationEngine';

/** 実時間 1 s = シミュレーション 1 s でエンジンを進める（1 フレーム最大 50 ms） */
function EngineClock({ engine, running }: { engine: SimulationEngine; running: boolean }) {
  useFrame((_, delta) => {
    if (running) engine.tick(Math.min(delta * 1000, 50));
  });
  return null;
}

/**
 * 自動取得：多極カテーテルで、基準チャンネルに新しい拍が来て WOI の記録が終わるたびに取得する。
 * 調べるのは 200 ms ごと。
 */
function AutoAcquire({ engine, theme }: { engine: SimulationEngine; theme: SystemTheme }) {
  const last = useRef({ checkedAt: -Infinity, beat: -Infinity });
  useFrame(() => {
    const s = useSim.getState();
    if (!s.autoAcquire || engine.time - last.current.checkedAt < 200) return;
    last.current.checkedAt = engine.time;
    const ref = engine.channels.find((c) => c.id === s.mapSettings.referenceChannel);
    if (!ref) return;
    const beats = referenceBeats(ref.buffer, engine.time, engine.sampleMs);
    const ready = beats.find((t) => t + s.mapSettings.woiAfterMs <= engine.time);
    if (ready === undefined || ready <= last.current.beat) return;
    last.current.beat = ready;
    acquireNow(engine, theme, true);
  });
  return null;
}

/**
 * 3D マッピングビュー（前方から見た両心房。+x = 患者の左）。
 * カテーテルを選んでいる間は、左ドラッグで配置、ホイールで押し込み、Shift+ホイールで回転。
 * 選択していないときは通常の視点操作（回転・ズーム）。
 */
export function Scene() {
  const system = useSim((s) => s.system);
  const running = useSim((s) => s.running);
  const view = useSim((s) => s.mapType);
  const active = useSim((s) => s.activeCatheter);
  const hovered = useSim((s) => s.hoveredRegion);
  const focus = useSim((s) => SCENARIOS[s.arrhythmia].chambers[0]);
  const theme = SYSTEMS[system];
  const engine = useEngine();

  useEffect(() => {
    const up = () => useSim.getState().setDragging(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  return (
    <>
      <Canvas camera={{ position: [0, 25, 150], fov: 45 }} style={{ background: theme.colors.background }}>
        <EngineClock engine={engine} running={running} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[40, 60, 80]} intensity={1.1} />
        <directionalLight position={[-40, -20, -60]} intensity={0.35} />
        <ChamberMesh key={engine.model.dimensions.id} engine={engine} theme={theme} view={view} focus={focus} />
        <CatheterMarkers key={`m-${engine.model.dimensions.id}`} engine={engine} theme={theme} />
        <PointMarkers key={`p-${engine.model.dimensions.id}`} engine={engine} theme={theme} />
        <AutoAcquire engine={engine} theme={theme} />
        <OrbitControls enableDamping target={[2, 0, -2]} enableRotate={!active} enableZoom={!active} />
      </Canvas>
      <MapLegend />
      <div className="view-hint" style={{ color: theme.colors.text }}>
        {hovered && <div className="view-region">{hovered}</div>}
        <div>{active
          ? 'ドラッグ：配置・移動　ホイール：押し込み／引き戻し　Shift+ホイール：回転'
          : 'ドラッグ：視点の回転　ホイール：拡大縮小'}</div>
        <div className="view-orient">前面像（+x = 患者の左）・{engine.model.dimensions.label}</div>
      </div>
    </>
  );
}
