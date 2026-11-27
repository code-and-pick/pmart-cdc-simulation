// 오른쪽 패널 — MFC 시뮬레이터 RightPanel 구조 그대로(사용자 2026-11-25 "탭 UI 가 MFC 랑 완전 다른데 정보도 별로"):
// 맨 위 요약(하루 흐름 한 줄 + 핵심 숫자 4 + "숫자 모두" 접기) → 아래 탭 내용(현장 흐름판 · 운송 · API · 이벤트 · 재고).
// 값은 MOCK 계약 응답(이관 진행·원장)과 시뮬레이션 줄에서만.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { MFCS, OUTBOUND, TMS } from '../config';
import type { RightView } from '../render/controller';
import { LanTransport, LanTrfFlow } from './LanTrfFlow';
import { useLanRun } from './lanRunStore';
import { TEMP_KO } from '../sim/simulation';
import { ROLE_KO } from '../sim/agent';
import { trfTemp } from '../sim/supply';
import { AdminBoard, BarcodeBoard, MfcPick, MovesBoard, StockSearch, TrfBoard } from './Boards';
import { DayTimeline, Meter, Tile } from './viz';
import { WorkerFlow } from './WorkerFlow';
import { PlanCard, TripCard, TripSummary } from './TransportFlow';

const clock = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
/** 큰 수는 만 단위로 짧게 */
const short = (n: number) => (n >= 10_000 ? `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}만` : n.toLocaleString());

