import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { clearAcquisition, getAcquisition, useEngine } from '../state/engine';
import type { GeometryMode } from '../core/types';

/**
 * ジオメトリー（§9）：プリセット／収集モード（FAM 風）。
 * 収集モードでは、ABL・環状・多極カテーテルが壁の近くを通った部分だけが形として現れる（未収集は穴）。
 */
export function GeometryControls() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const mode = useSim((s) => s.geometryMode);
  const setMode = useSim((s) => s.setGeometryMode);
  const showTruth = useSim((s) => s.showTruth);
  const setShowTruth = useSim((s) => s.setShowTruth);
  useSim((s) => s.geometryVersion);
  const engine = useEngine();
  const acq = getAcquisition(engine);
  const parts = engine.mesh.parts ?? [];
  return (
    <div className="geometry">
      <label>ジオメトリー
        <select value={mode} onChange={(e) => setMode(e.target.value as GeometryMode)}>
          <option value="preset">プリセットモデル</option>
          <option value="acquire">{theme.terms.geometryAcquire}で収集</option>
        </select>
      </label>
      {mode === 'acquire' && (
        <>
          <p className="note">
            ABL・環状・多極カテーテルを選び、3D 上でドラッグして心房の壁をなぞると形が現れます（未収集の場所は穴）。
            電気生理の計算は真の解剖で行うので、形が粗くても伝導・電位は正しく出ます。
          </p>
          <p className="coverage">
            {parts.map((p) => (
              <span key={p.chamber}>{p.chamber} {Math.round(acq.coveragePct(p.vertexStart, p.vertexCount))} %</span>
            ))}
            <span className="note">（収集点 {acq.points.length}）</span>
          </p>
          <label className="check">
            <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} />
            真の解剖を重ねる（答え合わせ）
          </label>
          <button onClick={() => clearAcquisition(engine)}>収集した形を消去</button>
        </>
      )}
    </div>
  );
}
