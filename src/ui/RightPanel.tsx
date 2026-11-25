// 오른쪽 패널 — MFC 시뮬레이터 RightPanel 구조 그대로(사용자 2026-11-25 "탭 UI 가 MFC 랑 완전 다른데 정보도 별로"):
// 맨 위 요약(하루 흐름 한 줄 + 핵심 숫자 4 + "숫자 모두" 접기) → 아래 탭 내용(현장 흐름판 · 운송 · API · 이벤트 · 재고).
// 값은 MOCK 계약 응답(이관 진행·원장)과 시뮬레이션 줄에서만.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { fmt } from '../backend/mock/MockTms';
import { MFCS, OUTBOUND, TMS } from '../config';
import type { RightView } from '../render/controller';
import { TEMP_KO } from '../sim/simulation';
import { trfTemp } from '../sim/supply';
import { AdminBoard, BarcodeBoard, MfcPick, MovesBoard, StockSearch, TrfBoard } from './Boards';
import { DayTimeline, Meter, Tile } from './viz';

const clock = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
/** 큰 수는 만 단위로 짧게 */
const short = (n: number) => (n >= 10_000 ? `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}만` : n.toLocaleString());

/** 맨 위 요약 — 하루 흐름(승인 → 피킹 → 분류 → 검품 → 출발 → 수령) + 핵심 숫자 4개, 나머지는 "숫자 모두" */
function Summary() {
  const { sim, backend, layout, catalog } = useApp();
  const d = sim.live('summary', 700, () => sim.summary());
  const q = sim.queues();
  const t = backend.ledger.totals();
  const flow: [string, number, boolean?][] = [
    ['승인', d.approved],
    ['피킹', d.picked, d.released && d.picked < d.approved && sim.time / 60 > OUTBOUND.lowerFrom - 60],
    ['분류', d.sorted, q.line + q.split > 6],
    ['검품', d.inspected, q.stagedWait > 40],
    ['출발', d.departed],
    ['수령', d.received],
  ];
  const key: [string, string][] = [
    ['지금', sim.phase()],
    ['작업 중 / 전체', `${d.busy}/${sim.agents.length}`],
    ['최근 1시간 피킹', `${sim.pickedLastHour().toLocaleString()}개`],
    ['결품 보고', `${sim.shortUnits.toLocaleString()}개`],
  ];
  const all: [string, string][] = [
    ['피킹 작업', `${d.tasksDone}/${d.tasks}`],
    ...(() => {
      const by = new Map<string, number>();
      for (const p of sim.pickLog) by.set(p.handling ?? 'FC', (by.get(p.handling ?? 'FC') ?? 0) + p.qty);
      const all = [...by.values()].reduce((a, b) => a + b, 0) || 1;
      const pct = (k: string[]) => `${Math.round((100 * k.reduce((a, x) => a + (by.get(x) ?? 0), 0)) / all)}%`;
      return [
        ['오토스토어 처리 비율', pct(['PORT'])],
        ['FC 처리 비율', pct(['FC', 'BOX', 'LINE'])],
      ] as [string, string][];
    })(),
    ['보충 남은 칸', d.replNeeds.toLocaleString()],
    ['상차(LOADED)', d.loaded.toLocaleString()],
    ['운행', `${d.tripsDone}/${d.trips} 복귀`],
    ['CDC 현물', t.onHand.toLocaleString()],
    ['예약', t.reserved.toLocaleString()],
    ['Transit(미정산)', t.transit.toLocaleString()],
    ['원장 불변식 위반', `${sim.live('check', 2000, () => backend.ledger.check()).length}건`],
    ['팔레트 칸(보관)', layout.floors.reduce((s, f) => s + f.locations.length, 0).toLocaleString()],
    ['피킹 선반 칸', layout.floors.reduce((s, f) => s + f.shelves.length, 0).toLocaleString()],
    ['총 용량(유닛)', layout.totalCapacity.toLocaleString()],
    ['상품(SKU)', catalog.skus.length.toLocaleString()],
  ];
  const board: [string, number | string][] = [
    ['FC 손의 지역 카트', q.carts],
    ['라인 대기 상품 박스', q.line],
    ['분배 대기 지역 카트', q.split],
    ['자키 대기 박스', q.jockey],
    ['출고대기 검품 전·중', q.stagedWait],
    ['출고대기 합격(하강 전)', q.stagedPassed],
    ['도크 앞 R/T', q.atDock],
    ['켜진 불(DPS·라인)', q.lights],
  ];
  return (
    <div className="summary">
      {/* 지금 — 단계 이름 + 하루 시간띠(지금 위치) */}
      <div className="now-card">
        <div className="now-h">
          <b>{key[0][1]}</b>
          <span>{sim.clockText()}</span>
        </div>
        <DayTimeline nowMin={sim.time / 60} />
      </div>
      {/* 하루 흐름 — 승인 대비 막대(글 대신 막대, 사용자 2026-11-25) */}
      <div className="flow2">
        {flow.map(([k, v, w]) => (
          <div key={k} className={w ? 'w' : ''} title={`${k} ${v.toLocaleString()}개 (승인 대비 ${d.approved ? Math.round((100 * v) / d.approved) : 0}%)`}>
            <b>{short(v)}</b>
            <Meter value={v} max={d.approved} tone={w ? 'warn' : k === '수령' && v > 0 ? 'ok' : 'accent'} />
            <small>{k}</small>
          </div>
        ))}
      </div>
      <div className="tiles3">
        <Tile v={`${d.busy}/${sim.agents.length}`} k="작업 중">
          <Meter value={d.busy} max={sim.agents.length} tone="ok" />
        </Tile>
        <Tile v={short(sim.pickedLastHour())} k="최근 1시간 피킹" />
        <Tile v={short(sim.shortUnits)} k="결품 보고" tone={sim.shortUnits > 0 ? 'warn' : undefined} />
      </div>
      <details className="more">
        <summary>숫자 모두</summary>
        <div className="kpis">
          {all.map(([k, v]) => (
            <div className="kpi" key={k}>
              <div className="v">{v}</div>
              <div className="k">{k}</div>
            </div>
          ))}
        </div>
        <div className="board">
          {board.map(([k, v]) => (
            <div key={k}>
              {k}
              <b>{v}</b>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

type Dot = 'done' | 'now' | 'wait';
const STEPS = ['피킹', '분류', '검품', '상차', '출발', '인계'] as const;
const GROUPS = ['접수·보충', '피킹', '분류', '검품', '상차', '출발', '인계', '끝'] as const;

/**
 * 현장 흐름판 — MFC SiteFlow 와 같은 모양: 맨 위 단계별 MFC 수(누르면 그 단계만), 아래 MFC × 온도대(TRF)마다 단계 막대.
 * 단계 막대 값 = 이관 진행(승인·피킹·분류·검품·상차·출발 수량)과 운행 인계. 맨 아래 현장 사건 기록 접기.
 */
/** 격자 한 줄 — MFC 이름 + 온도대 칸 3개 */
function MfcRow({ name, region, children }: { name: string; region: string; children: ReactNode }) {
  return (
    <>
      <span className="mg-n">
        <b>{name}</b>
        <small>{region}</small>
      </span>
      {children}
    </>
  );
}

function SiteFlow() {
  const { sim, backend } = useApp();
  const view = useView();
  const [only, setOnly] = useState<number | null>(null);
  const handed = new Map<string, number>();
  for (const r of sim.runs.values()) for (const st of r.stops) if (st.handedAt !== undefined) for (const id of st.trfIds ?? []) handed.set(id, st.handedAt);
  const rows = sim.live('trfs', 700, () => backend.listTransfers()).map((t) => {
    const p = t.progress.reduce(
      (a, x) => ({ ap: a.ap + x.approvedQty, pk: a.pk + x.pickedQty, so: a.so + x.sortedQty, ins: a.ins + x.inspectedQty, ld: a.ld + x.loadedQty, dp: a.dp + x.departedQty }),
      { ap: 0, pk: 0, so: 0, ins: 0, ld: 0, dp: 0 },
    );
    const target = p.pk || p.ap;
    const dot = (v: number, base: number): Dot => (base > 0 && v >= base ? 'done' : v > 0 ? 'now' : 'wait');
    const dots: Dot[] = [dot(p.pk, p.ap), dot(p.so, target), dot(p.ins, target), dot(p.ld, target), dot(p.dp, target), handed.has(t.trfId) ? 'done' : 'wait'];
    // 앞 단계가 끝나지 않았어도 뒤 단계가 시작됐으면 앞은 진행 중
    const first = dots.findIndex((x) => x !== 'done');
    const cur = first < 0 ? 7 : !sim.live('summary', 700, () => sim.summary()).released && first === 0 && p.pk === 0 ? 0 : first + 1;
    return { t, p, dots, cur };
  });
  const count = GROUPS.map((_, i) => rows.filter((x) => x.cur === i).length);
  return (
    <div className="sfl">
      <div className="sfl-pipe" style={{ gridTemplateColumns: `repeat(${GROUPS.length}, 1fr)` }}>
        {GROUPS.map((g, i) => (
          <button key={g} className={`sfl-p ${only === i ? 'on' : ''} ${count[i] ? '' : 'zero'}`} onClick={() => setOnly(only === i ? null : i)} title={only === i ? '다시 누르면 전체' : `${g} 단계 TRF 만`}>
            <b>{count[i]}</b>
            <span>{g}</span>
          </button>
        ))}
      </div>
      {!rows.length && <div className="note">08:00 에 MFC 보충 요청(TRF)을 받습니다.</div>}
      {/* MFC × 온도대 격자 — 칸 하나 = TRF 하나: 지금 단계 + 6단계 막대(글 대신, 사용자 2026-11-25). 누르면 그 MFC 의 TRF 카드로 */}
      {rows.length > 0 && (
        <div className="mfc-grid">
          <span />
          {(['AMBIENT', 'CHILLED', 'FROZEN'] as const).map((tp) => (
            <span key={tp} className="mg-h">
              {TEMP_KO[tp]}
            </span>
          ))}
          {MFCS.map((m) => (
            <MfcRow key={m.id} name={m.name.replace(/^\d호점 /, '')} region={m.region}>
              {(['AMBIENT', 'CHILLED', 'FROZEN'] as const).map((tp) => {
                const r = rows.find((x) => x.t.mfcId === m.id && trfTemp(x.t) === tp);
                if (!r) return <span key={tp} className="mg-c empty">—</span>;
                const { t, p, dots, cur } = r;
                const dim = only != null && only !== cur;
                const tip = `${sim.no('TRF', t.trfId)} (시스템 번호 ${t.trfId})\n승인 ${p.ap.toLocaleString()} · 피킹 ${p.pk.toLocaleString()} · 분류 ${p.so.toLocaleString()} · 검품 ${p.ins.toLocaleString()} · 상차 ${p.ld.toLocaleString()} · 출발 ${p.dp.toLocaleString()}${handed.has(t.trfId) ? ` · 인계 ${clock(handed.get(t.trfId)!)}` : ''}`;
                return (
                  <button
                    key={tp}
                    className={`mg-c st-${cur} ${dim ? 'dim' : ''}`}
                    title={tip}
                    onClick={() => {
                      view.setMfcFilter(m.id);
                      if (view.rightView !== 'trf') view.toggleRight('trf');
                    }}
                  >
                    <b>{GROUPS[cur]}</b>
                    <span className="mg-steps">
                      {dots.map((d, i) => (
                        <i key={i} className={d} title={STEPS[i]} />
                      ))}
                    </span>
                    <small>{short(p.ap)}</small>
                  </button>
                );
              })}
            </MfcRow>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="mg-legend">
          <span>
            <i className="done" />
            끝난 단계
          </span>
          <span>
            <i className="now" />
            진행 중
          </span>
          <span>
            <i className="wait" />
            아직
          </span>
          <span className="mg-tip">칸을 누르면 그 MFC 의 TRF</span>
        </div>
      )}
      <details className="sfl-log">
        <summary>현장 사건 기록 {sim.events.length ? `${sim.events.length}건` : ''} (보충·Wave·결품·검품·출발)</summary>
        {sim.events.length ? (
          sim.events
            .slice(-120)
            .reverse()
            .map((e, i) => (
              <div className={`row wrap ${e.kind === 'warn' ? 's-bad' : ''}`} key={i}>
                <span className="t">{clock(e.at)}</span>
                <span>{e.text}</span>
              </div>
            ))
        ) : (
          <div className="note">아직 없습니다.</div>
        )}
      </details>
    </div>
  );
}

/** 재고 — 층·구역별 칸·용량·현물·예약(원장). 줄을 누르면 그 구역으로 */
function Stock() {
  const { layout, backend, sim } = useApp();
  const view = useView();
  const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
  const t = backend.ledger.totals();
  const v = sim.live('check', 2000, () => backend.ledger.check());
  // 고른 MFC 몫 — 할당(예약)·피킹·출고대기 박스
  const mfc = view.mfcFilter ? MFCS.find((m) => m.id === view.mfcFilter) : undefined;
  const mine = mfc ? sim.live(`mfc-stock-${mfc.id}`, 1000, () => {
    const ts = backend.listTransfers().filter((x) => x.mfcId === mfc.id);
    const sum = (k: 'allocatedQty' | 'pickedQty' | 'departedQty') => ts.reduce((a, x) => a + x.progress.reduce((b, l) => b + l[k], 0), 0);
    return { alloc: sum('allocatedQty'), picked: sum('pickedQty'), departed: sum('departedQty'), staged: [...sim.staged.values()].flat().filter((b) => b.mfcId === mfc.id).reduce((a, b) => a + b.units, 0) };
  }) : undefined;
  return (
    <>
      <div className="pick-row">
        <MfcPick />
      </div>
      {mfc && mine && (
        <div className="note">
          {mfc.name} 몫 — 할당 {mine.alloc.toLocaleString()} · 피킹 {mine.picked.toLocaleString()} · 출고대기 박스 {mine.staged.toLocaleString()}개 · 출발 {mine.departed.toLocaleString()}
        </div>
      )}
      <div className="note">
        CDC 현물 {t.onHand.toLocaleString()} · 예약 {t.reserved.toLocaleString()} · Transit {t.transit.toLocaleString()} · 원장 불변식 위반 {v.length}건{v.length ? ` (${v[0]})` : ''}. 줄을 누르면 그 구역으로 갑니다.
      </div>
      <table className="inv">
        <thead>
          <tr>
            <th>층·구역</th>
            <th>종류</th>
            <th>칸</th>
            <th>현물 / 용량</th>
            <th>채움</th>
          </tr>
        </thead>
        <tbody>
          {layout.floors.flatMap((f) =>
            f.spec.zones.flatMap((z) =>
              (['RACK', 'SHELF'] as const).map((kind) => {
                const ls = kind === 'RACK' ? f.locations.filter((l) => l.zone === z.letter) : f.shelves.filter((l) => l.zone === z.letter);
                const cap = ls.reduce((s, l) => s + l.capacity, 0);
                const on = ls.reduce((s, l) => s + (stock.get(l.code) ?? 0), 0);
                const id = kind === 'RACK' ? `${f.floor}-${z.letter}` : `${f.floor}-${z.letter}-SHELF`;
                return (
                  <tr
                    key={id}
                    onClick={() => {
                      view.setFloor(f.floor);
                      view.focusZone(id);
                    }}
                  >
                    <td>
                      {f.floor}F {z.label}
                    </td>
                    <td>{kind === 'RACK' ? '팔레트' : '선반'}</td>
                    <td>{ls.length.toLocaleString()}</td>
                    <td>
                      {short(on)} / {short(cap)}
                    </td>
                    <td>{cap ? Math.round((on / cap) * 100) : 0}%</td>
                  </tr>
                );
              }),
            ),
          )}
        </tbody>
      </table>
    </>
  );
}

function LogBody({ tab }: { tab: RightView }): ReactNode {
  const { sim } = useApp();
  if (tab === 'transport') return <Transport />;
  if (tab === 'trf') return <TrfBoard />;
  if (tab === 'admin') return <AdminBoard />;
  if (tab === 'moves') return <MovesBoard />;
  if (tab === 'barcode') return <BarcodeBoard />;
  if (tab === 'inventory')
    return (
      <>
        <StockSearch />
        <Stock />
      </>
    );
  if (tab === 'api')
    return sim.apiLog.slice(-150).map((r, i) => {
      const ok = typeof r.status === 'number' && r.status < 400;
      return (
        <div className="row" key={i}>
          <span className="t">{clock(r.at)}</span>
          <span className={`m-${r.method}`}>{r.method}</span>
          <span className={ok ? 's-ok' : 's-bad'}>
            {r.status}
            {r.code ? ` ${r.code}` : ''}
          </span>
          <span>{r.path}</span>
          {r.note && <span className="gap">{r.note}</span>}
        </div>
      );
    });
  if (tab === 'events')
    return sim.domainEvents.slice(-150).map((e, i) => (
      <div className="evrow" key={i} title={e.summary}>
        <div className="evh">
          <span className="t">{clock(e.at)}</span>
          <span className="ev">{e.type}</span>
        </div>
        <div className="evs">{e.summary}</div>
      </div>
    ));
  return <SiteFlow />;
}

/** 탭 내용 — 내용이 바뀔 때만 다시 만들고, 로그 탭은 바닥을 따라간다(MFC Log 와 같음) */
function Log({ tab }: { tab: RightView }) {
  const { sim, backend } = useApp();
  useTick();
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const key = `${tab}:${sim.apiLog.length}:${sim.domainEvents.length}:${sim.events.length}:${tab === 'logs' || tab === 'inventory' || tab === 'transport' ? `${Math.floor(sim.time / 30)}.${backend.ledger.version}` : ''}`;
  const live = tab === 'trf' || tab === 'admin' || tab === 'moves' || tab === 'barcode' || tab === 'inventory';
  const memo = useMemo(() => <LogBody tab={tab} />, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = live ? <LogBody tab={tab} /> : memo;
  const lastTab = useRef(tab);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const changed = lastTab.current !== tab;
    lastTab.current = tab;
    if ((tab === 'api' || tab === 'events') && (stick.current || changed)) el.scrollTop = el.scrollHeight;
  }, [key, tab]);
  return (
    <div
      className="log"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
      }}
    >
      {body}
    </div>
  );
}

export function RightPanel() {
  const view = useView();
  useTick();
  if (!view.rightView) return null;
  return (
    <div className="panel right">
      <Summary />
      <Log tab={view.rightView} />
    </div>
  );
}

const RUN_KO = { PLANNED: '배차', LOADING: '상차 중', IN_TRANSIT: '운송 중', RETURNING: '복귀 중', RETURNED: '복귀', CANCELLED: '결행' } as const;
const hmSec = (sec?: number) => (sec === undefined ? '' : fmt(sec / 60));

/** 운송 — 운행(노선 × 온도대)마다 차·기사·출차·정차별 도착·인계 [TMS 2.2] */
function Transport() {
  const { sim } = useApp();
  const view = useView();
  const runs = [...sim.runs.values()].filter((r) => !view.mfcFilter || r.stops.some((st) => st.mfcId === view.mfcFilter)).sort((a, b) => a.plan.plannedDepartMin - b.plan.plannedDepartMin);
  if (!runs.length && sim.runs.size) return (
    <>
      <div className="pick-row">
        <MfcPick />
      </div>
      <div className="note">고른 MFC 로 가는 운행이 없습니다.</div>
    </>
  );
  if (!runs.length) {
    // 22:00 배차 전 — 정규차 노선표 미리 보기(사용자 2026-11-26 "운송 탭 오른쪽에 나오는 걸 보고 싶다")
    const pre = sim.tms.previewDay().filter((p) => !view.mfcFilter || p.stops.some((s) => s.mfcId === view.mfcFilter));
    return (
      <>
        <div className="pick-row">
          <MfcPick />
        </div>
        <div className="note">
          22:00 배차 전 — 오늘 운행 예정(정규차, 노선 × 온도대 차 한 대, 5톤 {TMS.vehicle.maxRt} R/T). 물량 없는 운행은 배차 때 결행.
        </div>
        <table className="inv">
          <thead>
            <tr>
              <th>노선</th>
              <th>차·기사</th>
              <th>출차</th>
              <th>정차 (도착 예정)</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {pre.map((p) => (
              <tr key={`${p.routeId}-${p.temp}`}>
                <td>
                  {p.region} {TEMP_KO[p.temp]}
                </td>
                <td>
                  {p.plateNo}
                  <br />
                  {p.driverName}
                </td>
                <td>{fmt(p.departMin)}</td>
                <td>
                  {p.stops.map((s) => (
                    <div key={s.mfcId}>
                      {MFCS.find((m) => m.id === s.mfcId)?.name.replace(/^\d호점 /, '')} {fmt(s.arriveMin)}
                    </div>
                  ))}
                  <div className="muted">복귀 {fmt(p.returnMin)}</div>
                </td>
                <td>배차 전</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  return (
    <>
    <div className="pick-row">
      <MfcPick />
    </div>
    <table className="inv">
      <thead>
        <tr>
          <th>노선</th>
          <th>차·기사</th>
          <th>출차</th>
          <th>정차 (도착·인계)</th>
          <th>상태</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.plan.tripId} title={`${r.plan.tripId} · ${r.result ?? ''}`}>
            <td>
              {r.plan.region} {TEMP_KO[r.plan.temp]}
            </td>
            <td>
              {r.plateNo}
              <br />
              {r.driverName}
            </td>
            <td>
              {fmt(r.plan.plannedDepartMin)}
              {r.departedAt !== undefined && (
                <>
                  <br />
                  실제 {hmSec(r.departedAt)}
                </>
              )}
            </td>
            <td>
              {r.stops.map((st, i) => (
                <div key={st.mfcId}>
                  {MFCS.find((m) => m.id === st.mfcId)?.name.replace(/^\d호점 /, '')} {fmt(r.plan.plannedArriveMin[i])}
                  {st.arrivedAt !== undefined && ` → ${hmSec(st.arrivedAt)}`}
                  {st.handedAt !== undefined && ` · 인계 ${(st.received ?? 0).toLocaleString()}`}
                </div>
              ))}
            </td>
            <td>
              {RUN_KO[r.state]}
              <br />
              R/T {Math.ceil(r.loaded.length / OUTBOUND.boxesPerRt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
