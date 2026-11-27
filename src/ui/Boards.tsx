// 오른쪽 메뉴 판들 — MFC 시뮬레이터 메뉴(실제 주문·관리·재고·재고 변동·바코드)를 DC 데이터에 맞춤 [사용자 2026-11-25 지시문 §6-4~8].
// 값은 MOCK 계약 응답(이관·작업·원장 커밋)과 시뮬레이션 줄에서만. 실서버 모드는 같은 계약 응답을 쓰게 될 자리.
import { useMemo, useState } from 'react';
import { useApp, useView } from '../app/context';
import { MFCS } from '../config';
import type { Location } from '../domain/layout';
import { TEMP_KO } from '../sim/simulation';
import { trfTemp } from '../sim/supply';
import { Barcode } from './Barcode';
import { scanView, useScanView } from './scanView';
import { LanHandoverTable, LanPastTable, LanRtTable, LanTasksTable } from './lanAdmin';

const clock = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
const isoClock = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
const mfcName = (id: string) => MFCS.find((m) => m.id === id)?.name ?? id;

/**
 * 예시 줄 — 목업에서 아직 그 시각이 안 와 목록이 비면(지난 TRF·MFC 인계·R/T 회수·진행 중 작업) 화면이 어떻게 채워지는지 보이게(사용자 2026-11-26
 * "목업에서 오른쪽탭 정보 어떻게 뜨는지 확인하게 다 만들어서 넣어"). 값은 실규모 하루 결과(2026-11-26 day-report)와 같은 크기의 본보기 — 실제 기록 아님.
 * 실제 값이 하나라도 생기면 예시는 사라진다.
 */
const EX = {
  past: MFCS.map((m, i) => ({ trf: `T${String(260001 + i).padStart(6, '0')}`, mfc: m.id, state: 'DEPARTED', dep: [32_400, 41_800, 28_600, 30_100, 25_900, 2_000, 2_000, 2_000, 2_000][i] ?? 2_000, hand: 5.5 * 3600 + i * 900 })),
  tasks: [
    { task: 'K000412', trf: 'T260001 · T260005', state: 'IN_PROGRESS', who: 'FC 피커 6F-03', lines: '12/20' },
    { task: 'K000413', trf: 'T260002', state: 'IN_PROGRESS', who: 'DPS 구역 5F-07', lines: '3/8' },
    { task: 'K000418', trf: 'T260003 · T260004', state: 'ASSIGNED', who: 'FC 피커 7F-11', lines: '0/20' },
    { task: 'K000421', trf: 'T260001', state: 'CREATED', who: '—', lines: '0/14' },
  ],
  handover: MFCS.slice(0, 5).map((m, i) => ({ car: `칠곡-5T-0${i + 1}A`, mfc: m.id, at: 5.5 * 3600 + i * 1200, sent: [32_400, 41_800, 28_600, 30_100, 25_900][i], recv: [32_400, 41_800, 28_598, 30_100, 25_900][i] })),
  rt: MFCS.map((m, i) => ({ mfc: m.id, out: [62, 80, 55, 58, 50, 4, 4, 4, 4][i] ?? 4, back: [62, 80, 55, 58, 50, 4, 4, 4, 4][i] ?? 4, home: [62, 80, 55, 58, 50, 4, 4, 4, 4][i] ?? 4 })),
};
/** 작업 상태 한글 */
const TASK_KO: Record<string, string> = { CREATED: '대기', ASSIGNED: '배정됨', ACCEPTED: '받음', IN_PROGRESS: '진행 중', PARTIAL: '부분 완료', DONE: '완료', EXCEPTION: '예외', CANCELLED: '취소' };

function ExampleNote({ when }: { when: string }) {
  return <div className="note ex-note">예시 · {when}부터 실제 값</div>;
}
type Dot = 'done' | 'now' | 'wait';

