// 실서버(LAN) TRF 흐름 — PDA 로 하고 있는 TRF 를 TRF 번호로 오른쪽 탭 맨 위에(사용자 2026-11-26 "지금 pda 로 작업하고 있는 흐름이 TRF 번호로 오른쪽탭에 제대로 나와야").
// 서버가 확정한 것만 그린다: 인수 진행(internal transfer-intakes) · 작업(tasks?waveId) · 박스(lpns?trfId) · 사건(events). 3초마다 다시 읽음.
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import type { TransferIntake } from '../domain/contract';
import { setLanRun, useLanRun } from './lanRunStore';

const STAGES = ['인수', '할당', 'Wave 배포', '피킹', '분배·패킹', '검품', '상차', '출발'] as const;
const COLORS = ['#8e9aaf', '#56ccf2', '#2f80ed', '#27ae60', '#9b51e0', '#f2994a', '#eb5757', '#219653'];
/** 지금 하고 있는(아직 안 끝난) 단계 번호 — 다 끝났으면 STAGES.length */
function stageOf(t: TransferIntake): number {
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
const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '');
const who = (id?: string | null) => (id ? (id.startsWith('OP-') ? `작업자 ${id.slice(3, 9)}` : id) : '');

interface Task {
  taskId: string;
  taskNumber?: string;
  state: string;
  regionCode?: string | null;
  assigneeId?: string | null;
  completedAt?: string | null;
  lines: { sku: string; locationCode: string; plannedQty: number; pickedQty: number; shortQty: number }[];
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
interface Data {
  intake: TransferIntake;
  trfNumber?: string;
  waveNumber?: string;
  tasks: Task[];
  lpns: Lpn[];
  events: Ev[];
  at: number;
}

const EV_KO: Record<string, string> = {
  TRF_RECEIVED: 'TRF 인수',
  WAVE_CREATED: 'Wave 만듦',
  WAVE_RELEASED: 'Wave 배포',
  TASK_STARTED: '피킹 시작',
  TASK_COMPLETED: '피킹 끝',
};

export function LanTrfFlow() {
  const { real } = useApp();
  const { trfId } = useLanRun();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!real || !trfId) return;
    let on = true;
    setD(null);
    const load = async () => {
      try {
        const c = real.backend.client;
        const intake = await real.internal.getTransferIntake(trfId);
        const [sum, tasks, lpns, events] = await Promise.all([
          c.call<{ items?: { trfId: string; trfNumber?: string; waveNumber?: string }[] }>('GET', '/cdcs/CDC01/transfers', { query: { size: '100' } }).then((r) => (r.body.items ?? []).find((x) => x.trfId === trfId)),
          intake.waveId ? c.call<{ items?: Task[] }>('GET', '/cdcs/CDC01/tasks', { query: { waveId: intake.waveId } }).then((r) => r.body.items ?? []) : Promise.resolve([] as Task[]),
          c.call<{ items?: Lpn[] }>('GET', '/cdcs/CDC01/lpns', { query: { trfId, size: '100' } }).then((r) => r.body.items ?? []),
          c.call<{ items?: Ev[] }>('GET', '/cdcs/CDC01/events', { query: { size: '200' } }).then((r) => r.body.items ?? []),
        ]);
        const taskIds = new Set(tasks.map((t) => t.taskId));
        if (!on) return;
        setD({
          intake,
          trfNumber: sum?.trfNumber,
          waveNumber: sum?.waveNumber,
          tasks,
          lpns,
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
  const cur = t ? stageOf(t) : -1;
  const q = (k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'sortedQty' | 'inspectedQty' | 'loadedQty' | 'departedQty') => (t ? t.progress.reduce((a, p) => a + p[k], 0) : 0);
  const stageQty = ['', `${q('allocatedQty')}/${q('approvedQty')}`, d?.waveNumber ?? '', `${q('pickedQty')}/${q('allocatedQty')}`, `${q('sortedQty')}/${q('pickedQty')}`, `${q('inspectedQty')}/${q('sortedQty')}`, `${q('loadedQty')}/${q('inspectedQty')}`, `${q('departedQty')}`];
  // 시간 순 기록 — 사건 + 박스(분류·검품·상차 시각)
  const log: { at: string; what: string; who?: string }[] = [
    ...(d?.events ?? []).map((e) => {
      const task = d?.tasks.find((x) => x.taskId === e.taskId);
      return { at: e.at, what: `${EV_KO[e.type] ?? e.type}${e.refNumber ? ` ${e.refNumber}` : ''}${task?.regionCode && e.type === 'TASK_STARTED' ? ` · 지역 ${task.regionCode}` : ''}`, who: who(e.actorId) };
    }),
    ...(d?.lpns ?? []).flatMap((l) => [
      ...(l.sortedAt ? [{ at: l.sortedAt, what: `박스 닫음 ${l.lpn} · ${l.contents.map((c) => `${c.sku}×${c.qty}`).join(', ')}`, who: who(l.sortedBy) }] : []),
      ...(l.inspectedAt ? [{ at: l.inspectedAt, what: `검품 ${l.inspection === 'PASSED' ? '합격' : l.inspection === 'FAILED' ? '불합격' : l.inspection} ${l.lpn}` }] : []),
      ...(l.loadedAt ? [{ at: l.loadedAt, what: `상차 ${l.lpn}${l.dockCode ? ` · 도크 ${l.dockCode}` : ''}` }] : []),
    ]),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section className="sec wflow lan-trf">
      <div className="wf-head">
        <div>
          <b>{d?.trfNumber ?? trfId}</b>
          <small>
            {trfId} · {t?.mfcId ?? ''} · 실서버
          </small>
        </div>
        <span className={`wf-pill ${t?.state === 'DEPARTED' ? 'off' : 'busy'}`}>{t?.state ?? '읽는 중'}</span>
        <button className="wf-btn x" onClick={() => setLanRun({ trfId: undefined })} aria-label="닫기">
          ×
        </button>
      </div>
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
    </section>
  );
}
