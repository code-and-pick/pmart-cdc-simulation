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

const clock = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
const isoClock = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
const mfcName = (id: string) => MFCS.find((m) => m.id === id)?.name ?? id;
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
export function TrfBoard() {
  const { sim } = useApp();
  const view = useView();
  const [q, setQ] = useState('');
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
        <input className="search" placeholder="TRF·LPN 번호 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      {!rows.length && <div className="note">{q ? '찾는 TRF·LPN 이 없습니다.' : '08:00 에 TRF 를 받습니다.'}</div>}
      {rows.map(({ t, p, dots, handedAt }) => {
        const lp = lpnsOf(sim, t.trfId);
        const tone = dots[5] === 'done' ? 'done' : dots.includes('now') ? 'run' : 'wait';
        return (
          <div key={t.trfId} className={`sfl-r tone-${tone}`}>
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
          </div>
        );
      })}
    </div>
  );
}

/** 관리 — 탭 [지난 TRF / 진행 중 작업 / MFC 인계 확인 / R/T 회수], 날짜 필터, 번호 검색 (사용자 §6-5) */
export function AdminBoard() {
  const { sim, backend } = useApp();
  const view = useView();
  const [tab, setTab] = useState<'past' | 'tasks' | 'handover' | 'rt'>('past');
  const [q, setQ] = useState('');
  const [day, setDay] = useState('');
  const rows = useTrfRows();
  const k = q.trim().toUpperCase();
  const match = (s: string) => !k || s.toUpperCase().includes(k);
  const byMfc = (id: string) => !view.mfcFilter || id === view.mfcFilter;
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
            ['handover', 'MFC 인계 확인'],
            ['rt', 'R/T 회수'],
          ] as const
        ).map(([key, t]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input className="search" placeholder="번호 검색(TRF·작업·차)" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} title="마감(도착) 날짜로 거르기" />
      </div>
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
          </tbody>
        </table>
      )}
      {tab === 'tasks' && (
        <table className="inv">
          <thead>
            <tr>
              <th>작업</th>
              <th>TRF</th>
              <th>상태</th>
              <th>담당</th>
              <th>줄</th>
            </tr>
          </thead>
          <tbody>
            {backend
              .findTasks((t) => t.state !== 'DONE' && t.state !== 'PARTIAL' && t.state !== 'CANCELLED')
              .filter((t) => match(t.taskId) || match(sim.no('TASK', t.taskId)) || t.trfIds.some((id) => match(id) || match(sim.no('TRF', id))))
              .slice(0, 200)
              .map((t) => (
                <tr key={t.taskId}>
                  <td title={`시스템 번호 ${t.taskId}`}>{sim.no('TASK', t.taskId)}</td>
                  <td title={`시스템 번호 ${t.trfIds.join(', ')}`}>{t.trfIds.map((id) => sim.no('TRF', id)).join(' · ')}</td>
                  <td>{t.state}</td>
                  <td>{sim.agents.find((a) => a.id === t.assigneeId)?.name ?? '—'}</td>
                  <td>
                    {t.lines.filter((l) => l.pickedQty + l.shortQty >= l.plannedQty).length}/{t.lines.length}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
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
          </tbody>
        </table>
      )}
      {tab === 'rt' && (
        <>
          <div className="note">MFC 에 R/T 를 내리고 인계할 때 비워 둔 빈 R/T 를 같은 수만큼 돌려받아 싣고, 칠곡에 돌아오면 도크에 내립니다. 판매 불가·파손 상품 회수는 계약이 없어 넣지 않았습니다.</div>
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
      <input className="search" placeholder="상품 이름·SKU 검색(2글자 이상)" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
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
      {!list.length && <div className="note">고른 종류의 변동이 아직 없습니다.</div>}
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