/** TRF 한 건의 단계 점(피킹 → 분류 → 검품 → 상차 → 출발 → 인계) */
function useTrfRows() {
  const { sim } = useApp();
  const handed = new Map<string, number>();
  for (const r of sim.runs.values()) for (const st of r.stops) if (st.handedAt !== undefined) for (const id of st.trfIds) handed.set(id, st.handedAt);
  return sim.uiTransfers().map((t) => {
    const p = t.progress.reduce((a, x) => ({ ap: a.ap + x.approvedQty, pk: a.pk + x.pickedQty, so: a.so + x.sortedQty, ins: a.ins + x.inspectedQty, ld: a.ld + x.loadedQty, dp: a.dp + x.departedQty }), { ap: 0, pk: 0, so: 0, ins: 0, ld: 0, dp: 0 });
    const base = p.pk || p.ap;
    const dot = (v: number, b: number): Dot => (b > 0 && v >= b ? 'done' : v > 0 ? 'now' : 'wait');
    const dots: Dot[] = [dot(p.pk, p.ap), dot(p.so, base), dot(p.ins, base), dot(p.ld, base), dot(p.dp, base), handed.has(t.trfId) ? 'done' : 'wait'];
    return { t, p, dots, handedAt: handed.get(t.trfId) };
  });
}

/** 그 TRF 의 LPN(출고대기·도크 앞·차) */
function lpnsOf(sim: ReturnType<typeof useApp>['sim'], trfId: string): string[] {
  const out = [...sim.staged.values()].flat().filter((b) => b.trfId === trfId).map((b) => b.lpn);
  for (const r of sim.atDock) if (r.trfId === trfId) out.push(...r.boxes.map((b) => b.lpn));
  for (const r of sim.runs.values()) out.push(...r.loaded.filter((b) => b.trfId === trfId).map((b) => b.lpn));
  return out;
}

const STEPS = ['피킹', '분류', '검품', '상차', '출발', '인계'];

/**
 * MFC 고르기 — 상단바 대신 패널 안에서(사용자 2026-11-25 "DC 인데 상단에 MFC 바가 왜 크게 있어 — 재고·운송은 그 안에서 센터 선택").
 * 고른 MFC 는 TRF·관리·재고·운송·바코드가 같이 쓰고, 3D 출고대기 자리도 강조한다.
 */