/** 요약 타일 자세히 — 단계(승인~수령)는 MFC 별 막대, 작업 중은 층 × 역할, 1시간 피킹은 층별, 결품은 최근 기록 */
function SummaryDetail({ k, onClose }: { k: string; onClose: () => void }) {
  const { sim } = useApp();
  const trfs = sim.uiTransfers();
  const head = (t: string) => (
    <div className="sd-h">
      <b>{t}</b>
      <button onClick={onClose} aria-label="닫기">
        ×
      </button>
    </div>
  );
  const STAGE: Record<string, (p: { approvedQty: number; pickedQty: number; sortedQty: number; inspectedQty: number; departedQty: number }) => number> = {
    승인: (p) => p.approvedQty,
    피킹: (p) => p.pickedQty,
    분류: (p) => p.sortedQty,
    검품: (p) => p.inspectedQty,
    출발: (p) => p.departedQty,
  };
  if (STAGE[k] || k === '수령') {
    const rows = MFCS.map((m) => {
      const ts = trfs.filter((t) => t.mfcId === m.id);
      const ap = ts.reduce((a, t) => a + t.progress.reduce((b, p) => b + p.approvedQty, 0), 0);
      const v =
        k === '수령'
          ? [...sim.runs.values()].reduce((a, r) => a + r.stops.filter((s) => s.mfcId === m.id).reduce((b, s) => b + (s.received ?? 0), 0), 0)
          : ts.reduce((a, t) => a + t.progress.reduce((b, p) => b + STAGE[k](p), 0), 0);
      return { m, ap, v, n: ts.length };
    }).filter((r) => r.ap > 0);
    return (
      <div className="sd">
        {head(`${k} — MFC 별`)}
        {rows.map((r) => (
          <div key={r.m.id} className="sd-row">
            <span>{r.m.name.replace(/^d호점 /, '')}</span>
            <i>
              <em style={{ width: r.ap ? `${Math.min(100, (100 * r.v) / r.ap)}%` : 0 }} />
            </i>
            <b>
              {short(r.v)}
              {k !== '승인' && <small> / {short(r.ap)}</small>}
              {k === '승인' && <small> · TRF {r.n}</small>}
            </b>
          </div>
        ))}
        {!rows.length && <div className="note">아직 없음</div>}
      </div>
    );
  }
  if (k === '작업 중') {
    const roles = [...new Set(sim.agents.map((a) => a.role))];
    return (
      <div className="sd">
        {head('일하는 사람 — 층 × 역할')}
        <table className="inv sd-tbl">
          <thead>
            <tr>
              <th>역할</th>
              {[5, 6, 7].map((f) => (
                <th key={f}>{f}F</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r}>
                <td>{ROLE_KO[r]}</td>
                {[5, 6, 7].map((f) => {
                  const ps = sim.agents.filter((a) => a.floor === f && a.role === r);
                  return <td key={f}>{ps.length ? `${ps.filter((a) => !a.idle).length}/${ps.length}` : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (k === '1시간') {
    const from = sim.time - 3600;
    const by = (f: number) => sim.pickLog.filter((x) => x.at > from && x.floor === f).reduce((a, x) => a + x.qty, 0);
    const max = Math.max(1, ...[5, 6, 7].map(by));
    return (
      <div className="sd">
        {head('최근 1시간 피킹 — 층별')}
        {[5, 6, 7].map((f) => (
          <div key={f} className="sd-row">
            <span>{f}F</span>
            <i>
              <em style={{ width: `${(100 * by(f)) / max}%` }} />
            </i>
            <b>{by(f).toLocaleString()}</b>
          </div>
        ))}
      </div>
    );
  }
  // 결품
  const list = [...sim.shortLog].reverse().slice(0, 12);
  return (
    <div className="sd">
      {head(`결품 보고 — 최근 ${list.length}건`)}
      {list.map((x, i) => (
        <div key={i} className="sd-row sd-short">
          <span>{String(Math.floor(x.at / 3600) % 24).padStart(2, '0')}:{String(Math.floor(x.at / 60) % 60).padStart(2, '0')}</span>
          <span>{x.code.replace(/^CDC01-/, '')}</span>
          <b>{x.qty}개</b>
        </div>
      ))}
      {!list.length && <div className="note">없음</div>}
      <div className="note">재할당으로 다른 칸에서 다시 집습니다</div>
    </div>
  );
}

/** 맨 위 요약 — 하루 흐름(승인 → 피킹 → 분류 → 검품 → 출발 → 수령) + 핵심 숫자 4개, 나머지는 "숫자 모두" */
function Summary() {
  const { sim, backend, layout, catalog } = useApp();
  /** 누른 타일 — 아래에 자세히(사용자 2026-11-26 "버튼 누르면 해당 내용이 아래에") */
  const [sel, setSel] = useState<string | null>(null);
  const d = sim.live('summary', 700, () => sim.summary(true));
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
          <div key={k} className={`${w ? 'w' : ''} click${sel === k ? ' on' : ''}`} onClick={() => setSel(sel === k ? null : k)} title={`${k} ${v.toLocaleString()}개 (승인 대비 ${d.approved ? Math.round((100 * v) / d.approved) : 0}%)`}>
            <b>{short(v)}</b>
            <Meter value={v} max={d.approved} tone={w ? 'warn' : k === '수령' && v > 0 ? 'ok' : 'accent'} />
            <small>{k}</small>
          </div>
        ))}
      </div>
      <div className="tiles3">
        <Tile v={`${d.busy}/${sim.agents.length}`} k="작업 중" onClick={() => setSel(sel === '작업 중' ? null : '작업 중')} on={sel === '작업 중'}>
          <Meter value={d.busy} max={sim.agents.length} tone="ok" />
        </Tile>
        <Tile v={short(sim.pickedLastHour())} k="최근 1시간 피킹" onClick={() => setSel(sel === '1시간' ? null : '1시간')} on={sel === '1시간'} />
        <Tile v={short(sim.shortUnits)} k="결품 보고" tone={sim.shortUnits > 0 ? 'warn' : undefined} onClick={() => setSel(sel === '결품' ? null : '결품')} on={sel === '결품'} />
      </div>
      {sel && <SummaryDetail k={sel} onClose={() => setSel(null)} />}
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
  const { sim } = useApp();
  const view = useView();
  const [only, setOnly] = useState<number | null>(null);
  const handed = new Map<string, number>();
  for (const r of sim.runs.values()) for (const st of r.stops) if (st.handedAt !== undefined) for (const id of st.trfIds ?? []) handed.set(id, st.handedAt);
  const rows = sim.uiTransfers().map((t) => {
    const p = t.progress.reduce(
      (a, x) => ({ ap: a.ap + x.approvedQty, pk: a.pk + x.pickedQty, so: a.so + x.sortedQty, ins: a.ins + x.inspectedQty, ld: a.ld + x.loadedQty, dp: a.dp + x.departedQty }),
      { ap: 0, pk: 0, so: 0, ins: 0, ld: 0, dp: 0 },
    );
    const target = p.pk || p.ap;
    const dot = (v: number, base: number): Dot => (base > 0 && v >= base ? 'done' : v > 0 ? 'now' : 'wait');
    const dots: Dot[] = [dot(p.pk, p.ap), dot(p.so, target), dot(p.ins, target), dot(p.ld, target), dot(p.dp, target), handed.has(t.trfId) ? 'done' : 'wait'];
    // 앞 단계가 끝나지 않았어도 뒤 단계가 시작됐으면 앞은 진행 중
    const first = dots.findIndex((x) => x !== 'done');
    const cur = first < 0 ? 7 : !sim.live('summary', 700, () => sim.summary(true)).released && first === 0 && p.pk === 0 ? 0 : first + 1;
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
      {!rows.length && <div className="note">08:00 에 TRF 도착</div>}
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
/**
 * 재고 한눈에(사용자 2026-11-26 "재고탭 누르면 전체 재고 관리와 MFC 로의 실시간 재고이동을 바로") —
 * ① 전체: CDC 현물(보관·피킹 칸 / 출고대기)·예약·운송 중·MFC 수령, 원장 불변식
 * ② MFC 별 흐름: 할당 → 피킹 → 상차 → 출발(운송 중) → 수령, 막대
 * ③ 실시간 이동: 방금 일어난 피킹(→ 출고대기)·출발·수령 줄(원장 커밋)
 */
function StockOverview({ part }: { part: 'mfc' | 'feed' }) {
  const { backend, sim } = useApp();
  useTick();
  const t = backend.ledger.totals();
  const trfs = sim.uiTransfers();
  const received = new Map<string, number>();
  for (const r of sim.runs.values()) for (const st of r.stops) if (st.received) received.set(st.mfcId, (received.get(st.mfcId) ?? 0) + st.received);
  const rows = MFCS.map((m) => {
    const ts = trfs.filter((x) => x.mfcId === m.id);
    const sum = (k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'loadedQty' | 'departedQty') => ts.reduce((a, x) => a + x.progress.reduce((b, l) => b + l[k], 0), 0);
    return { m, ap: sum('approvedQty'), al: sum('allocatedQty'), pk: sum('pickedQty'), ld: sum('loadedQty'), dp: sum('departedQty'), rc: received.get(m.id) ?? 0 };
  });
  // 실시간 이동 — 최근 원장 커밋 중 피킹(→ 91)·출발·수령
  const mfcOfStagingBay = (code: string) => {
    const bay = Number(code.split('-')[4]);
    return MFCS.find((m) => m.staging === bay);
  };
  const feed = backend.ledger
    .commitList()
    .slice(-400)
    .filter((c) => c.postingKind === 'TOUT' || c.postingKind === 'RECEIPT_ACK' || (c.postingKind === 'MOVE' && !(c.sourceRef ?? '').startsWith('REPL:')))
    .slice(-14)
    .reverse()
    .map((c) => {
      const qty = c.deltas.filter((d) => d.delta > 0).reduce((a, d) => a + d.delta, 0) || c.deltas.filter((d) => d.delta < 0).reduce((a, d) => a - d.delta, 0);
      if (c.postingKind === 'MOVE') {
        const to = c.deltas.find((d) => d.delta > 0 && d.locationCode)?.locationCode ?? '';
        const m = mfcOfStagingBay(to);
        return { c, what: '피킹 → 출고대기', who: m ? m.name.replace(/^\d호점 /, '') : '', qty };
      }
      if (c.postingKind === 'TOUT') return { c, what: '출발 (운송 중으로)', who: '', qty };
      return { c, what: 'MFC 수령', who: '', qty };
    });
  if (part === 'feed')
    return (
      <div className="mv-feed">
        {!feed.length && <div className="note">13:00 피킹부터</div>}
        {feed.map(({ c, what, who, qty }) => (
          <div key={c.commitId} className="mv-row">
            <span className="t">{c.appliedAt.slice(11, 16)}</span>
            <span className={`mv-kind ${c.postingKind.toLowerCase()}`}>{what}</span>
            <span className="mv-who">{who}</span>
            <b>{qty.toLocaleString()}</b>
          </div>
        ))}
      </div>
    );
  // MFC 로 가는 재고 — 맨 위 운송 중·MFC 수령 합, MFC 마다 단계 막대(승인 대비)
  const STEPS: ['al' | 'pk' | 'ld' | 'tr' | 'rc', string][] = [
    ['al', '할당'],
    ['pk', '피킹'],
    ['ld', '상차'],
    ['tr', '운송 중'],
    ['rc', '수령'],
  ];
  const live = rows.filter((r) => r.ap > 0);
  return (
    <>
      <div className="mfs-top">
        <div>
          <small>승인(보낼 것)</small>
          <b>{short(rows.reduce((a, r) => a + r.ap, 0))}</b>
        </div>
        <div>
          <small>운송 중</small>
          <b>{short(t.transit)}</b>
        </div>
        <div>
          <small>MFC 수령</small>
          <b>{short(t.acked)}</b>
        </div>
      </div>
      {live.map((r) => {
        const val = { al: r.al, pk: r.pk, ld: r.ld, tr: Math.max(0, r.dp - r.rc), rc: r.rc };
        return (
          <div key={r.m.id} className="mfs-card">
            <div className="mfs-h">
              <b>{r.m.name.replace(/^d호점 /, '')}</b>
              <small>승인 {r.ap.toLocaleString()}</small>
            </div>
            <div className="mfs-steps">
              {STEPS.map(([k, label]) => (
                <div key={k}>
                  <i>
                    <em style={{ width: `${Math.min(100, (100 * val[k]) / Math.max(1, r.ap))}%` }} />
                  </i>
                  <small>{label}</small>
                  <b>{short(val[k])}</b>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!live.length && <div className="note">08:00 에 TRF 도착</div>}
    </>
  );
}


/**
 * 재고 탭 — 무엇의 재고인지 먼저 고르게(사용자 2026-11-26 "뭔 재고인지도 모르겠고 UI 도 별로"):
 * [칠곡 DC 재고] 층·구역별 현물·채움 / [MFC 로 가는 재고] 할당 → 피킹 → 상차 → 운송 중 → 수령 / [실시간 이동] / [상품 찾기]
 */
function InventoryTab() {
  const [sub, setSub] = useState<'dc' | 'mfc' | 'feed' | 'find'>('dc');
  return (
    <>
      <div className="inv-tabs">
        {(
          [
            ['dc', '칠곡 DC 재고'],
            ['mfc', 'MFC 로 가는 재고'],
            ['feed', '재고 변동'],
            ['find', '상품 찾기'],
          ] as const
        ).map(([k, t]) => (
          <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>
            {t}
          </button>
        ))}
      </div>
      {sub === 'dc' && <DcStock />}
      {sub === 'mfc' && <StockOverview part="mfc" />}
      {/* 재고 변동 — 전엔 따로 있던 [변동] 탭(사용자 2026-11-26 "재고 탭이 있는데 변동 탭도 따로") */}
      {sub === 'feed' && <MovesBoard />}
      {sub === 'find' && <StockSearch />}
    </>
  );
}

/** 칠곡 DC 재고 — 맨 위 합계(어디에 얼마), 층마다 카드: 구역 × (보관 랙 / 피킹 자리) 채움 막대 */
function DcStock() {
  const { layout, backend, sim } = useApp();
  const view = useView();
  useTick();
  const t = backend.ledger.totals();
  const stock = sim.live('stock', 1000, () => backend.ledger.onHandByLocation());
  const v = sim.live('check', 5000, () => backend.ledger.check());
  const kindOf = (code: string) => {
    const a = Number(code.split('-')[3]);
    return a === 91 || a === 92 ? 'staged' : a === 90 ? 'dock' : 'store';
  };
  let staged = 0;
  for (const [code, q] of stock) if (kindOf(code) === 'staged') staged += q;
  const sumOf = (ls: { code: string }[]) => ls.reduce((s, l) => s + (stock.get(l.code) ?? 0), 0);
  const rack = sumOf(layout.floors.flatMap((f) => f.locations));
  const face = sumOf(layout.floors.flatMap((f) => f.shelves.filter((l) => !l.bin)));
  const bins = sumOf(layout.floors.flatMap((f) => f.shelves.filter((l) => l.bin)));
  const total = Math.max(1, rack + face + bins + staged);
  const seg: [string, number, string][] = [
    ['보관 랙', rack, '#2f80ed'],
    ['피킹 자리', face, '#27ae60'],
    ['오토스토어', bins, '#7c5cff'],
    ['출고대기', staged, '#f2994a'],
  ];
  return (
    <>
      <div className="dcs-top">
        <div className="dcs-total">
          <small>칠곡 DC 현물</small>
          <b>{short(t.onHand)}개</b>
          <span>
            할당(예약) {short(t.reserved)} · {Math.round((100 * t.reserved) / Math.max(1, t.onHand))}%
          </span>
        </div>
        <div className="dcs-bar">
          {seg.map(([k, n, c]) => (
            <i key={k} style={{ width: `${(100 * n) / total}%`, background: c }} title={`${k} ${n.toLocaleString()}`} />
          ))}
        </div>
        <div className="dcs-legend">
          {seg.map(([k, n, c]) => (
            <span key={k}>
              <i style={{ background: c }} />
              {k} <b>{short(n)}</b>
            </span>
          ))}
        </div>
        {v.length > 0 && <div className="dcs-bad">원장 불일치 {v.length}건 — {v[0]}</div>}
      </div>
      {layout.floors.map((f) => (
        <section key={f.floor} className="sec dcs-floor">
          <h4>
            {f.floor}F <span>{f.spec.label.replace(/^\dF\s*/, '')}</span>
          </h4>
          {f.spec.zones.flatMap((z) =>
            (['RACK', 'SHELF'] as const).map((kind) => {
              const ls = kind === 'RACK' ? f.locations.filter((l) => l.zone === z.letter) : f.shelves.filter((l) => l.zone === z.letter);
              if (!ls.length) return null;
              const cap = ls.reduce((s, l) => s + l.capacity, 0);
              const on = sumOf(ls);
              const pct = cap ? Math.round((100 * on) / cap) : 0;
              const id = kind === 'RACK' ? `${f.floor}-${z.letter}` : `${f.floor}-${z.letter}-SHELF`;
              const what = kind === 'RACK' ? '보관 랙' : ls.some((l) => l.bin) ? '오토스토어' : ls.some((l) => l.lane) ? '피킹 선반·야채 레인' : '피킹 선반';
              return (
                <button
                  key={id}
                  className="dcs-row"
                  onClick={() => {
                    view.setFloor(f.floor);
                    view.focusZone(id);
                  }}
                  title="누르면 3D 에서 그 구역"
                >
                  <span className="dcs-name">
                    <b>{z.label.replace(/\s*\(.*\)$/, '')}</b>
                    <small>{what}</small>
                  </span>
                  <span className="dcs-meter">
                    <i>
                      <em className={pct > 90 ? 'hi' : pct < 20 ? 'lo' : ''} style={{ width: `${Math.min(100, pct)}%` }} />
                    </i>
                    <small>
                      {short(on)} / {short(cap)}
                    </small>
                  </span>
                  <b className="dcs-pct">{pct}%</b>
                </button>
              );
            }),
          )}
        </section>
      ))}
    </>
  );
}

function LogBody({ tab }: { tab: RightView }): ReactNode {
  const { sim, real } = useApp();
  // 실서버 모드 — LAN 운행(도착·인계 단추) 위에, 원래 운송 흐름(시뮬레이션 운행)도 그대로 아래에(사용자 2026-11-26 "운송탭도 같이 보여줘야지 없애면 어떡해")
  if (tab === 'transport')
    return real ? (
      <>
        <div className="lt-sec-h">실서버 운행</div>
        <LanTransport />
        <div className="lt-sec-h">시뮬레이션 운송 흐름</div>
        <Transport />
      </>
    ) : (
      <Transport />
    );
  if (tab === 'trf') return <TrfBoard />;
  if (tab === 'admin') return <AdminBoard />;
  if (tab === 'moves') return <MovesBoard />;
  if (tab === 'barcode') return <BarcodeBoard />;
  if (tab === 'inventory') return <InventoryTab />;
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
  const lan = useLanRun();
  const { real } = useApp();
  useTick();
  const lanOn = !!real && !!lan.trfId;
  if (!view.rightView && !view.selectedWorker && !lanOn) return null;
  return (
    <div className="panel right">
      {/* 고른 작업자의 흐름·실시간 자리 — 맨 위(사용자 2026-11-26) */}
      {/* 실서버 TRF 흐름(PDA 로 하는 TRF) — 맨 위(사용자 2026-11-26) */}
      {/* 실서버 운송 탭은 운행 목록만 — 위에 고정된 TRF 카드·시뮬레이션 요약이 자리를 먹어 스크롤이 비좁던 것(사용자 2026-11-27 "운송탭 위에 고정된 부분이 많아서 한눈에 볼 수가 없어"). 실서버 모드에선 시뮬레이션 요약도 뺌(멈춰 있는 숫자) */}
      {/* 운송 탭에선 TRF 카드를 접힌 띠로(빼지 않음) — 사용자 2026-11-27 "아예 빼버리는 건 좀" */}
      <LanTrfFlow open={!view.rightView || view.rightView === 'trf'} />
      <WorkerFlow />
      {view.rightView && (
        <>
          {/* 실서버 모드에선 시뮬레이션 요약을 접어 둠(멈춘 시뮬레이션 숫자) — 눌러서 펼침 */}
          {real ? (
            <details className="sum-fold">
              <summary>
                <span>가상 현장 요약</span>
                <small>실서버 모드에선 3D 가상 작업자를 멈춰 둠 — 숫자가 안 바뀜</small>
              </summary>
              <Summary />
            </details>
          ) : (
            <Summary />
          )}
          <Log tab={view.rightView} />
        </>
      )}
    </div>
  );
}


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
          22:00 배차 전 · 오늘 예정 운행(5톤 {TMS.vehicle.maxRt} R/T)
        </div>
        <div className="trips">
          {pre.map((p) => (
            <PlanCard key={`${p.routeId}-${p.temp}`} p={p} />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
    <div className="pick-row">
      <MfcPick />
    </div>
    {/* 흐름 — 운행마다 배차 → 상차 → 출발 → MFC 도착·인계 → 복귀 (사용자 2026-11-26) */}
    <TripSummary runs={[...sim.runs.values()]} />
    <div className="trips">
      {runs.map((r) => (
        <TripCard key={r.plan.tripId} r={r} />
      ))}
    </div>
    </>
  );
}
