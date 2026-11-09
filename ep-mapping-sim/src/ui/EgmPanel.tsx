import { SYSTEMS } from '../systems';
import { useSim } from '../state/store';

/**
 * 心内心電図パネル（プレースホルダ）。
 * TODO(Phase 3): EgmGenerator の出力を Canvas 2D でスクロール描画。
 *   チャンネル順は 体表 ECG(I, II, V1) → HRA → HIS → CS 9-10…1-2 → ABL d/p → RV。
 *   スイープ速度 25/50/100/200 mm/s、ゲイン可変、キャリパー計測。
 */
export function EgmPanel() {
  const theme = SYSTEMS[useSim((s) => s.system)];
  const channels = ['I', 'II', 'V1', 'HRA', 'HIS', 'CS 9-10', 'CS 7-8', 'CS 5-6', 'CS 3-4', 'CS 1-2', 'ABL d', 'ABL p', 'RV'];
  return (
    <section className="egm" style={{ background: theme.colors.panel, color: theme.colors.text }}>
      {channels.map((c) => (
        <div className="egm-row" key={c} style={{ borderColor: theme.colors.egmGrid }}>
          <span>{c}</span>
          <canvas width={1200} height={28} />
        </div>
      ))}
    </section>
  );
}