export function MfcPick() {
  const view = useView();
  return (
    <label className="mfc-pick">
      MFC
      <select value={view.mfcFilter ?? ''} onChange={(e) => view.setMfcFilter(e.target.value || null)}>
        <option value="">전체</option>
        {MFCS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** TRF 카드 — MFC "실제 주문" 대신(사용자 §6-4): 단계 점, TRF·LPN 번호 검색, MFC 필터 */
/**
 * TRF 자세히(카드를 누르면 펼침) — 사용자 2026-11-26 "클릭해도 아무 데도 안 들어가지고 정보도 안 떠".
 * 마감·할당·단계별 수량(승인 대비), 품목(많은 순 6), 박스(LPN), 실을 차·도크·출발, 3D 출고대기·운송 탭으로 가기.
 */
function TrfDetail({ t, p, lpns, handedAt }: { t: ReturnType<typeof useTrfRows>[number]['t']; p: ReturnType<typeof useTrfRows>[number]['p']; lpns: string[]; handedAt?: number }) {
  const { sim, catalog, layout } = useApp();
  const view = useView();
  const run = [...sim.runs.values()].find((r) => r.stops.some((s) => s.trfIds.includes(t.trfId)));
  const stop = run?.stops.find((s) => s.trfIds.includes(t.trfId));
  const due = new Date(t.dueAt);
  const dueText = Number.isNaN(due.getTime()) ? t.dueAt : `${due.getMonth() + 1}/${due.getDate()} ${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
  const al = t.progress.reduce((a, x) => a + x.allocatedQty, 0);
  const pct = (v: number) => (p.ap ? `${Math.round((100 * v) / p.ap)}%` : '—');
  const stages: [string, number][] = [
    ['할당', al],
    ['피킹', p.pk],
    ['분류', p.so],
    ['검품', p.ins],
    ['상차', p.ld],
    ['출발', p.dp],
  ];
  const lines = [...t.progress].sort((a, b) => b.approvedQty - a.approvedQty).slice(0, 6);
  // 출고대기 칸(그 MFC · 그 온도대 층)
  const m = MFCS.find((x) => x.id === t.mfcId);
  const temp = trfTemp(t);
  const st = m ? layout.floors.flatMap((f) => f.staging).find((s) => s.temp === temp && s.bay === m.staging) : undefined;
  return (
    <div className="trf-detail" onClick={(e) => e.stopPropagation()}>
      <div className="trf-kv">
        <span>마감({t.deadlineMeaning === 'ARRIVAL' ? '도착' : t.deadlineMeaning === 'HANDOVER' ? '인계' : '준비'})</span>
        <b>{dueText}</b>
        <span>줄</span>
        <b>{t.progress.length.toLocaleString()}품목</b>
        <span>차</span>
        <b>{run ? `${run.plateNo} · ${run.driverName}` : '22:00 배차 때'}</b>
        <span>도크·출발</span>
        <b>{run ? `${run.dock.short} · ${run.departedAt !== undefined ? clock(run.departedAt) : `계획 ${clock(run.plan.plannedDepartMin * 60)}`}` : '—'}</b>
        <span>도착·인계</span>
        <b>{stop?.arrivedAt !== undefined ? `${clock(stop.arrivedAt)}${handedAt ? ` · ${clock(handedAt)}` : ''}` : '—'}</b>
      </div>
      <div className="trf-bars">
        {stages.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <i>
              <em style={{ width: p.ap ? `${Math.min(100, (100 * v) / p.ap)}%` : 0 }} />
            </i>
            <b>
              {v.toLocaleString()} <small>{pct(v)}</small>
            </b>
          </div>
        ))}
      </div>
      <div className="trf-lines">
        <small>품목(많은 순)</small>
        {lines.map((l) => (
          <div key={l.sku}>
            <span>{catalog.bySku.get(l.sku)?.name ?? l.sku}</span>
            <b>
              {l.pickedQty}/{l.approvedQty}
            </b>
          </div>
        ))}
      </div>
      {lpns.length > 0 && (
        <div className="trf-lpns">
          <small>박스(LPN) {lpns.length}</small> {lpns.slice(0, 8).join(' · ')}
          {lpns.length > 8 ? ' …' : ''}
        </div>
      )}
      <div className="trf-acts">
        {st && (
          <button
            onClick={() => {
              view.setFloor(st.floor);
              view.focusLocation(st);
            }}
          >
            3D 출고대기 보기
          </button>
        )}
        {run && <button onClick={() => view.toggleRight('transport')}>운송 탭에서 차 보기</button>}
      </div>
    </div>
  );
}

export function TrfBoard() {
  const { sim } = useApp();
  const view = useView();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useTrfRows()
    .filter((r) => !view.mfcFilter || r.t.mfcId === view.mfcFilter)
    .filter((r) => {
      if (!q.trim()) return true;
      const k = q.trim().toUpperCase();
      return r.t.trfId.toUpperCase().includes(k) || sim.no('TRF', r.t.trfId).toUpperCase().includes(k) || lpnsOf(sim, r.t.trfId).some((l) => l.toUpperCase().includes(k));
    });
  return (
    <div className="sfl">
      <div className="pick-row">
        <MfcPick />
        <input className="search" placeholder="TRF·LPN 번호" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      {!rows.length && <div className="note">{q ? '찾는 TRF·LPN 이 없습니다.' : '08:00 에 TRF 도착'}</div>}
      {rows.map(({ t, p, dots, handedAt }) => {
        const lp = lpnsOf(sim, t.trfId);
        const tone = dots[5] === 'done' ? 'done' : dots.includes('now') ? 'run' : 'wait';
        return (
          <div key={t.trfId} className={`sfl-r tone-${tone}${open === t.trfId ? ' open' : ''}`} onClick={() => setOpen(open === t.trfId ? null : t.trfId)} title="눌러서 자세히">
            <div className="sfl-h">
              <b>
                {mfcName(t.mfcId)} {TEMP_KO[trfTemp(t)]}
              </b>
              <span className="st" title={`시스템 번호 ${t.trfId}`}>{sim.no('TRF', t.trfId)}</span>
            </div>
            <ol className="sfl-steps">
              {STEPS.map((s, i) => (
                <li key={s} className={dots[i]}>
                  <i />
                  <span className="n">{s}</span>
                  <span className="u">{i === 5 ? (handedAt ? clock(handedAt) : '') : [p.pk, p.so, p.ins, p.ld, p.dp][i] || ''}</span>
                </li>
              ))}
            </ol>
            <div className="sfl-w">
              승인 {p.ap.toLocaleString()} · 상태 {t.state} · 박스(LPN) {lp.length}
              {q && lp.filter((l) => l.toUpperCase().includes(q.trim().toUpperCase())).slice(0, 3).map((l) => ` · ${l}`)}
            </div>
            {open === t.trfId && <TrfDetail t={t} p={p} lpns={lp} handedAt={handedAt} />}
          </div>
        );
      })}
    </div>
  );
}

/** 관리 — 탭 [지난 TRF / 진행 중 작업 / MFC 인계 확인 / R/T 회수], 날짜 필터, 번호 검색 (사용자 §6-5) */
export function AdminBoard() {
  const { sim, backend, real } = useApp();
  const view = useView();
  const [tab, setTab] = useState<'past' | 'tasks' | 'handover' | 'rt'>('past');
  const [q, setQ] = useState('');
  const [day, setDay] = useState('');
  const rows = useTrfRows();
  const k = q.trim().toUpperCase();
  const match = (s: string) => !k || s.toUpperCase().includes(k);
  const byMfc = (id: string) => !view.mfcFilter || id === view.mfcFilter;
  // 실제 값이 있는지(없으면 예시 줄)
  const hasPast = rows.some((r) => r.t.state === 'DEPARTED' || r.t.state === 'CANCELLED');
  const hasTasks = backend.anyTask((t) => t.state !== 'DONE' && t.state !== 'PARTIAL' && t.state !== 'CANCELLED');
  const hasHand = [...sim.runs.values()].some((r) => r.stops.some((x) => x.arrivedAt !== undefined));
  const hasRt = [...sim.runs.values()].some((r) => r.stops.some((x) => (x.rtOut ?? 0) > 0));
  return (
    <div>
      <div className="pick-row">
        <MfcPick />
      </div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {(
          [
            ['past', '지난 TRF'],
            ['tasks', '진행 중 작업'],
            ['handover', 'MFC 인계'],
            ['rt', 'R/T 회수'],
          ] as const
        ).map(([key, t]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {t}
          </button>
        ))}
      </div>
      {/* 찾기 줄 — 검색 칸과 날짜를 같은 높이·같은 모양으로(사용자 2026-11-26 "이 UI 고쳐") */}
      <div className="ad-tools">
        <label className="ad-search">
          <span aria-hidden>⌕</span>
          <input placeholder="번호 찾기 — TRF·작업·차" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button onClick={() => setQ('')} aria-label="지우기">
              ×
            </button>
          )}
        </label>
        <label className="ad-date" title="마감(도착) 날짜로 거르기">
          <span>마감일</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          {day && (
            <button onClick={() => setDay('')} aria-label="날짜 지우기">
              ×
            </button>
          )}
        </label>
      </div>
      {tab === 'past' && real && <LanPastTable q={q} mfcFilter={view.mfcFilter} day={day} />}
      {tab === 'past' && real && <div className="lt-sec-h">가상 현장</div>}
      {tab === 'past' && (
        <table className="inv">
          <thead>
            <tr>
              <th>TRF</th>
              <th>MFC</th>
              <th>상태</th>
              <th>출발</th>
              <th>인계</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.t.state === 'DEPARTED' || r.t.state === 'CANCELLED')
              .filter((r) => byMfc(r.t.mfcId) && (match(r.t.trfId) || match(sim.no('TRF', r.t.trfId))) && (!day || (r.t.dueAt ?? '').startsWith(day)))
              .map((r) => (
                <tr key={r.t.trfId}>
                  <td title={`시스템 번호 ${r.t.trfId}`}>{sim.no('TRF', r.t.trfId)}</td>
                  <td>{mfcName(r.t.mfcId).replace(/^\d호점 /, '')}</td>
                  <td>{r.t.state}</td>
                  <td>{r.p.dp.toLocaleString()}</td>
                  <td>{r.handedAt ? clock(r.handedAt) : '—'}</td>
                </tr>
              ))}
            {!hasPast &&
              EX.past
                .filter((x) => byMfc(x.mfc))
                .map((x) => (
                  <tr key={x.trf} className="ex">
                    <td>{x.trf}</td>
                    <td>{mfcName(x.mfc).replace(/^\d호점 /, '')}</td>
                    <td>{x.state}</td>
                    <td>{x.dep.toLocaleString()}</td>
                    <td>{clock(x.hand)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      )}
      {tab === 'past' && !hasPast && <ExampleNote when="첫 차가 출발하는 새벽(01:00~)" />}
      {tab === 'tasks' && real && <LanTasksTable q={q} />}
      {tab === 'tasks' && real && <div className="lt-sec-h">가상 현장</div>}
      {tab === 'tasks' && (
        // 카드 — 작업 번호·상태(한글)·담당·TRF·줄 진행 막대(사용자 2026-11-26 "못 알아보겠다" — 표가 좁아 줄이 꺾이고 상태가 영어였음)
        <div className="tk-list">
          {(hasTasks
            ? backend
                .findTasks((t) => t.state !== 'DONE' && t.state !== 'PARTIAL' && t.state !== 'CANCELLED')
                .filter((t) => match(t.taskId) || match(sim.no('TASK', t.taskId)) || t.trfIds.some((id) => match(id) || match(sim.no('TRF', id))))
                .slice(0, 200)
                .map((t) => ({
                  key: t.taskId,
                  no: sim.no('TASK', t.taskId),
                  state: t.state as string,
                  who: sim.agents.find((a) => a.id === t.assigneeId)?.name ?? '',
                  trfs: t.trfIds.map((id) => sim.no('TRF', id)),
                  done: t.lines.filter((l) => l.pickedQty + l.shortQty >= l.plannedQty).length,
                  total: t.lines.length,
                  ex: false,
                }))
            : EX.tasks.map((x) => ({ key: x.task, no: x.task, state: x.state, who: x.who === '—' ? '' : x.who, trfs: x.trf.split(' · '), done: Number(x.lines.split('/')[0]), total: Number(x.lines.split('/')[1]), ex: true }))
          ).map((x) => (
            <div key={x.key} className={`tk${x.ex ? ' ex' : ''}`}>
              <div className="tk-h">
                <b>{x.no}</b>
                <span className={`tk-st ${x.state.toLowerCase()}`}>{TASK_KO[x.state] ?? x.state}</span>
                {x.ex && <span className="tk-ex">예시</span>}
              </div>
              <div className="tk-m">
                <span>{x.who || '담당 없음'}</span>
                <span>TRF {x.trfs.join(', ')}</span>
              </div>
              <div className="tk-bar">
                <i>
                  <em style={{ width: x.total ? `${(100 * x.done) / x.total}%` : 0 }} />
                </i>
                <small>
                  {x.done}/{x.total}줄
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'tasks' && !hasTasks && <ExampleNote when="석간 Wave 배포(13:00) 뒤" />}
      {/* 실서버 모드 — LAN 운행·인계·MFC 수령(사용자 2026-11-27 "실시간 반영이 안 되나") */}
      {tab === 'handover' && real && <LanHandoverTable q={q} mfcFilter={view.mfcFilter} />}
      {tab === 'handover' && real && <div className="lt-sec-h">가상 현장</div>}
      {tab === 'handover' && (
        <table className="inv">
          <thead>
            <tr>
              <th>차</th>
              <th>MFC</th>
              <th>도착·인계</th>
              <th>출발 수량</th>
              <th>수령</th>
            </tr>
          </thead>
          <tbody>
            {[...sim.runs.values()].flatMap((r) =>
              r.stops
                .filter((st) => byMfc(st.mfcId) && (match(r.plateNo) || match(r.plan.tripId)))
                .map((st) => {
                  const sent = r.loaded.filter((b) => b.mfcId === st.mfcId).reduce((s, b) => s + b.units, 0);
                  return (
                    <tr key={`${r.plan.tripId}${st.mfcId}`}>
                      <td>{r.plateNo}</td>
                      <td>{mfcName(st.mfcId).replace(/^\d호점 /, '')}</td>
                      <td>{st.arrivedAt !== undefined ? `${clock(st.arrivedAt)}${st.handedAt !== undefined ? ` · ${clock(st.handedAt)}` : ''}` : '—'}</td>
                      <td>{sent.toLocaleString()}</td>
                      <td className={st.received !== undefined && st.received !== sent ? 's-bad' : ''}>{st.received?.toLocaleString() ?? '—'}</td>
                    </tr>
                  );
                }),
            )}
            {!hasHand &&
              EX.handover
                .filter((x) => byMfc(x.mfc))
                .map((x) => (
                  <tr key={x.car} className="ex">
                    <td>{x.car}</td>
                    <td>{mfcName(x.mfc).replace(/^\d호점 /, '')}</td>
                    <td>
                      {clock(x.at)} · {clock(x.at + 900)}
                    </td>
                    <td>{x.sent.toLocaleString()}</td>
                    <td className={x.recv !== x.sent ? 's-bad' : ''}>{x.recv.toLocaleString()}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      )}
      {tab === 'handover' && !hasHand && <ExampleNote when="차가 MFC 에 도착하는 새벽(05:00~)" />}
      {tab === 'rt' && real && <LanRtTable mfcFilter={view.mfcFilter} />}
      {tab === 'rt' && real && <div className="lt-sec-h">가상 현장</div>}
      {tab === 'rt' && (
        <>
          <div className="ad-hint">인계 때 빈 R/T 같은 수만큼 회수 → 칠곡 도크</div>
          <table className="inv">
            <thead>
              <tr>
                <th>MFC</th>
                <th>나간 R/T</th>
                <th>회수(차에 실음)</th>
                <th>칠곡 도착</th>
                <th>남음</th>
              </tr>
            </thead>
            <tbody>
              {MFCS.filter((m) => byMfc(m.id)).map((m) => {
                const stops = [...sim.runs.values()].flatMap((r) => r.stops.filter((x) => x.mfcId === m.id).map((x) => ({ r, x })));
                const out = stops.reduce((a, { x }) => a + (x.rtOut ?? 0), 0);
                const back = stops.reduce((a, { x }) => a + (x.rtBack ?? 0), 0);
                const home = stops.reduce((a, { r, x }) => a + (r.state === 'RETURNED' ? (x.rtBack ?? 0) : 0), 0);
                const ex = !hasRt ? EX.rt.find((x) => x.mfc === m.id) : undefined;
                if (ex)
                  return (
                    <tr key={m.id} className="ex">
                      <td>{m.name}</td>
                      <td>{ex.out}</td>
                      <td>{ex.back}</td>
                      <td>{ex.home}</td>
                      <td>{ex.out - ex.home}</td>
                    </tr>
                  );
                return (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{out}</td>
                    <td>{back}</td>
                    <td>{home}</td>
                    <td>{out - home}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!hasRt && <ExampleNote when="차가 칠곡으로 돌아오는 아침" />}
        </>
      )}
    </div>
  );
}

/** 재고 — 상품 검색(이름·SKU) → 위치 목록(팔레트 보관·피킹 칸·오토스토어 칸, 위치별 수량) → "3D 에서 그 칸으로" (사용자 §6-6) */
export function StockSearch() {
  const { catalog, backend, layout } = useApp();
  const view = useView();
  const [q, setQ] = useState('');
  const locByCode = useMemo(() => new Map(layout.floors.flatMap((f) => [...f.locations, ...f.shelves]).map((l) => [l.code, l] as [string, Location])), [layout]);
  const k = q.trim();
  const hits = k.length >= 2 ? catalog.skus.filter((s) => s.sku.includes(k.toUpperCase()) || s.name.includes(k)).slice(0, 12) : [];
  const go = (l: Location) => {
    view.setFloor(l.floor);
    view.focusLocation(l);
  };
  const kind = (l: Location) => (l.bin ? '오토스토어 칸' : l.lane ? '야채 레인' : l.type === 'PICK_FACE' ? (l.aisle < 61 ? '랙 1단 피킹면' : '피킹 선반') : '팔레트 보관');
  return (
    <div>
      <input className="search" placeholder="상품 이름·SKU (2글자 이상)" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      {hits.map((s) => {
        const locs = [s.shelf, ...s.alt, ...s.column];
        return (
          <section key={s.sku} className="sec">
            <h4>
              {s.name} <span>{s.sku}</span>
            </h4>
            {locs.map((l) => {
              const cells = backend.ledger.cellsAt(l.code).filter((c) => c.sku === s.sku);
              const on = cells.reduce((a, c) => a + c.onHand, 0);
              const res = cells.reduce((a, c) => a + c.reserved, 0);
              const loc = locByCode.get(l.code) ?? l;
              return (
                <div key={l.code} className="srow kv">
                  <span className="srow-l">
                    {kind(loc)} · {loc.short}
                  </span>
                  <b className="srow-v">
                    {on.toLocaleString()}
                    {res ? ` (예약 ${res})` : ''}{' '}
                    <button onClick={() => go(loc)} title="3D 에서 그 칸으로">
                      3D에서 그 칸으로
                    </button>
                  </b>
                </div>
              );
            })}
          </section>
        );
      })}
      {k.length >= 2 && !hits.length && <div className="note">찾는 상품이 없습니다.</div>}
    </div>
  );
}

const KIND_KO: Record<string, string> = { INITIAL_BALANCE: '시작 재고', ALLOCATION: '할당', RELEASE: '예약 해제', MOVE: '이동', TOUT: '출발', RECEIPT_ACK: 'MFC 수령' };
/** 무엇이 바뀌나 — 한 줄 설명 */
const KIND_HINT: Record<string, string> = {
  ALLOCATION: '예약만 — 현물 그대로',
  RELEASE: '예약 풀림',
  MOVE: '칸만 바뀜 — 총현물 그대로',
  TOUT: 'CDC −q · Transit +q',
  RECEIPT_ACK: 'Transit −r',
  INITIAL_BALANCE: '시드',
};
const REASON_KO: Record<string, string> = { TRANSFER_CHANGED: 'TRF 바뀜', RESIDUAL_CLOSED: '출발 뒤 남은 예약', PICK_SHORTAGE: '피킹 부족', PRE_DEPARTURE_CANCEL: '미출발 취소' };
const KIND_ORDER = ['ALLOCATION', 'MOVE', 'RELEASE', 'TOUT', 'RECEIPT_ACK', 'INITIAL_BALANCE'] as const;

/**
 * 재고 변동 — 원장 커밋(할당·보충/피킹 이동·예약 해제·출발·MFC 수령). 사용자 2026-11-26 "변동탭이 보기 어려움":
 * 위 종류 칩 = 건수 + 고르기, 줄마다 두 줄(무엇 · 수량 / 어디서 → 어디로), 시스템 ID 대신 화면 번호·MFC 이름·칸 짧은 이름.
 */
export function MovesBoard() {
  const { backend, sim, layout } = useApp();
  const [kinds, setKinds] = useState<Set<string>>(new Set(['ALLOCATION', 'RELEASE', 'TOUT', 'RECEIPT_ACK']));
  const [picks, setPicks] = useState(false);
  const locShort = useMemo(() => new Map(layout.floors.flatMap((f) => [...f.locations, ...f.shelves, ...f.staging, ...f.docks]).map((l) => [l.code, l.short] as [string, string])), [layout]);
  const trfMfc = new Map(sim.uiTransfers().map((t) => [t.trfId, t.mfcId] as [string, string]));
  const all = backend.ledger.commitList();
  const count = new Map<string, number>();
  for (const c of all) count.set(c.postingKind, (count.get(c.postingKind) ?? 0) + 1);
  const isPick = (c: (typeof all)[number]) => c.postingKind === 'MOVE' && !(c.sourceRef ?? '').startsWith('REPL:');
  const list = all
    .filter((c) => kinds.has(c.postingKind) && (picks || !isPick(c)))
    .slice(-200)
    .reverse();
  const toggle = (k: string) => {
    const n = new Set(kinds);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setKinds(n);
  };
  const short = (code: string) => locShort.get(code) ?? code.split('-').slice(1).join('-');
  const who = (c: (typeof all)[number]): string => {
    const ref = c.sourceRef ?? '';
    if (c.postingKind === 'ALLOCATION' || c.postingKind === 'RELEASE') {
      const [trf, reason] = ref.split(':');
      return `${sim.no('TRF', trf)} · ${mfcName(trfMfc.get(trf) ?? '').replace(/^\d호점 /, '')}${reason ? ` · ${REASON_KO[reason] ?? reason}` : ''}`;
    }
    if (c.postingKind === 'MOVE') return ref.startsWith('REPL:') ? `선반 보충 · ${sim.agents.find((a) => a.id === ref.slice(5))?.name ?? ref.slice(5)}` : `피킹 · 작업 ${sim.no('TASK', ref)}`;
    if (c.postingKind === 'TOUT') return '노선 출발';
    if (c.postingKind === 'RECEIPT_ACK') return 'MFC 수령 확인';
    return '시작 재고';
  };
  return (
    <div>
      <div className="mv-kinds">
        {KIND_ORDER.map((k) => (
          <button key={k} className={`mv-k k-${k} ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggle(k)} title={KIND_HINT[k]}>
            <b>{(count.get(k) ?? 0).toLocaleString()}</b>
            <span>{KIND_KO[k]}</span>
          </button>
        ))}
      </div>
      {kinds.has('MOVE') && (
        <label className="mv-opt">
          <input type="checkbox" checked={picks} onChange={(e) => setPicks(e.target.checked)} /> 피킹 이동도 보기(많음 — 기본은 선반 보충만)
        </label>
      )}
      {!list.length && <div className="note">변동 없음</div>}
      <ul className="mv-list">
        {list.map((c) => {
          const qty = c.deltas.filter((d) => d.delta > 0 && (d.bucket === 'ON_HAND' || d.bucket === 'RESERVED' || d.bucket === 'TRANSIT')).reduce((a, d) => a + d.delta, 0)
            || c.deltas.filter((d) => d.delta < 0).reduce((a, d) => a - d.delta, 0);
          const from = [...new Set(c.deltas.filter((d) => d.delta < 0 && d.locationCode).map((d) => d.locationCode!))];
          const to = [...new Set(c.deltas.filter((d) => d.delta > 0 && d.locationCode).map((d) => d.locationCode!))];
          const skus = new Set(c.deltas.map((d) => d.sku)).size;
          const many = (xs: string[]) => (xs.length === 0 ? '' : xs.length === 1 ? short(xs[0]) : `${short(xs[0])} 외 ${xs.length - 1}칸`);
          const place = c.postingKind === 'MOVE' ? `${many(from)} → ${many(to)}` : many(to.length ? to : from);
          return (
            <li key={c.commitId} className={`mv-r k-${c.postingKind}`} title={c.deltas.map((d) => `${d.sku} ${d.lot} ${d.locationCode ?? ''} ${d.bucket} ${d.delta > 0 ? '+' : ''}${d.delta}`).join('\n')}>
              <div className="mv-h">
                <span className="mv-t">{isoClock(c.appliedAt)}</span>
                <span className="mv-badge">{KIND_KO[c.postingKind] ?? c.postingKind}</span>
                <span className="mv-w">{who(c)}</span>
                <b className="mv-q">{qty.toLocaleString()}개</b>
              </div>
              <div className="mv-s">
                {place && <span>{place}</span>}
                <span>SKU {skus}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 바코드 — QR/바코드 전환, 위치 코드·카트·R/T·LPN·도크, 인쇄용 묶음 (사용자 §6-8, MFC Barcode 그대로) */
export function BarcodeBoard() {
  const { sim, layout } = useApp();
  const view = useView();
  const sv = useScanView();
  const [print, setPrint] = useState(false);
  const f = view.floorLayout();
  const loc = view.selected;
  const carts = sim.agents.filter((a) => a.role === 'FC' && (!f || a.floor === f.floor)).slice(0, 6);
  const staged = [...sim.staged.values()].flat().filter((b) => !view.mfcFilter || b.mfcId === view.mfcFilter);
  const groups: [string, { value: string; caption: string; go?: () => void }[]][] = [
    ['위치 코드', loc ? [{ value: loc.code, caption: `고른 칸 ${loc.short}` }] : (f?.staging ?? []).slice(0, 5).map((s) => ({ value: s.code, caption: `출고대기 ${s.short}`, go: () => view.focusLocation(s) }))],
    ['카트', carts.map((a) => ({ value: `CART-${a.id.toUpperCase()}`, caption: a.name }))],
    ['R/T', MFCS.filter((m) => !view.mfcFilter || m.id === view.mfcFilter).map((m) => ({ value: `RT-${m.id}-${String(m.staging).padStart(2, '0')}`, caption: `${m.name} R/T` }))],
    ['LPN', staged.slice(-6).map((b) => ({ value: b.lpn, caption: `${mfcName(b.mfcId).replace(/^\d호점 /, '')} 박스 ${b.units}개` }))],
    ['도크', layout.docks.slice(0, 6).map((d) => ({ value: d.code, caption: `도크 ${d.short}` }))],
  ];
  return (
    <div className={print ? 'print-sheet' : ''}>
      <div className="pick-row">
        <MfcPick />
      </div>
      <div className="seg" style={{ marginBottom: 8 }}>
        <button className={sv.mode === 'qr' ? 'on' : ''} onClick={() => scanView.setMode('qr')}>
          QR
        </button>
        <button className={sv.mode === 'bar' ? 'on' : ''} onClick={() => scanView.setMode('bar')}>
          바코드
        </button>
        <button
          onClick={() => {
            setPrint(true);
            setTimeout(() => {
              window.print();
              setPrint(false);
            }, 50);
          }}
          title="지금 보이는 코드를 한 장에 모아 인쇄"
        >
          인쇄용 묶음
        </button>
      </div>
      {groups.map(([title, items]) => (
        <section key={title} className="sec">
          <h4>
            {title} <span>{items.length}</span>
          </h4>
          {items.length ? items.map((it) => <Barcode key={it.value} value={it.value} caption={it.caption} onGo={it.go} />) : <div className="note">지금 없음</div>}
        </section>
      ))}
    </div>
  );
}
