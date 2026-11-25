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
import { AdminBoard, BarcodeBoard, MovesBoard, StockSearch, TrfBoard } from './Boards';

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
    ['지하 마당 R/T', q.atB1],
    ['켜진 불(DPS·라인)', q.lights],
  ];
  return (
    <div className="summary">
      <div className="flow">
        {flow.map(([k, v, w]) => (
          <div key={k} className={w ? 'w' : ''} title={`${k} ${v.toLocaleString()}개`}>
            <b>{short(v)}</b>
            <small>{k}</small>
          </div>
        ))}
      </div>
      <div className="kpis four">
        {key.map(([k, v]) => (
          <div className="kpi" key={k}>
            <div className="v">{v}</div>
            <div className="k">{k}</div>
          </div>
        ))}
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
function SiteFlow() {
  const { sim, backend } = useApp();
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
  const mfc = (id: string) => MFCS.find((m) => m.id === id);
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
      {GROUPS.map((g, gi) => {
        if (only != null && only !== gi) return null;
        const list = rows.filter((x) => x.cur === gi);
        if (!list.length) return null;
        return (
          <section key={g} className="sfl-g">
            <h4>
              {g} <span>{list.length}건</span>
            </h4>
            {list.map(({ t, p, dots }) => {
              const m = mfc(t.mfcId);
              const temp = TEMP_KO[trfTemp(t)];
              const under = [p.pk, p.so, p.ins, p.ld, p.dp].map((v) => (v ? short(v) : '')).concat(handed.has(t.trfId) ? clock(handed.get(t.trfId)!) : '');
              const tone = gi === 7 ? 'done' : dots.includes('now') ? 'run' : 'wait';
              return (
                <div key={t.trfId} className={`sfl-r tone-${tone}`} title={t.trfId}>
                  <div className="sfl-h">
                    <b>
                      {m?.name ?? t.mfcId} {temp}
                    </b>
                    <span className="st">
                      {m?.region} · 승인 {short(p.ap)}
                    </span>
                  </div>
                  <ol className="sfl-steps">
                    {STEPS.map((s, i) => (
                      <li key={s} className={dots[i]}>
                        <i />
                        <span className="n">{s}</span>
                        <span className="u">{under[i]}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </section>
        );
      })}
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
  return (
    <>
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
  const runs = [...sim.runs.values()].sort((a, b) => a.plan.plannedDepartMin - b.plan.plannedDepartMin);
  if (!runs.length) return <div className="note">22:00 배차 전입니다. 배차는 고정 노선 × 온도대(차 한 대 = 온도대 하나, 5톤 {TMS.vehicle.maxRt} R/T)로 정하고, 출차는 max(23:00, 첫 MFC 도착 목표 − 주행)입니다.</div>;
  return (
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
  );
}
