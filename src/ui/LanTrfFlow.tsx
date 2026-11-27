// 실서버(LAN) TRF 흐름 — PDA 로 하고 있는 TRF 를 TRF 번호로 오른쪽 탭 맨 위에(사용자 2026-11-26 "지금 pda 로 작업하고 있는 흐름이 TRF 번호로 오른쪽탭에 제대로 나와야").
// 서버가 확정한 것만 그린다: 인수 진행(internal transfer-intakes) · 작업(tasks?waveId) · 박스(lpns?trfId) · 사건(events). 3초마다 다시 읽음.
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import type { TransferIntake } from '../domain/contract';
import { ApiProblem } from '../domain/contract';
import { Barcode } from './Barcode';
import { startLanRun } from './LanIncoming';
import { productsText, rememberTransfers, TrfLine, TrfRef, useTrfDetail, WaveRef } from './lanRefs';
import { MFCS } from '../config';
import { mfcStage, readMfcSide, type MfcLedgerItem, type MfcSide } from './lanMfc';

const mfcName = (id: string) => MFCS.find((m) => m.id === id)?.name ?? id;
const md = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
import { lanRunSnapshot as useLanRunSnapshot, setLanRun, useLanRun } from './lanRunStore';

const STAGES = ['인수', '할당', 'Wave 배포', '피킹', '분배·패킹', '검품', '상차', '출발', 'MFC 도착', '하차 인계', '운행 종료'] as const;
const COLORS = ['#8e9aaf', '#56ccf2', '#2f80ed', '#27ae60', '#9b51e0', '#f2994a', '#eb5757', '#219653', '#2d9cdb', '#bb6bd9', '#6c7a89'];
/** 지금 하고 있는(아직 안 끝난) 단계 번호 — 다 끝났으면 STAGES.length */
function stageOf(t: TransferIntake, trip?: Trip | null, stop?: Stop | null): number {
  if (t.state === 'DEPARTED' && trip && stop) {
    if (trip.state === 'COMPLETED') return 11;
    if (stop.state === 'PLANNED') return 8;
    if (stop.state === 'ARRIVED') return 9;
    return 10;
  }
  switch (t.state) {
    case 'RECEIVED':
      return 0;
    case 'ALLOCATING':
      return 1;
    case 'ALLOCATED':
    case 'PARTIALLY_ALLOCATED':
      return 2;
    case 'IN_WAVE':
      return 3;
    case 'PICKED':
      return 4;
    case 'SORTED':
      return 5;
    case 'INSPECTED':
      return 6;
    case 'LOADED':
      return 7;
    case 'DEPARTED':
      return 8;
    default:
      return 0;
  }
}
const hm = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '';
const who = (id?: string | null) => (id ? (id.startsWith('OP-') ? `작업자 ${id.slice(3, 9)}` : id) : '');

export interface Stop {
  seq: number;
  mfcId: string;
  state: string;
  trfIds?: string[];
  arrivedAt?: string | null;
  handedOverAt?: string | null;
  departedAt?: string | null;
  plannedArrivalAt?: string | null;
}
export interface Trip {
  tripId: string;
  state: string;
  vehicleId?: string | null;
  departedAt?: string | null;
  endedAt?: string | null;
  stops: Stop[];
  events?: {
    at: string;
    type: string;
    stopSeq?: number | null;
    actorId?: string | null;
    source?: string | null;
  }[];
}
interface Task {
  taskId: string;
  taskNumber?: string;
  state: string;
  regionCode?: string | null;
  assigneeId?: string | null;
  completedAt?: string | null;
  lines: {
    sku: string;
    locationCode: string;
    plannedQty: number;
    pickedQty: number;
    shortQty: number;
  }[];
}
interface Lpn {
  lpn: string;
  contents: { sku: string; qty: number }[];
  sortedAt?: string | null;
  sortedBy?: string | null;
  inspection?: string | null;
  inspectedAt?: string | null;
  loaded: boolean;
  loadedAt?: string | null;
  dockCode?: string | null;
}
interface Ev {
  at: string;
  type: string;
  refNumber?: string | null;
  taskId?: string | null;
  trfId?: string | null;
  waveId?: string | null;
  actorId?: string | null;
}
interface Recent {
  trfId: string;
  trfNumber?: string;
  state: string;
  updatedAt?: string;
}
interface Data {
  intake: TransferIntake;
  trfNumber?: string;
  waveNumber?: string;
  tasks: Task[];
  lpns: Lpn[];
  events: Ev[];
  trip: Trip | null;
  /** MFC 쪽(입고 예정·작업·재고 이력) — 못 읽으면 null */
  mfc: MfcSide | null;
  at: number;
}

