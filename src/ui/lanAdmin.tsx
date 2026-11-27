// 관리 탭 "MFC 인계" — 실서버 모드에선 LAN 운행·인계·MFC 수령을 그대로(사용자 2026-11-27 "mfc 에서 입고발주 넣고 dc 에서 보내준 거 실시간 반영이 안 되나?").
// 운행(/cdcs/CDC01/trips) 정차마다: 차량 · MFC · 도착·인계 시각 · 실은 상품(TRF 상세) · 박스(실음/받음) · MFC 수령(입고 예정 받은 수량, 그 MFC 관리자 계정으로 읽힐 때). 5초마다.
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { MFCS } from '../config';
import { readMfcSide } from './lanMfc';
import { TrfLine } from './lanRefs';

interface Stop {
  seq: number;
  mfcId: string;
  state: string;
  trfIds?: string[];
  arrivedAt?: string | null;
  handedOverAt?: string | null;
  handover?: { result?: string; shippedBoxes?: number; receivedBoxes?: number; missingLpns?: string[]; extraLpns?: string[]; damagedLpns?: string[] } | null;
}
interface Trip {
  tripId: string;
  state: string;
  vehicleId?: string | null;
  shipDate?: string;
  departedAt?: string | null;
  stops: Stop[];
}
type Recv = Record<string, { got: number; exp: number }>;

const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const md = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '');
const mfcName = (id: string) => (MFCS.find((m) => m.id === id)?.name ?? id).replace(/^\d호점 /, '');
const STOP_KO: Record<string, string> = { PLANNED: '가는 중', ARRIVED: '도착', HANDED_OVER: '인계', DEPARTED: '인계 끝' };

export function LanHandoverTable({ q, mfcFilter }: { q: string; mfcFilter?: string | null }) {
  const { real } = useApp();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [recv, setRecv] = useState<Recv>({});
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!real) return;
    let on = true;
    const load = async () => {
      try {
        const r = await real.backend.client.call<{ items?: Trip[] }>('GET', '/cdcs/CDC01/trips', { query: { size: '100' } });
        const list = (r.body.items ?? []).filter((t) => t.departedAt);
        if (!on) return;
        setTrips(list);
        setAt(Date.now());
        // MFC 수령 — 도착한 정차의 TRF 만(입고 예정 받은 수량)
        const want = list.flatMap((t) => t.stops.filter((s) => s.arrivedAt).flatMap((s) => (s.trfIds ?? []).map((id) => ({ id, mfcId: s.mfcId }))));
        const got: Recv = {};
        for (const w of want) {
          const m = await readMfcSide(w.id, w.mfcId, []).catch(() => null);
          if (m?.promise) got[w.id] = { got: m.promise.lines.reduce((a, l) => a + l.receivedQty, 0), exp: m.promise.lines.reduce((a, l) => a + l.expectedQty, 0) };
        }
        if (on) setRecv(got);
      } catch {
        /* 다음 차례에 */
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real]);
  if (!real) return null;
  const k = q.trim().toUpperCase();
  const rows = (trips ?? [])
    .sort((a, b) => (b.departedAt ?? '').localeCompare(a.departedAt ?? ''))
    .flatMap((t) => t.stops.map((s) => ({ t, s })))
    .filter(({ t, s }) => (!mfcFilter || s.mfcId === mfcFilter) && (!k || `${t.tripId} ${t.vehicleId ?? ''} ${(s.trfIds ?? []).join(' ')}`.toUpperCase().includes(k)));
  return (
    <>
      <div className="note">실서버 운행 · 5초마다 · {at ? `${hm(new Date(at).toISOString())} 기준` : '읽는 중'}</div>
      <div className="lho">
        {rows.map(({ t, s }) => {
          const ho = s.handover;
          const rv = (s.trfIds ?? []).map((id) => recv[id]).filter(Boolean);
          const got = rv.reduce((a, x) => a + x!.got, 0);
          const exp = rv.reduce((a, x) => a + x!.exp, 0);
          return (
            <div key={`${t.tripId}-${s.seq}`} className="lho-row">
              <div className="lho-h">
                <b>{t.vehicleId ?? '-'}</b>
                <span>{mfcName(s.mfcId)}</span>
                <em className={s.state === 'DEPARTED' || s.state === 'HANDED_OVER' ? 'ok' : ''}>{STOP_KO[s.state] ?? s.state}</em>
              </div>
              <div className="lho-t">
                출발 {md(t.departedAt)} {hm(t.departedAt)}
                {s.arrivedAt ? ` · 도착 ${hm(s.arrivedAt)}` : ''}
                {s.handedOverAt ? ` · 인계 ${hm(s.handedOverAt)}` : ''} · {t.tripId}
              </div>
              {(s.trfIds ?? []).map((id) => (
                <TrfLine key={id} trfId={id} />
              ))}
              <div className="lho-n">
                <span>
                  박스 {ho ? `${ho.receivedBoxes ?? 0}/${ho.shippedBoxes ?? 0}` : '-'}
                  {ho?.result ? ` · ${ho.result === 'MATCHED' ? '일치' : '불일치'}` : ''}
                </span>
                <b className={rv.length ? (got === exp ? 'ok' : 's-bad') : ''}>{rv.length ? `MFC 수령 ${got}/${exp}` : s.arrivedAt ? 'MFC 수령 전' : ''}</b>
              </div>
            </div>
          );
        })}
        {trips && !rows.length && <div className="note">출발한 운행이 없습니다</div>}
      </div>
    </>
  );
}
