// TRF·Wave 짧은 번호(T286575 · W6307) — 백오피스가 정한 표시값. 긴 ID(TRF-SR-…·WAVE-uuid) 대신 이걸 보이고, 누르면 DC 백오피스 상세로
// (사용자 2026-11-27 "TRF 식별값이랑 WAVE 식별값 백오피스에서 짧게 정했으니까 T286575 [W6307](…/trf-wave/waves/WAVE-…) 이렇게").
// 번호는 GET /cdcs/CDC01/transfers 응답(trfNumber·waveNumber·waveId)을 읽을 때마다 여기 모아 둔다.
import { useSyncExternalStore } from 'react';
import { DC_BACKOFFICE_URL } from '../config';

interface Ref {
  trf?: string;
  wave?: string;
  waveId?: string | null;
}
let refs: Record<string, Ref> = {};
const subs = new Set<() => void>();

/** transfers 목록 응답을 넣음 */
export function rememberTransfers(items: { trfId: string; trfNumber?: string; waveNumber?: string | null; waveId?: string | null }[]) {
  let changed = false;
  const next = { ...refs };
  for (const x of items) {
    const old = next[x.trfId];
    const r: Ref = { trf: x.trfNumber ?? old?.trf, wave: x.waveNumber ?? old?.wave, waveId: x.waveId ?? old?.waveId };
    if (!old || old.trf !== r.trf || old.wave !== r.wave || old.waveId !== r.waveId) {
      next[x.trfId] = r;
      changed = true;
    }
  }
  if (!changed) return;
  refs = next;
  for (const f of subs) f();
}

export function useRefs(): Record<string, Ref> {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => refs,
  );
}

const trfUrl = (trfId: string) => `${DC_BACKOFFICE_URL}/c/CDC01/trf-wave/trf/${encodeURIComponent(trfId)}`;
const waveUrl = (waveId: string) => `${DC_BACKOFFICE_URL}/c/CDC01/trf-wave/waves/${encodeURIComponent(waveId)}`;

/** T286575 — 누르면 백오피스 TRF 상세. 번호를 아직 모르면 긴 ID 끝 8자 */
export function TrfRef({ trfId, number }: { trfId: string; number?: string }) {
  const r = useRefs()[trfId];
  const label = number ?? r?.trf ?? `…${trfId.slice(-8)}`;
  return (
    <a className="ref" href={trfUrl(trfId)} target="_blank" rel="noreferrer" title={trfId} onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
}

/** W6307 — 누르면 백오피스 Wave 상세 */
export function WaveRef({ waveId, number }: { waveId: string; number?: string | null }) {
  const label = number ?? `…${waveId.slice(-8)}`;
  return (
    <a className="ref" href={waveUrl(waveId)} target="_blank" rel="noreferrer" title={waveId} onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
}

/** T286575 W6307 — TRF 와 그 Wave(있으면) */
export function TrfWaveRef({ trfId }: { trfId: string }) {
  const r = useRefs()[trfId];
  return (
    <span className="refs">
      <TrfRef trfId={trfId} />
      {r?.waveId && <WaveRef waveId={r.waveId} number={r.wave} />}
    </span>
  );
}

/** 문자열 속 긴 ID 를 짧은 번호로(실행 단계 설명 등 글자로만 보일 때) */
export function shortIds(text: string, map: Record<string, Ref>): string {
  let out = text;
  for (const [id, r] of Object.entries(map)) {
    if (r.trf) out = out.split(id).join(r.trf);
    if (r.waveId && r.wave) out = out.split(r.waveId).join(r.wave);
  }
  return out;
}
