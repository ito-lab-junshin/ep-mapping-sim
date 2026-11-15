import { useEffect } from 'react';
import { useSim } from './store';
import { SCENARIOS } from '../core/arrhythmia';
import { defaultProtocol, type ProtocolConfig } from '../core/pacing/ProtocolSession';
import type { ArrhythmiaId } from '../core/types';
import { AF_TYPE_IDS, AP_SITE_IDS, type AfType, type ApSite } from '../core/params';
import type { PacingSite } from '../core/sim/SimulationEngine';

/**
 * 症例と刺激プロトコルの設定を URL パラメータに保存する（§5.6：授業で共有）。
 * 例：?case=avnrt&kind=extrastimulus&site=HRA&s1=600&n=8&s2=500&s2min=150
 * WPW は副伝導路の部位（ap=leftFreeWall|rightFreeWall|posteroseptal|anteroseptal）と、部位を伏せるか（aphide=1）、
 * AF は AF の型（aftype=pv|pvSvc）も保存する。
 */
const NUM: [keyof ProtocolConfig, string][] = [
  ['s1Ms', 's1'], ['s1Beats', 'n'], ['s2StartMs', 's2'], ['s2MinMs', 's2min'], ['s2StepMs', 'step'],
  ['burstFromMs', 'bfrom'], ['burstToMs', 'bto'], ['burstBeats', 'bn'],
];

export function readUrl() {
  const q = new URLSearchParams(window.location.search);
  const s = useSim.getState();
  const id = q.get('case') as ArrhythmiaId | null;
  if (id && SCENARIOS[id]) s.setArrhythmia(id);
  const ap = q.get('ap') as ApSite | null;
  if (ap && AP_SITE_IDS.includes(ap)) s.setCaseOptionsRaw('wpw', { apSite: ap, apHidden: q.get('aphide') === '1' });
  const aft = q.get('aftype') as AfType | null;
  if (aft && AF_TYPE_IDS.includes(aft)) s.setCaseOptionsRaw('af', { afType: aft });
  const kind = q.get('kind');
  if (kind === 'extrastimulus' || kind === 'burst') {
    const cfg = defaultProtocol(kind, (q.get('site') as PacingSite) ?? 'HRA') as unknown as Record<string, number | string | null>;
    for (const [k, p] of NUM) { const v = q.get(p); if (v !== null && Number.isFinite(Number(v))) cfg[k] = Number(v); }
    const s3 = q.get('s3');
    cfg.s3Ms = s3 !== null && Number.isFinite(Number(s3)) ? Number(s3) : null;
    s.setProtocol(cfg as unknown as ProtocolConfig);
  }
}

/** URL を store に書き込む（読み込みは main.tsx で最初の描画の前に 1 回だけ行う） */
export function useUrlSync() {
  const arrhythmia = useSim((s) => s.arrhythmia);
  const protocol = useSim((s) => s.protocol);
  const options = useSim((s) => s.caseOptions[s.arrhythmia]);
  useEffect(() => {
    const q = new URLSearchParams();
    q.set('case', arrhythmia);
    if (arrhythmia === 'wpw' && options?.apSite) {
      q.set('ap', options.apSite);
      if (options.apHidden) q.set('aphide', '1');
    }
    if (arrhythmia === 'af' && options?.afType && options.afType !== 'pv') q.set('aftype', options.afType);
    if (protocol) {
      q.set('kind', protocol.kind);
      q.set('site', protocol.site);
      const rec = protocol as unknown as Record<string, number | null>;
      for (const [k, p] of NUM) q.set(p, String(rec[k]));
      if (protocol.s3Ms !== null) q.set('s3', String(protocol.s3Ms));
    }
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, [arrhythmia, protocol, options]);
}