const TRIP_KO: Record<string, string> = {
  SCHEDULED: '계획완료',
  CHECKED_IN: '입차',
  LOADED: '상차완료',
  DEPARTED: '출차',
  ARRIVED: 'MFC 도착',
  STOP_ARRIVED: 'MFC 도착',
  HANDED_OVER: '하차 인계',
  STOP_HANDED_OVER: '하차 인계',
  STOP_DEPARTED: '정차 출발',
  COMPLETED: '운행 종료',
  TRIP_COMPLETED: '운행 종료',
  ENDED: '운행 종료',
};

const EV_KO: Record<string, string> = {
  TRF_RECEIVED: 'TRF 인수',
  WAVE_CREATED: 'Wave 만듦',
  WAVE_RELEASED: 'Wave 배포',
  TASK_STARTED: '피킹 시작',
  TASK_COMPLETED: '피킹 끝',
};

/** open = 이 탭에서 펼쳐 둘지(TRF 탭만 펼침, 다른 탭(운송 포함)은 접힌 띠 — 사용자 2026-11-26 "다른 탭 눌러도 운송탭만 떠 있어") */
export function LanTrfFlow({ open = true }: { open?: boolean }) {
  const { real } = useApp();
  const { trfId, busy, steps } = useLanRun();
  const detail = useTrfDetail(trfId);
  const runningThis = busy && [...(steps ?? [])].reverse().find((x) => x.trfId)?.trfId === trfId;
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 탭이 바뀌면 그 탭 기본값으로 — 직접 접거나 펼친 건 그 탭 안에서만
  const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => setMine(null), [open]);
  const fold = mine ?? !open;
  const setFold = (v: boolean) => setMine(v);
  const [recent, setRecent] = useState<Recent[]>([]);
  // 늘 보이게 — 고른 TRF 가 없으면 가장 최근 시험 TRF 를 고름, 고를 수 있게 최근 시험 TRF 목록(사용자 2026-11-26 "이 UI 좋았는데 계속 볼 수 있게")
  useEffect(() => {
    if (!real) return;
    let on = true;
    const load = () =>
      real.backend.client
        .call<{ items?: Recent[] }>('GET', '/cdcs/CDC01/transfers', {
          query: { size: '100' },
        })
        .then((r) => {
          if (!on) return;
          rememberTransfers(r.body.items ?? []);
          const sims = (r.body.items ?? []).filter((x) => /^TRF-(SIM|SR)-/.test(x.trfId) && x.state !== 'CANCELLED').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
          setRecent(sims.slice(0, 6));
          if (!useLanRunSnapshot().trfId && sims[0]) setLanRun({ trfId: sims[0].trfId });
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real]);
  useEffect(() => {
    if (!real || !trfId) return;
    let on = true;
    setD(null);
    const load = async () => {
      try {
        const c = real.backend.client;
        const intake = await real.internal.getTransferIntake(trfId);
        const [sum, tasks, lpns, events, trips] = await Promise.all([
          c
            .call<{
              items?: {
                trfId: string;
                trfNumber?: string;
                waveNumber?: string;
              }[];
            }>('GET', '/cdcs/CDC01/transfers', { query: { size: '100' } })
            .then((r) => {
              rememberTransfers(r.body.items ?? []);
              return (r.body.items ?? []).find((x) => x.trfId === trfId);
            }),
          intake.waveId
            ? c
                .call<{ items?: Task[] }>('GET', '/cdcs/CDC01/tasks', {
                  query: { waveId: intake.waveId },
                })
                .then((r) => r.body.items ?? [])
            : Promise.resolve([] as Task[]),
          c
            .call<{ items?: Lpn[] }>('GET', '/cdcs/CDC01/lpns', {
              query: { trfId, size: '100' },
            })
            .then((r) => r.body.items ?? []),
          c
            .call<{ items?: Ev[] }>('GET', '/cdcs/CDC01/events', {
              query: { size: '200' },
            })
            .then((r) => r.body.items ?? []),
          c
            .call<{ items?: Trip[] }>('GET', '/cdcs/CDC01/trips', {
              query: { size: '100' },
            })
            .then((r) => r.body.items ?? [])
            .catch(() => [] as Trip[]),
        ]);
        const trip = trips.find((x) => x.stops.some((st) => (st.trfIds ?? []).includes(trfId))) ?? null;
        const taskIds = new Set(tasks.map((t) => t.taskId));
        // 출발한 뒤부터 MFC 쪽을 읽음(입고 예정은 출발 사건으로 생김)
        const mfc = ['LOADED', 'DEPARTED'].includes(intake.state) ? await readMfcSide(trfId, intake.mfcId, intake.lines.map((l) => l.sku)).catch(() => null) : null;
        if (!on) return;
        setD({
          mfc,
          intake,
          trfNumber: sum?.trfNumber,
          waveNumber: sum?.waveNumber,
          tasks,
          lpns,
          trip,
          events: events.filter((e) => e.trfId === trfId || (intake.waveId && e.waveId === intake.waveId && !e.taskId) || (e.taskId && taskIds.has(e.taskId))),
          at: Date.now(),
        });
        setErr(null);
      } catch (e) {
        if (on) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = setInterval(load, 3000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real, trfId]);
  if (!real || !trfId) return null;
  const t = d?.intake;
  const trip = d?.trip ?? null;
  const stop = trip?.stops.find((st) => (st.trfIds ?? []).includes(trfId)) ?? null;
  const cur = t ? stageOf(t, trip, stop) : -1;
  const loadedLpns = (d?.lpns ?? []).filter((l) => l.loaded);
  const q = (k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'sortedQty' | 'inspectedQty' | 'loadedQty' | 'departedQty') => (t ? t.progress.reduce((a, p) => a + p[k], 0) : 0);
  const stageQty = [
    '',
    `${q('allocatedQty')}/${q('approvedQty')}`,
    d?.waveNumber ?? '',
    `${q('pickedQty')}/${q('allocatedQty')}`,
    `${q('sortedQty')}/${q('pickedQty')}`,
    `${q('inspectedQty')}/${q('sortedQty')}`,
    `${q('loadedQty')}/${q('inspectedQty')}`,
    `${q('departedQty')}`,
    stop?.arrivedAt ? hm(stop.arrivedAt) : '',
    stop?.handedOverAt ? hm(stop.handedOverAt) : '',
    trip?.endedAt ? hm(trip.endedAt) : '',
  ];
  // 시간 순 기록 — 사건 + 박스(분류·검품·상차 시각)
  const log: { at: string; what: string; who?: string }[] = [
    ...(d?.events ?? []).map((e) => {
      const task = d?.tasks.find((x) => x.taskId === e.taskId);
      return {
        at: e.at,
        what: `${EV_KO[e.type] ?? e.type}${e.refNumber ? ` ${e.refNumber}` : ''}${task?.regionCode && e.type === 'TASK_STARTED' ? ` · 지역 ${task.regionCode}` : ''}`,
        who: who(e.actorId),
      };
    }),
    // MFC 쪽 — 도착·수령(재고 +)·품질검사·적치(판매 가능)·입고 끝
    ...(d?.mfc?.promise?.arrivedAt ? [{ at: d.mfc.promise.arrivedAt, what: 'MFC 입고 도착', who: 'MFC' }] : []),
    ...(d?.mfc?.ledger ?? []).map((x) => ({ at: x.occurredAt, what: ledgerText(x), who: 'MFC' })),
    ...(d?.mfc?.promise?.closure?.closedAt ? [{ at: d.mfc.promise.closure.closedAt, what: 'MFC 입고 끝(종결)', who: 'MFC' }] : []),
    ...(trip?.events ?? [])
      .filter((e) => e.stopSeq == null || e.stopSeq === stop?.seq)
      .map((e) => ({
        at: e.at,
        what: `운행 ${TRIP_KO[e.type] ?? e.type}${e.stopSeq ? ` · 정차 ${e.stopSeq}` : ''}`,
        who: e.source === 'mfc-app' ? 'PDA' : e.source === 'pmart-cdc-simulation' ? '시뮬레이터' : '',
      })),
    ...(d?.lpns ?? []).flatMap((l) => [
      ...(l.sortedAt
        ? [
            {
              at: l.sortedAt,
              what: `박스 닫음 ${l.lpn} · ${l.contents.map((c) => `${c.sku}×${c.qty}`).join(', ')}`,
              who: who(l.sortedBy),
            },
          ]
        : []),
      ...(l.inspectedAt
        ? [
            {
              at: l.inspectedAt,
              what: `검품 ${l.inspection === 'PASSED' ? '합격' : l.inspection === 'FAILED' ? '불합격' : l.inspection} ${l.lpn}`,
            },
          ]
        : []),
      ...(l.loadedAt
        ? [
            {
              at: l.loadedAt,
              what: `상차 ${l.lpn}${l.dockCode ? ` · 도크 ${l.dockCode}` : ''}`,
            },
          ]
        : []),
    ]),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section className="sec wflow lan-trf">
      <div className="wf-head">
        <div>
          <b>
            <TrfRef trfId={trfId} {...(d?.trfNumber ? { number: d.trfNumber } : {})} />
          </b>
          <small>
            {t?.waveId ? <WaveRef waveId={t.waveId} number={d?.waveNumber ?? null} /> : 'Wave 전'} · {t?.mfcId ? mfcName(t.mfcId) : ''} · 실서버
          </small>
          <small className="lt-prod">
            {productsText(detail)}
          </small>
        </div>
        <span className={`wf-pill ${t?.state === 'DEPARTED' ? 'off' : 'busy'}`}>{t?.state ?? '읽는 중'}</span>
        <button className="wf-btn x" onClick={() => setFold(!fold)} aria-label={fold ? '펼치기' : '접기'} title={fold ? '펼치기' : '접기'}>
          {fold ? '▾' : '▴'}
        </button>
      </div>
      {/* 이 TRF 바로 작업 — 알림을 놓쳐도 카드에서 시작(사용자 2026-11-27 "어딨냐고 방금 알림 받은 거 작업해야 된다고") */}
      {!fold && d?.intake && !['DEPARTED', 'CANCELLED', 'ALLOCATION_FAILED'].includes(d.intake.state) && (
        <div className="lt-go">
          {runningThis ? (
            <span>작업 중 — {[...(steps ?? [])].at(-1)?.name.split(' (')[0]}</span>
          ) : (
            <>
              <button disabled={busy} title={busy ? '다른 TRF 실행이 끝나야 함' : undefined} onClick={() => real && startLanRun(real, { mfcId: d.intake.mfcId, pda: true, resumeTrfId: trfId })}>
                PDA 로 작업
              </button>
              <button disabled={busy} title={busy ? '다른 TRF 실행이 끝나야 함' : '시뮬레이터가 피킹·분류·검품·상차를 대신'} onClick={() => real && startLanRun(real, { mfcId: d.intake.mfcId, pda: false, resumeTrfId: trfId })}>
                가상 작업자(자동)로
              </button>
            </>
          )}
        </div>
      )}
      {!fold && recent.length > 1 && (
        <div className="lt-pick">
          {recent.map((x) => (
            <button key={x.trfId} className={x.trfId === trfId ? 'on' : ''} onClick={() => setLanRun({ trfId: x.trfId })} title={`${x.trfId} · ${x.state}`}>
              {x.trfNumber ?? x.trfId.replace('TRF-SIM-', '')}
            </button>
          ))}
        </div>
      )}
      {!fold && (
        <>
          {err && <div className="note">읽기 실패 — {err}</div>}

          <div className="wf-flow-h">
            <span>TRF 흐름</span>
            <small>{d ? `${hm(new Date(d.at).toISOString())} 기준` : ''}</small>
          </div>
          <ol className="wf-stepper">
            {STAGES.map((s, i) => (
              <li key={s} className={i === cur ? 'now' : i < cur ? 'done' : ''} style={{ ['--c' as string]: COLORS[i] }}>
                <i>{i < cur ? '✓' : i + 1}</i>
                <span className="l">{s}</span>
                <span className="t">{i <= cur ? stageQty[i] : ''}</span>
              </li>
            ))}
          </ol>

          {trip && stop && t?.state === 'DEPARTED' && <TripActions trip={trip} stop={stop} boxes={loadedLpns.map((l) => l.lpn)} />}

          {d?.mfc && <MfcBlock m={d.mfc} />}

          {!!d?.tasks.length && (
            <>
              <div className="wf-flow-h">
                <span>피킹 작업</span>
                <small>{d.tasks.length}건</small>
              </div>
              <div className="lt-list">
                {d.tasks.map((x) => (
                  <div key={x.taskId} className="lt-card">
                    <div className="lt-h">
                      <b>{x.taskNumber ?? x.taskId.slice(0, 13)}</b>
                      {x.regionCode && <span>지역 {x.regionCode}</span>}
                      <em className={x.state === 'DONE' ? 'ok' : ''}>{x.state}</em>
                    </div>
                    {x.lines.map((l) => (
                      <div key={l.sku + l.locationCode} className="lt-line">
                        <span>{l.locationCode}</span>
                        <span>{l.sku}</span>
                        <b>
                          {l.pickedQty}/{l.plannedQty}
                          {l.shortQty ? ` · 부족 ${l.shortQty}` : ''}
                        </b>
                      </div>
                    ))}
                    {(x.assigneeId || x.completedAt) && (
                      <small>
                        {who(x.assigneeId)}
                        {x.completedAt ? ` · ${hm(x.completedAt)} 끝` : ''}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {!!d?.lpns.length && (
            <>
              <div className="wf-flow-h">
                <span>박스(LPN)</span>
                <small>{d.lpns.length}개</small>
              </div>
              <div className="lt-list">
                {d.lpns.map((l) => (
                  <div key={l.lpn} className="lt-line box">
                    <span>{l.lpn}</span>
                    <span>{l.contents.map((c) => `${c.sku}×${c.qty}`).join(', ')}</span>
                    <b className={l.loaded ? 'ok' : ''}>{l.loaded ? '상차' : l.inspection === 'PASSED' ? '검품 합격' : l.inspection === 'FAILED' ? '불합격' : '검품 전'}</b>
                  </div>
                ))}
              </div>
            </>
          )}

          {log.length > 0 && (
            <>
              <div className="wf-flow-h">
                <span>기록</span>
                <small>최근 순</small>
              </div>
              <ol className="lt-log">
                {log.slice(0, 30).map((x, i) => (
                  <li key={i}>
                    <span className="t">{hm(x.at)}</span>
                    <span>{x.what}</span>
                    {x.who && <small>{x.who}</small>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** 출차 뒤 — 실서버엔 DC 트럭 기사 앱이 없어 도착·정차 출발·운행 종료를 운영자로 보낸다(transport-execution, OPERATOR). 하차 인계는 MFC 점원이 PDA 로(사용자 2026-11-26 "도착 보내는 버튼을 시뮬에 만들어도 되고") */
export function TripActions({ trip, stop, boxes }: { trip: Trip; stop: Stop; boxes: string[] }) {
  const { real } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!real) return null;
  // 멱등 키는 헤더라 영문만(한글이면 fetch 가 헤더를 못 만듦 — 사용자 2026-11-26 "MFC 도착 막힘 … non ISO-8859-1")
  const send = async (path: string, label: string, slug: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await real.backend.client.call('POST', path, {
        body: {},
        idempotencyKey: `sim-lan-${slug}-${trip.tripId}-${stop.seq}`,
      });
      setMsg(`${label} 보냄`);
    } catch (e) {
      setMsg(`${label} 막힘 — ${e instanceof ApiProblem ? `${e.problem.code} ${e.problem.detail ?? ''}` : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const base = `/trips/${encodeURIComponent(trip.tripId)}`;
  return (
    <div className="lt-act">
      <div className="lt-act-h">
        <b>
          차량 {trip.vehicleId ?? '-'} · {mfcName(stop.mfcId)} {STOP_KO[stop.state] ?? stop.state}
        </b>
        <span>
          운행 {trip.tripId}
          {stop.plannedArrivalAt ? ` · 도착 예정 ${md(stop.plannedArrivalAt)}` : ''}
          {stop.arrivedAt ? ` · 도착 ${md(stop.arrivedAt)}` : ''}
        </span>
      </div>
      {trip.state === 'DEPARTED' && stop.state === 'PLANNED' && (
        <button disabled={busy} onClick={() => void send(`${base}/stops/${stop.seq}/arrivals`, 'MFC 도착', 'arrive')}>
          MFC 도착 보내기
        </button>
      )}
      {stop.state === 'ARRIVED' && (
        <>
          <p>
            <b>MFC 도착함 {hm(stop.arrivedAt)}</b> · 다음은 하차 인계 — MFC 점원이 PDA(입고 → 하차 인계)로 박스를 찍습니다
          </p>
          <div className="lt-codes">
            {boxes.map((b) => (
              <Barcode key={b} value={b} caption="하차 인계할 박스" />
            ))}
          </div>
        </>
      )}
      {/* 정차 출발·운행 종료는 DC 가 누르는 게 아님 — MFC 하차 인계가 끝나면 자동(사용자 2026-11-27 "운행종료는 dc 에 있으면 안 되지, mfc 에서 하차완료해야 자동으로"). 백엔드 TE-2 요청 */}
      {stop.state === 'HANDED_OVER' && <p>MFC 하차 인계 끝 — 곧 정차 출발·운행 종료(서버 자동)</p>}
      {trip.state === 'COMPLETED' && <p>운행 종료</p>}
      {msg && <small>{msg}</small>}
    </div>
  );
}

const TRIP_STATE_KO: Record<string, string> = {
  SCHEDULED: '계획완료',
  CHECKED_IN: '입차',
  LOADED: '상차완료',
  DEPARTED: '운행 중',
  COMPLETED: '운행 종료',
  TRIP_COMPLETED: '운행 종료',
  CANCELLED: '취소',
};
const STOP_KO: Record<string, string> = {
  PLANNED: '도착 전',
  ARRIVED: '도착',
  HANDED_OVER: '인계',
  DEPARTED: '정차 출발',
};

/** 실서버 운송 탭 — LAN 운행 목록(시뮬레이션 운행 대신). 누르면 그 TRF 흐름이 위에 뜨고, 단추로 도착·정차 출발·운행 종료(사용자 2026-11-26 "이 탭 운송탭에 나와야") */
export function LanTransport() {
  const { real } = useApp();
  const viewing = useLanRun().trfId;
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!real) return;
    let on = true;
    const load = () =>
      real.backend.client
        .call<{ items?: Trip[] }>('GET', '/cdcs/CDC01/trips', {
          query: { size: '100' },
        })
        .then((r) => {
          if (!on) return;
          setTrips(r.body.items ?? []);
          setErr(null);
        })
        .catch((e: unknown) => on && setErr(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 3000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real]);
  if (!real) return null;
  // 시험 TRF 가 든 운행 먼저, 안 끝난 것 먼저, 최근 순
  const list = [...(trips ?? [])]
    .filter((x) => x.state !== 'CANCELLED')
    .sort((a, b) => Number(a.state === 'COMPLETED') - Number(b.state === 'COMPLETED') || (b.departedAt ?? '').localeCompare(a.departedAt ?? ''));
  return (
    <div className="lan-trf lt-trips">
      <div className="note">실서버 운행 · 누르면 위에 TRF 흐름 · 3초마다 새로 읽음</div>
      {err && <div className="note">읽기 실패 — {err}</div>}
      {!trips && !err && <div className="note">읽는 중…</div>}
      {trips && !list.length && <div className="note">운행이 없습니다</div>}
      {list.map((tr) => {
        const trfs = tr.stops.flatMap((s) => s.trfIds ?? []);
        const sim = trfs.find((x) => /^TRF-(SIM|SR)-/.test(x));
        const mine = trfs.includes(viewing ?? '');
        return (
          <div key={tr.tripId} className={`lt-trip${mine ? ' on' : ''}`} onClick={() => sim && setLanRun({ trfId: sim })} role={sim ? 'button' : undefined}>
            <div className="lt-h">
              <b>{tr.tripId}</b>
              <span>{tr.vehicleId ?? ''}</span>
              <em className={tr.state === 'COMPLETED' ? 'ok' : ''}>{TRIP_STATE_KO[tr.state] ?? tr.state}</em>
            </div>
            {tr.stops.map((st) => (
              <div key={st.seq} className="lt-stop">
                <div className="lt-stop-h">
                  <span>
                    {st.seq}. {mfcName(st.mfcId)}
                  </span>
                  <b className={st.state === 'DEPARTED' ? 'ok' : ''}>{STOP_KO[st.state] ?? st.state}</b>
                </div>
                {(st.trfIds ?? []).map((x) => (
                  <TrfLine key={x} trfId={x} />
                ))}
              </div>
            ))}
            {tr.state === 'DEPARTED' &&
              tr.stops.map((st) => (
                <div key={`a${st.seq}`} onClick={(e) => e.stopPropagation()}>
                  <TripActions trip={tr} stop={st} boxes={[]} />
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

const MFC_STAGES = ['입고 예정', 'MFC 도착', '수령(재고 반영)', '품질검사', '적치(판매 가능)', '입고 끝'] as const;
/** 재고 이력 한 줄 — "수령 +4 · RCV-C-01" / "적치 C-R1-01-2-02 · 판매 가능 +4" */
function ledgerText(x: MfcLedgerItem): string {
  const into = x.entries.filter((e) => e.delta > 0).map((e) => e.locationCode);
  const where = [...new Set(into)].join(', ');
  if (x.cause === 'TIN') return `MFC 수령 ${x.sku} 재고 +${x.delta.H} · ${where}`;
  if (x.sourceRef?.startsWith('TSK-PUT')) return `MFC 적치 ${x.sku} → ${where}${x.delta.E ? ` · 판매 가능 +${x.delta.E}` : ''}`;
  if (x.sourceRef?.startsWith('TSK-INS')) return `MFC 품질검사 ${x.sku}${x.delta.Q ? ` · 격리 +${x.delta.Q}` : ' 통과'}`;
  return `MFC 재고 ${x.cause} ${x.sku}`;
}

/** MFC 작업 현황 — 단계·상품별 받은 수량·작업·지금 재고(3초마다) */
function MfcBlock({ m }: { m: MfcSide }) {
  const cur = mfcStage(m);
  const p = m.promise;
  const name = MFCS.find((x) => x.id === m.mfcId)?.name ?? m.mfcId;
  return (
    <>
      <div className="wf-flow-h">
        <span>MFC 작업 · {name}</span>
        <small>{p ? '실시간(3초)' : '입고 예정 아직 없음'}</small>
      </div>
      {p && (
        <>
          <ol className="wf-stepper">
            {MFC_STAGES.map((sname, i) => (
              <li key={sname} className={i === cur ? 'now' : i < cur ? 'done' : ''} style={{ ['--c' as string]: ['#8e9aaf', '#2d9cdb', '#27ae60', '#f2994a', '#9b51e0', '#219653'][i] }}>
                <i>{i < cur ? '✓' : i + 1}</i>
                <span className="l">{sname}</span>
                <span className="t" />
              </li>
            ))}
          </ol>
          <div className="lt-list">
            {p.lines.map((l) => {
              const puts = m.tasks.filter((t) => t.sku === l.sku && t.taskType === 'PUTAWAY');
              const stored = m.ledger.filter((x) => x.sku === l.sku && x.sourceRef?.startsWith('TSK-PUT')).flatMap((x) => x.entries.filter((e) => e.delta > 0 && e.workState === 'STORED').map((e) => e.locationCode));
              const st = m.stock[l.sku];
              return (
                <div key={l.sku} className="lt-card">
                  <div className="lt-h">
                    <b>{l.productName ?? l.sku}</b>
                    <em className={l.receivedQty >= l.expectedQty && l.expectedQty > 0 ? 'ok' : ''}>
                      받음 {l.receivedQty}/{l.expectedQty}
                      {l.quarantinedQty ? ` · 격리 ${l.quarantinedQty}` : ''}
                    </em>
                  </div>
                  <div className="lt-line">
                    <span>적치</span>
                    <span>{[...new Set(stored)].join(', ') || (puts.length ? '진행 중' : '-')}</span>
                    <b className={puts.length && puts.every((t) => t.state === 'COMPLETED') ? 'ok' : ''}>{puts.length ? `${puts.reduce((a, t) => a + t.doneQty, 0)}/${puts.reduce((a, t) => a + t.plannedQty, 0)}` : ''}</b>
                  </div>
                  {st && (
                    <div className="lt-line">
                      <span>지금 MFC 재고</span>
                      <span>{l.sku}</span>
                      <b>
                        {st.onHandQty}개 · 판매 가능 {st.sellableQty}
                      </b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
