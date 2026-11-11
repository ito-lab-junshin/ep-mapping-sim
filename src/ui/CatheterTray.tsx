import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';
import { catheterAvailable, placeCatheter, useEngine } from '../state/engine';
import { CIRCULAR, CONTACT_THRESHOLD_MM } from '../core/params';
import { catheterGroup, type CatheterSpec } from '../core/catheter/catalog';

/** 数値スライダー（ラベル・現在値・単位つき） */
export function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{props.label}<b>{Number.isInteger(props.step ?? 1) ? Math.round(props.value) : props.value.toFixed((props.step ?? 1) < 0.1 ? 2 : 1)} {props.unit}</b></span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}

function status(spec: CatheterSpec): string {
  const c = spec.catheter;
  if (spec.mode === 'synthetic') return '合成（心室はメッシュなし）';
  if (!c.placed) return '未配置';
  const n = c.electrodes.filter((e) => e.contactVertex >= 0).length;
  if (c.kind === 'cs_decapolar') return `CS 内（LA から ${CONTACT_THRESHOLD_MM} mm 以内 ${n}/${c.electrodes.length} 極）`;
  return `接触 ${n}/${c.electrodes.length} 極`;
}

/**
 * カテーテル一覧（§10）。選んだカテーテルを 3D 上で動かす。
 * 経路カテーテル（CS・His・HRA）は経路上の位置、自由配置（ABL・環状・多極）は表面上の任意の点。
 * 多極スプライン／グリッドはテーマの機能フラグで出し分ける。クライオバルーン・PFA は通電欄で PV を選んで置く。
 */
export function CatheterTray() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  useSim((s) => s.placementTick);
  const active = useSim((s) => s.activeCatheter);
  const setActive = useSim((s) => s.setActiveCatheter);
  const engine = useEngine();
  const specs = engine.specs.filter((s) => catheterAvailable(s, theme));
  const sel = active ? engine.spec(active) : undefined;
  const p = sel?.placement;

  return (
    <div className="tray">
      <ul className="tray-list">
        {specs.map((spec) => {
          const c = spec.catheter;
          const selectable = spec.mode !== 'synthetic';
          return (
            <li key={c.id}>
              <button className={active === c.id ? 'active' : ''} disabled={!selectable}
                style={active === c.id ? { borderColor: theme.colors.accent } : undefined}
                onClick={() => setActive(active === c.id ? null : c.id)}>
                <span className="tray-swatch" style={{ background: theme.colors.egmTrace[catheterGroup(c.kind)] }} />
                <span className="tray-name">{c.label}</span>
                <span className="tray-status">{status(spec)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {sel && sel.mode === 'path' && sel.pathId && !p && (
        <button onClick={() => placeCatheter(engine, sel.catheter.id, { kind: 'path', s: engine.paths[sel.pathId!].defaultS, heightMm: 1 })}>
          このカテーテルを置く
        </button>
      )}
      {sel && p?.kind === 'path' && sel.pathId && (
        <>
          <Slider label={sel.catheter.kind === 'cs_decapolar' ? 'CS 挿入深さ（CS 口から）' : '経路上の位置'}
            value={p.s} min={0} max={Math.round(engine.paths[sel.pathId].length)} step={1} unit="mm"
            onChange={(s) => placeCatheter(engine, sel.catheter.id, { ...p, s })} />
          {sel.catheter.kind !== 'cs_decapolar' && (
            <Slider label="壁からの距離（押し込み）" value={p.heightMm} min={0.5} max={10} step={0.5} unit="mm"
              onChange={(heightMm) => placeCatheter(engine, sel.catheter.id, { ...p, heightMm })} />
          )}
          {sel.catheter.kind === 'halo_20' && (
            <button onClick={() => placeCatheter(engine, sel.catheter.id, null)}>このカテーテルを外す</button>
          )}
        </>
      )}
      {sel && sel.mode === 'free' && (
        p?.kind === 'free' ? (
          <>
            <Slider label="壁からの距離（押し込み）" value={p.heightMm} min={0.5} max={10} step={0.5} unit="mm"
              onChange={(heightMm) => placeCatheter(engine, sel.catheter.id, { ...p, heightMm })} />
            {sel.catheter.kind !== 'ablation_tip' && (
              <Slider label="回転" value={p.rotationDeg} min={0} max={350} step={10} unit="°"
                onChange={(rotationDeg) => placeCatheter(engine, sel.catheter.id, { ...p, rotationDeg })} />
            )}
            {sel.catheter.kind === 'circular_mapping' && (
              <Slider label="ループ径" value={p.diameterMm ?? CIRCULAR.defaultDiameterMm}
                min={CIRCULAR.diameterRangeMm[0]} max={CIRCULAR.diameterRangeMm[1]} step={1} unit="mm"
                onChange={(diameterMm) => placeCatheter(engine, sel.catheter.id, { ...p, diameterMm })} />
            )}
            {sel.catheter.kind !== 'ablation_tip' && (
              <button onClick={() => placeCatheter(engine, sel.catheter.id, null)}>このカテーテルを外す</button>
            )}
            {sel.catheter.kind === 'ablation_tip' && (
              <p className="note">{sel.catheter.electrodes[0].contactVertex < 0 ? '先端が接触していません（押し込む）' : '先端が接触しています。通電は「通電（ablation）」欄から'}</p>
            )}
          </>
        ) : <p className="note">3D ビューの心房表面をクリックして置きます。</p>
      )}
      <p className="note">
        カテーテルを選ぶと 3D 上でドラッグして動かせます（選択を解除すると視点を回せます）。
        His は H・V 電位を房室伝導のタイミングから合成し、A 電位は Koch 三角の心房筋から計算します。
      </p>
    </div>
  );
}
