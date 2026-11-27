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

// ── 지난 TRF · 진행 중 작업 · R/T 회수(실서버) — 사용자 2026-11-27 "응"(관리 탭 나머지도 실서버로) ──
const TRF_KO: Record<string, string> = { DEPARTED: '출발', CANCELLED: '취소' };
const TASK_KO: Record<string, string> = { CREATED: '대기', ACCEPTED: '받음', ASSIGNED: '배정', IN_PROGRESS: '하는 중', ON_HOLD: '보류' };
const KIND_KO: Record<string, string> = { PICK: '피킹', SORT: '분배', INSPECT: '검품', LOAD: '상차' };

function usePoll<T>(load: () => Promise<T>, ms = 5000): [T | null, number] {
  const [v, setV] = useState<T | null>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let on = true;
    const go = () =>
      load()
        .then((x) => {
          if (!on) return;
          setV(x);
          setAt(Date.now());
        })
        .catch(() => undefined);
    void go();
    const t = setInterval(go, ms);
    return () => {
      on = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [v, at];
}

/** 지난 TRF — 출발·취소한 TRF(최근 순) */
export function LanPastTable({ q, mfcFilter, day }: { q: string; mfcFilter?: string | null; day: string }) {
  const { real } = useApp();
  const [items, at] = usePoll(async () =>
    real
      ? ((await real.backend.client.call<{ items?: { trfId: string; trfNumber?: string; state: string; mfcId: string; dueAt?: string; updatedAt?: string; approvedQty?: number; pickedQty?: number }[] }>('GET', '/cdcs/CDC01/transfers', { query: { size: '100' } })).body.items ?? [])
      : [],
  );
  if (!real) return null;
  const k = q.trim().toUpperCase();
  const rows = (items ?? [])
    .filter((x) => x.state === 'DEPARTED' || x.state === 'CANCELLED')
    .filter((x) => (!mfcFilter || x.mfcId === mfcFilter) && (!k || `${x.trfId} ${x.trfNumber ?? ''}`.toUpperCase().includes(k)) && (!day || (x.dueAt ?? '').startsWith(day)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return (
    <>
      <div className="note">실서버 TRF · 5초마다 · {at ? `${hm(new Date(at).toISOString())} 기준` : '읽는 중'}</div>
      <div className="lho">
        {rows.map((x) => (
          <div key={x.trfId} className="lho-row">
            <div className="lho-h">
              <TrfLine trfId={x.trfId} />
              <em className={x.state === 'DEPARTED' ? 'ok' : ''}>{TRF_KO[x.state] ?? x.state}</em>
            </div>
            <div className="lho-t">
              {mfcName(x.mfcId)} · 집음 {x.pickedQty ?? 0}/{x.approvedQty ?? 0} · 마지막 변경 {md(x.updatedAt)} {hm(x.updatedAt)}
            </div>
          </div>
        ))}
        {items && !rows.length && <div className="note">출발·취소한 TRF 가 없습니다</div>}
      </div>
    </>
  );
}

/** 진행 중 작업 — 끝나지 않은 피킹·분배·검품·상차 작업 */
export function LanTasksTable({ q }: { q: string }) {
  const { real } = useApp();
  const [items, at] = usePoll(async () =>
    real
      ? ((await real.backend.client.call<{ items?: { taskId: string; taskNumber?: string; kind: string; state: string; assigneeId?: string | null; trfIds?: string[]; waveNumber?: string; lines: { pickedQty: number; plannedQty: number; shortQty: number }[] }[] }>('GET', '/cdcs/CDC01/tasks', { query: { size: '100' } })).body.items ?? [])
      : [],
  );
  if (!real) return null;
  const k = q.trim().toUpperCase();
  const rows = (items ?? []).filter((t) => !['DONE', 'PARTIAL', 'CANCELLED', 'EXCEPTION'].includes(t.state)).filter((t) => !k || `${t.taskId} ${t.taskNumber ?? ''} ${(t.trfIds ?? []).join(' ')}`.toUpperCase().includes(k));
  return (
    <>
      <div className="note">실서버 작업 · 5초마다 · {at ? `${hm(new Date(at).toISOString())} 기준` : '읽는 중'}</div>
      <div className="lho">
        {rows.map((t) => {
          const done = t.lines.reduce((a, l) => a + l.pickedQty + l.shortQty, 0);
          const total = t.lines.reduce((a, l) => a + l.plannedQty, 0);
          return (
            <div key={t.taskId} className="lho-row">
              <div className="lho-h">
                <b>{t.taskNumber ?? t.taskId.slice(0, 13)}</b>
                <span>
                  {KIND_KO[t.kind] ?? t.kind} · {t.waveNumber ?? ''}
                </span>
                <em>{TASK_KO[t.state] ?? t.state}</em>
              </div>
              {(t.trfIds ?? []).map((id) => (
                <TrfLine key={id} trfId={id} />
              ))}
              <div className="lho-n">
                <span>{t.assigneeId ? `작업자 ${t.assigneeId.replace(/^OP-/, '').slice(0, 6)}` : '아직 아무도 안 받음'}</span>
                <b>
                  {done}/{total}
                </b>
              </div>
            </div>
          );
        })}
        {items && !rows.length && <div className="note">진행 중인 작업이 없습니다</div>}
      </div>
    </>
  );
}

/** R/T 회수 — 운행마다 실은 R/T. 회수(빈 R/T 돌려받기)는 서버에 기록하는 곳이 아직 없음 */
export function LanRtTable({ mfcFilter }: { mfcFilter?: string | null }) {
  const { real } = useApp();
  const [items, at] = usePoll(async () =>
    real ? ((await real.backend.client.call<{ items?: (Trip & { rtCount?: number | null; boxCount?: number })[] }>('GET', '/cdcs/CDC01/trips', { query: { size: '100' } })).body.items ?? []) : [],
  );
  if (!real) return null;
  const rows = (items ?? []).filter((t) => t.departedAt && t.stops.some((s) => !mfcFilter || s.mfcId === mfcFilter)).sort((a, b) => (b.departedAt ?? '').localeCompare(a.departedAt ?? ''));
  return (
    <>
      <div className="note">실서버 운행 · {at ? `${hm(new Date(at).toISOString())} 기준` : '읽는 중'} · R/T 회수(빈 R/T 돌려받기)는 서버에 기록하는 곳이 아직 없어 실은 수만 보입니다</div>
      <div className="lho">
        {rows.map((t) => (
          <div key={t.tripId} className="lho-row">
            <div className="lho-h">
              <b>{t.vehicleId ?? '-'}</b>
              <span>{t.stops.map((s) => mfcName(s.mfcId)).join(' · ')}</span>
              <em>{t.state === 'COMPLETED' ? '복귀' : '운행 중'}</em>
            </div>
            <div className="lho-n">
              <span>
                {t.tripId} · 출발 {md(t.departedAt)} {hm(t.departedAt)}
              </span>
              <b>
                R/T {t.rtCount ?? '-'} · 박스 {t.boxCount ?? '-'}
              </b>
            </div>
          </div>
        ))}
        {items && !rows.length && <div className="note">출발한 운행이 없습니다</div>}
      </div>
    </>
  );
}
