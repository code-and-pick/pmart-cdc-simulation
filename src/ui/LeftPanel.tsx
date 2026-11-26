// 왼쪽 패널 — 설정(센터 고정값·시간표) · 구역(층·칸 정보) · 도움말. MFC 시뮬레이터 LeftPanel 의 sec/srow 모양을 쓴다.
import { Fragment, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { runLanOne } from '../backend/http/lanRun';
import { setLanRun, useLanRun } from './lanRunStore';
import { checkReadiness, READINESS_KO, type ProbeResult } from '../backend/http/readiness';
import { useApp, useTick, useView } from '../app/context';
import { CDC_FACTS, MFCS, OUTBOUND, SHIFT, WORK, RACK, FLOW, AUTOSTORE } from '../config';
import { ROLE_KO, type Role } from '../sim/agent';
import { equipZoneId } from '../domain/layout';
import type { FloorNo } from '../domain/sites/chilgok';
import { autostorePorts } from '../sim/site';
import { Barcode } from './Barcode';
import { DayTimeline, Meter, Tile } from './viz';

function Sec({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <h4>
        {title}
        {aside && <span>{aside}</span>}
      </h4>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="srow kv">
      <span className="srow-l">{k}</span>
      <b className="srow-v">{v}</b>
    </div>
  );
}

const TEMP_NAME = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' } as const;
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 한 줄 슬라이더 — MFC LeftPanel Slider 와 같은 모양(이름 · 막대 · 값 · ⓘ) */
function Slider(props: { name: string; value: number; min: number; max: number; step: number; hint: string; unit?: string; apply: (v: number) => void }) {
  return (
    <div className="srow">
      <span className="srow-l">{props.name}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} aria-label={props.name} onChange={(e) => props.apply(Number(e.target.value))} />
      <b className="srow-v">
        {props.value}
        {props.unit ?? ''}
      </b>
      <span className="tip" tabIndex={0} aria-label={props.hint}>
        i<span className="tip-box">{props.hint}</span>
      </span>
    </div>
  );
}

const VW_ROLES: { role: Role; name: string; shift?: 'DAY' | 'EVENING'; max: number }[] = [
  { role: 'FC', name: 'FC 피커', max: 40 },
  { role: 'DPS', name: 'DPS 구역(5F)', max: 30 },
  { role: 'SORT', name: 'DAS·분배', max: 24 },
  { role: 'JOCKEY', name: '자키', max: 16 },
  { role: 'REPL', name: '지게차(주간)', shift: 'DAY', max: 30 },
  { role: 'INSPECT', name: '검품', max: 10 },
];

/** 설정 → 가상 작업자 — 층별 인원 슬라이더와 속도 배수(MFC "가상 작업자"처럼) [사용자 §6-10] */
function VirtualWorkers() {
  const { sim } = useApp();
  useTick();
  const [fl, setFl] = useState<FloorNo>(5);
  return (
    <Sec title="가상 작업자" aside="바로 반영">
      <div className="chips" style={{ marginBottom: 6 }}>
        {([5, 6, 7] as const).map((n) => (
          <button key={n} className={fl === n ? 'on' : ''} onClick={() => setFl(n)}>
            {n}F
          </button>
        ))}
      </div>
      {VW_ROLES.map((r) => (
        <Slider key={r.role} name={r.name} value={sim.headcount(fl, r.role, r.shift)} min={0} max={r.max} step={1} unit="명" hint={`${fl}F ${r.name} 인원 — 늘리면 바로 일하고, 줄이면 지금 일을 마치고 빠집니다`} apply={(v) => sim.setHeadcount(fl, r.role, v, r.shift)} />
      ))}
      <Slider name="속도 배수" value={sim.paceScale} min={0.5} max={2} step={0.05} unit="×" hint="모든 작업자 걸음·손 빠르기 배수(현장 속도 차이 0.85~1.15 에 곱함)" apply={(v) => (sim.paceScale = v)} />
    </Sec>
  );
}

/** 구역 카테고리별 막대 — 그 구역 SKU 를 이름(품목)으로 묶어 현물 합 [사용자 §6-9] */
function CategoryBars({ letter }: { letter: string }) {
  const { catalog, backend, sim } = useApp();
  const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
  const groups = new Map<string, number>();
  for (const s of catalog.skus.filter((x) => x.zone === letter)) {
    const k = s.name.replace(/ (대용량|소용량|오리지널|라이트|묶음|1\+1|가족용)$/, '');
    const q = [s.shelf, ...s.alt].reduce((a, l) => a + (stock.get(l.code) ?? 0), 0);
    groups.set(k, (groups.get(k) ?? 0) + q);
  }
  const rows = [...groups].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <>
      <div className="note">품목별 피킹 칸 현물</div>
      {rows.map(([k, q]) => (
        <div key={k} className="srow kv" title={`${k} ${q.toLocaleString()}개`}>
          <span className="srow-l" style={{ minWidth: 90 }}>
            {k}
          </span>
          <div className="bar" style={{ flex: 1 }}>
            <i style={{ width: `${(q / max) * 100}%` }} />
          </div>
          <b className="srow-v">{q.toLocaleString()}</b>
        </div>
      ))}
    </>
  );
}

/** 랙별 목록 — › 누르면 단별, 단을 누르면 칸별(수량), 칸을 누르면 3D 에서 그 칸으로 [사용자 §6-9] */
function RackList({ letter, shelf }: { letter: string; shelf: boolean }) {
  const { backend, sim } = useApp();
  const view = useView();
  const f = view.floorLayout()!;
  const [open, setOpen] = useState<string | null>(null);
  const [lv, setLv] = useState<number | null>(null);
  const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
  const cells = (shelf ? f.shelves.filter((l) => !l.bin && !l.lane) : f.locations).filter((l) => l.zone === letter);
  const aisles = [...new Set(cells.map((l) => l.aisle))].sort((a, b) => a - b);
  return (
    <div className="lows">
      {aisles.map((a) => {
        const ac = cells.filter((l) => l.aisle === a);
        const key = `${letter}${a}`;
        const on = ac.reduce((s, l) => s + (stock.get(l.code) ?? 0), 0);
        return (
          <div key={a} style={{ display: 'block' }}>
            <div
              onClick={() => {
                setOpen(open === key ? null : key);
                setLv(null);
              }}
              style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
            >
              <span>
                {open === key ? '⌄' : '›'} {letter}
                {String(a).padStart(2, '0')}
              </span>
              <span>{ac.length.toLocaleString()}칸</span>
              <span>{on.toLocaleString()}개</span>
            </div>
            {open === key &&
              [...new Set(ac.map((l) => l.level))].sort((x, y) => x - y).map((level) => {
                const lc = ac.filter((l) => l.level === level);
                return (
                  <div key={level} style={{ display: 'block', paddingLeft: 12 }}>
                    <div onClick={() => setLv(lv === level ? null : level)} style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <span>
                        {lv === level ? '⌄' : '›'} {level}단{!shelf && level === 1 && lc[0]?.type === 'PICK_FACE' ? ' (박스 피킹면)' : ''}
                      </span>
                      <span>{lc.filter((l) => (stock.get(l.code) ?? 0) > 0).length}/{lc.length}칸</span>
                      <span>{lc.reduce((s, l) => s + (stock.get(l.code) ?? 0), 0).toLocaleString()}개</span>
                    </div>
                    {lv === level &&
                      lc.slice(0, 60).map((l) => (
                        <div key={l.code} style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 12, cursor: 'pointer' }} onClick={() => view.focusLocation(l)}>
                          <span>{l.short}</span>
                          <span>
                            {(stock.get(l.code) ?? 0).toLocaleString()}/{l.capacity}
                          </span>
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

// 개발용 성능 탭 — npm run dev 에서만(MFC 와 같음)
const PerfPanel = import.meta.env.DEV ? lazy(() => import('../dev/perf').then((m) => ({ default: m.PerfPanel }))) : null;

export function LeftPanel() {
  const view = useView();
  if (!view.leftView) return null;
  return (
    <div className="panel left">
      {view.leftView === 'perf' ? (
        PerfPanel && (
          <Suspense fallback={null}>
            <PerfPanel />
          </Suspense>
        )
      ) : view.leftView === 'zone' ? (
        <ZoneInfo />
      ) : view.leftView === 'workers' ? (
        <Workers />
      ) : view.leftView === 'help' ? (
        <Help />
      ) : (
        <Settings />
      )}
    </div>
  );
}

function Settings() {
  const { real, layout, sim } = useApp();
  useTick();
  return (
    <>
      {real && <RealCheck />}
      {real && <LanRun />}
      <VirtualWorkers />
      {/* 글 줄 대신 숫자 타일·막대·표(사용자 2026-11-25 "글이 많아 직관적으로 안 보여") */}
      <Sec title={CDC_FACTS.name} aside="고정값">
        <div className="sub-line" title={CDC_FACTS.address}>
          {CDC_FACTS.address}
        </div>
        <div className="tiles3">
          <Tile v={`${CDC_FACTS.areaPyeong.toLocaleString()}평`} k="면적" />
          <Tile v={`${CDC_FACTS.floors[0]}~${CDC_FACTS.floors[CDC_FACTS.floors.length - 1]}F`} k="사용 층" />
          {/* 보관 용량은 칸 용량 합(계산값) — 520만은 목표(사용자 2026-11-25 "고정값을 계산값으로") */}
          <Tile v={`${(layout.capacity.total / 10_000).toFixed(0)}만`} k="보관 유닛">
            <Meter value={layout.capacity.total} max={Math.max(layout.capacity.total, CDC_FACTS.capacityUnits) * 1.1} tone={layout.capacity.total >= CDC_FACTS.capacityUnits ? 'ok' : 'bad'} title={`계산 ${layout.capacity.total.toLocaleString()} / 목표 ${CDC_FACTS.capacityUnits.toLocaleString()}`} />
          </Tile>
        </div>
      </Sec>
      <Sec title="층 배치" aside={`랙 6m 4단 · 통로 ${RACK.aisleW}m`}>
        {(() => {
          const maxP = Math.max(...layout.floors.map((f) => f.locations.length));
          const maxS = Math.max(...layout.floors.map((f) => f.shelves.length));
          return layout.floors.map((f) => (
            <div key={f.floor} className="floor-row" title={`보관(팔레트 랙) ${Math.round(f.layoutPyeong.storage).toLocaleString()}평 · 작업장(DT) ${Math.round(f.layoutPyeong.band).toLocaleString()}평`}>
              <span className="fl-badge">{f.floor}F</span>
              <span className="fl-name">{f.label.replace(/^\dF\s*/, '')}</span>
              <span className="fl-bars">
                <span>
                  팔레트 <b>{f.locations.length.toLocaleString()}</b>
                  <Meter value={f.locations.length} max={maxP} />
                </span>
                <span>
                  선반 <b>{f.shelves.length.toLocaleString()}</b>
                  <Meter value={f.shelves.length} max={maxS} tone="ok" />
                </span>
              </span>
            </div>
          ));
        })()}
      </Sec>
      <Sec title="하루 시간표" aside={`휴식 ${SHIFT.breaks.map((b) => hm(b.start)).join(' · ')}`}>
        <DayTimeline nowMin={sim.time / 60} />
        <div className="time-chips">
          <span>
            주간조 <b>{hm(SHIFT.day.start)}~{hm(SHIFT.day.end)}</b>
          </span>
          <span>
            석간조 <b>{hm(SHIFT.evening.start)}~{hm(SHIFT.evening.end)}</b>
          </span>
          <span>
            R/T 카운팅 <b>{hm(OUTBOUND.rtCountAt)}</b>
          </span>
          <span>
            출차 <b>{hm(SHIFT.departure)}~</b>
          </span>
        </div>
      </Sec>
      <Sec title="작업자 (층마다, 지금 인원)">
        <table className="mini-tbl">
          <thead>
            <tr>
              <th />
              <th>FC</th>
              <th>DPS</th>
              <th>DAS</th>
              <th>자키</th>
              <th>지게차</th>
              <th>검품</th>
            </tr>
          </thead>
          <tbody>
            {([5, 6, 7] as const).map((fl) => (
              <tr key={fl}>
                <th>{fl}F</th>
                {(['FC', 'DPS', 'SORT', 'JOCKEY', 'REPL', 'INSPECT'] as const).map((r) => {
                  const n = sim.headcount(fl, r, r === 'REPL' ? 'DAY' : undefined);
                  return <td key={r}>{n || <span className="zero">·</span>}</td>;
                })}
              </tr>
            ))}
            <tr>
              <th>도크</th>
              <td colSpan={6} className="left">
                상차 {OUTBOUND.loaders}명(냉동 5F·냉장 6F·상온 7F) · {hm(OUTBOUND.loaderShift.start)}~{hm(OUTBOUND.loaderShift.end % (24 * 60))}
              </td>
            </tr>
          </tbody>
        </table>
      </Sec>
      <Sec title="공급 MFC" aside={`${MFCS.length}곳`}>
        <div className="mfc-chips">
          {MFCS.map((m) => (
            <span key={m.id} title={`${m.id} · ${m.region}`}>
              <i>PPC-{String(m.staging).padStart(2, '0')}</i>
              {m.name.replace(/^\d호점 /, '')}
              <small>{m.region}</small>
            </span>
          ))}
        </div>
      </Sec>
    </>
  );
}

function Stat({ v, k }: { v: ReactNode; k: string }) {
  return (
    <div>
      <b>{v}</b>
      <span>{k}</span>
    </div>
  );
}

/**
 * 왼쪽 "구역" — MFC ZonePanel 과 같은 구조: 위 구역 칩(누르면 그 구역으로), 고른 구역 이름·평, 숫자 칸(stats)·채움 막대·누르면 가는 목록(lows),
 * 그 아래 고른 칸. (사용자 2026-11-25 "탭 UI 가 MFC 랑 완전 다른데 정보도 별로")
 */
const ZONE_GROUPS: [string, string][] = [
  ['RACK', '보관 랙'],
  ['SHELF', '피킹 선반'],
  ['EQUIP', '설비'],
  ['BAND', '작업장'],
];
/** 구역 이름 짧게 — "(서쪽)·(동쪽)"은 남기고 그 밖의 괄호 설명은 뗀다(마우스를 올리면 전체) */
const zoneShort = (label: string) => label.replace(/\s*\((서쪽|동쪽)\)/, ' · $1').replace(/\s*\(.*\)$/, '').replace(/ 피킹 선반/, ' 선반');

function ZoneInfo() {
  const { layout } = useApp();
  const view = useView();
  useTick();
  const f = view.floorLayout()!;
  const views = view.zoneViews().filter((v) => v.key !== 'ALL');
  const zone = f.zones.find((z) => z.id === view.focusedZone);
  const loc = view.selected;
  const r = zone?.rect;
  return (
    <section className="sec zone-panel">
      {/* 구역 고르기 — 종류별 묶음(보관 랙 · 피킹 선반 · 설비 · 작업장), 짧은 이름 + 온도 점. 긴 설명은 마우스를 올리면(사용자 2026-11-26 "구역 왼쪽 탭 UI 수정") */}
      <div className="zone-groups">
        {ZONE_GROUPS.map(([kind, title]) => {
          const vs = views.filter((v) => (f.zones.find((z) => z.id === v.key)?.kind ?? 'BAND') === kind);
          if (!vs.length) return null;
          return (
            <div key={kind} className="zone-group">
              <small>{title}</small>
              <div className="zone-chips2">
                {vs.map((v) => {
                  const z = f.zones.find((x) => x.id === v.key);
                  return (
                    <button key={v.key} className={v.key === view.focusedZone ? 'on' : ''} onClick={() => view.focusZone(v.key)} title={v.label}>
                      <i className={`tdot ${(z?.temp ?? 'NONE').toLowerCase()}`} />
                      {zoneShort(v.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {zone && r ? (
        <>
          <h4 className="zone-h">
            {zone.kind === 'SHELF' ? zone.label.replace(/ \(.*\)/, '') : zone.label}
            <span>
              {' '}
              {Math.round(((r.x1 - r.x0) * (r.z1 - r.z0)) / 3.3058).toLocaleString()}평 · {zone.temp ? TEMP_NAME[zone.temp] : '작업장(DT)'}
            </span>
          </h4>
          <ZoneBody key={zone.id} zoneId={zone.id} />
        </>
      ) : (
        <div className="scan-empty">
          구역을 고르면(위 칩 또는 3D 바닥) 칸 수·현물·채움률, 보충 남은 칸, 지금 일하는 사람이 여기에 나옵니다. {layout.floors.length}개 층 · 층 고르기는 위 층 단추.
        </div>
      )}
      {loc && <CellCard />}
    </section>
  );
}

/** 오토스토어 — 설계(격자·통·칸·로봇·포트·하중)와 작동(포트 가동률·로봇·통 교환·대기·실사·보충) [사용자 2026-11-26 "누르면 안에 설계랑 작동"] */
/** 오토스토어 흐름 — 피킹(FC)과 보충(지게차) 두 줄, 단계마다 지금 몇 명(숫자가 있는 단계만 강조) */
function AutoFlow({ floor }: { floor: number }) {
  const { sim } = useApp();
  const people = sim.agents.filter((a) => a.floor === floor);
  const fc = people.filter((a) => a.role !== 'REPL' && a.pda?.title === '오토스토어 포트 피킹');
  const rp = people.filter((a) => a.role === 'REPL' && /오토스토어|입고 포트/.test(a.activity));
  const cnt = (xs: typeof people, re: RegExp) => xs.filter((a) => re.test(a.activity)).length;
  const lanes: { title: string; steps: [string, number][] }[] = [
    {
      title: '피킹 (FC)',
      steps: [
        ['포트로', cnt(fc, /포트로|포트 대기/)],
        ['로봇이 통 가져옴', cnt(fc, /로봇이 통/)],
        ['칸에서 집기', cnt(fc, /스캔|담기|집기/)],
        ['통 반납·실사', cnt(fc, /실사/)],
        ['MFC 박스 → 휠소터', cnt(fc, /휠소터|내려놓/)],
      ],
    },
    {
      title: '보충 (지게차)',
      steps: [
        ['입고 포트로', cnt(rp, /입고 포트로/)],
        ['통에 채우기', cnt(rp, /통에 채우기/)],
      ],
    },
  ];
  return (
    <div className="as-flow">
      {lanes.map((l) => (
        <div key={l.title} className="as-lane">
          <small>{l.title}</small>
          <div className="trip-flow">
            {l.steps.map(([k, n], i) => (
              <span key={k} className="trip-wrap">
                <span className={`trip-node${n ? ' now' : ''}`}>
                  <i>{n}</i>
                  <span>
                    <b>{k}</b>
                  </span>
                </span>
                {i < l.steps.length - 1 && <span className="trip-arrow">→</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AutoStoreInfo() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const fl = view.floorLayout()!;
  const A = fl.autostore!;
  const st = sim.autoOf(fl.floor);
  const u = sim.portUtil(fl.floor);
  const busyRobots = st.robotFree.filter((t) => t > sim.time).length;
  const m2 = (A.rect.x1 - A.rect.x0) * (A.rect.z1 - A.rect.z0);
  const fill = A.binsFit ? A.bins / A.binsFit : 0;
  return (
    <>
      <Sec title="설계" aside="[가정] 값은 설정에서">
        <Row k="격자" v={`${A.nx} × ${A.nz} 칸 (칸 ${AUTOSTORE.cell.x} × ${AUTOSTORE.cell.z} m) · ${Math.round(m2).toLocaleString()}㎡ (${Math.round(m2 / 3.3058)}평)`} />
        <Row k="쌓는 단" v={`${AUTOSTORE.stack}단 · 통 높이 ${AUTOSTORE.binHeightsMm.join('/')}mm · 통 최대 ${AUTOSTORE.maxBinKg}kg`} />
        <Row k="통" v={`필요 ${A.bins.toLocaleString()} / 들어가는 ${A.binsFit.toLocaleString()} (${Math.round(fill * 100)}%)`} />
        <Meter value={A.bins} max={A.binsFit} tone={fill > 0.9 ? 'warn' : 'accent'} />
        <Row k="칸·SKU" v={`통당 ${AUTOSTORE.compartmentsPerBin}칸 · SKU 당 ${AUTOSTORE.compartmentsPerSku}칸 · SKU ${A.skus.toLocaleString()}`} />
        <Row k="용량" v={`${A.capacity.toLocaleString()} 유닛 (칸당 ${AUTOSTORE.unitsPerCompartment})`} />
        <Row k="로봇·포트" v={`로봇 ${A.robots}대 · 포트 ${A.ports}개(포트당 시간당 ${AUTOSTORE.portBinsPerHour}통 상한)`} />
        <Row k="통 가져오기" v={`로봇 ${AUTOSTORE.fetchSec}초 · 다음 통 미리 줄 세움`} />
        <Row k="바닥 하중" v={`${A.floorLoadKgM2.toLocaleString()} / 허용 ${A.floorLoadAllowedKgM2.toLocaleString()} kg/㎡`} />
      </Sec>
      {/* 작동 — 흐름(단계마다 지금 몇 명) · 포트마다 누가 무엇 · 숫자 타일. 사용자 2026-11-26 "오토스토어 작업 흐름 UI 고쳐" — 전엔 사람 이름·활동을 쉼표로 길게 이음 */}
      <Sec title="작동" aside={sim.clockText()}>
        <AutoFlow floor={fl.floor} />
        <div className="as-ports">
          {autostorePorts(A.rect, A.ports).map((px, i) => {
            const who = sim.agents.find((a) => a.floor === fl.floor && a.role !== 'REPL' && a.pda?.title === '오토스토어 포트 피킹' && Math.abs(a.at.x - px) < 0.5);
            const x = u[i] ?? 0;
            const doing = !who ? '비어 있음' : /로봇이 통/.test(who.activity) ? '통 오는 중' : /포트로/.test(who.activity) ? '오는 중' : /포트 대기/.test(who.activity) ? '포트 대기' : /실사/.test(who.activity) ? '순환 실사' : '집는 중';
            return (
              <div key={i} className={`as-port${who ? ' on' : ''}`}>
                <div className="as-port-h">
                  <b>포트 {i + 1}</b>
                  <span>{Math.round(x * 100)}%</span>
                </div>
                <Meter value={x} max={1} tone={x > 0.85 ? 'warn' : 'ok'} />
                <small>{who ? `${who.name.replace(/^.* /, '')} · ${doing}` : doing}</small>
              </div>
            );
          })}
        </div>
        <div className="tiles3">
          <Tile v={`${busyRobots}/${A.robots}`} k="일하는 로봇">
            <Meter value={busyRobots} max={A.robots} tone="ok" />
          </Tile>
          <Tile v={st.bins.toLocaleString()} k="오늘 꺼낸 통" />
          <Tile v={`${st.waiting}통`} k="로봇이 가져오는 중" />
          <Tile v={`${st.waits}회`} k={`포트 대기 · 평균 ${st.waits ? Math.round(st.waitSec / st.waits) : 0}초`} />
          <Tile v={`${st.counts}회`} k="순환 실사" />
          <Tile v={`${st.refills}회`} k="보충(통 채움)" />
        </div>
      </Sec>
    </>
  );
}

function ZoneBody({ zoneId }: { zoneId: string }) {
  const { backend, sim, catalog } = useApp();
  const view = useView();
  const f = view.floorLayout()!;
  const zone = f.zones.find((z) => z.id === zoneId)!;
  if (zone.id.endsWith('AUTOSTORE')) return <AutoStoreInfo />;
  const letter = zone.id.split('-')[1];
  const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
  const people = (roles: string[]) => sim.agents.filter((a) => a.floor === f.floor && roles.includes(a.role) && !a.idle);
  const Bar = ({ pct, color }: { pct: number; color: string }) => (
    <div className="bar">
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  );
  const tempColor = zone.temp === 'FROZEN' ? '#4f8ff7' : zone.temp === 'CHILLED' ? '#27ae60' : '#e0a040';
  if (zone.kind === 'RACK' || zone.kind === 'SHELF') {
    const cells = zone.kind === 'RACK' ? f.locations.filter((l) => l.zone === letter) : f.shelves.filter((l) => l.zone === letter);
    const on = cells.reduce((a, l) => a + (stock.get(l.code) ?? 0), 0);
    const cap = cells.reduce((a, l) => a + l.capacity, 0);
    const filled = cells.filter((l) => (stock.get(l.code) ?? 0) > 0).length;
    const pct = cap ? Math.round((on / cap) * 100) : 0;
    const needs = sim.live('needs', 700, () => backend.replenishmentNeeds()).filter((n) => n.from.split('-')[1] === letter && n.from.split('-')[2] === String(f.floor));
    const aisles = (zone.kind === 'RACK' ? f.aisles : f.shelfAisles).filter((a) => a.zone === letter);
    const skus = catalog.skus.filter((s) => s.zone === letter).length;
    const working = zone.kind === 'RACK' ? people(['REPL']) : people(['FC']);
    // 선반: 비어 가는 칸(현물/용량 낮은 순) · 랙: 보충으로 선반에 옮길 것
    const low =
      zone.kind === 'SHELF'
        ? cells
            .map((l) => ({ l, q: stock.get(l.code) ?? 0 }))
            .filter((x) => x.q < x.l.capacity * 0.25)
            .sort((a, b) => a.q - b.q)
            .slice(0, 8)
        : [];
    const go = (code: string) => {
      const l = [...f.locations, ...f.shelves].find((x) => x.code === code);
      if (l) view.focusLocation(l);
    };
    return (
      <>
        <div className="stats">
          <Stat v={aisles.length} k={zone.kind === 'RACK' ? `통로 (${aisles[0]?.plate ?? ''}~)` : `선반 통로 (${aisles[0]?.plate ?? ''}~)`} />
          <Stat v={zone.kind === 'RACK' ? f.rows.filter((r) => r.zone === letter).length / 2 : skus.toLocaleString()} k={zone.kind === 'RACK' ? '랙 묶음 줄(12개)' : 'SKU'} />
          <Stat v={cells.length.toLocaleString()} k={`칸 (재고 ${filled.toLocaleString()})`} />
          <Stat v={on.toLocaleString()} k="현물(유닛)" />
          <Stat v={zone.kind === 'RACK' ? needs.length : low.length} k={zone.kind === 'RACK' ? '선반 보충 남은 것' : '거의 빈 칸(<25%)'} />
          <Stat v={working.length} k={zone.kind === 'RACK' ? '지게차 일하는 중' : 'FC 일하는 중(층)'} />
        </div>
        <Bar pct={pct} color={tempColor} />
        <div className="note">
          채움 {pct}% ({on.toLocaleString()} / {cap.toLocaleString()} 유닛)
        </div>
        {zone.kind === 'RACK' && needs.length > 0 && (
          <>
            <div className="note">보충할 팔레트</div>
            <div className="lows">
              {needs.slice(0, 8).map((n) => (
                <div key={`${n.sku}${n.from}`} onClick={() => go(n.from)}>
                  <span>{n.from.split('-').slice(3).join('-')}</span>
                  <span>{catalog.bySku.get(n.sku)?.name ?? n.sku}</span>
                  <span>{n.qty}개</span>
                </div>
              ))}
            </div>
          </>
        )}
        <CategoryBars letter={letter} />
        <div className="note">{zone.kind === 'RACK' ? '랙(통로)별' : '선반 통로별'}</div>
        <RackList letter={letter} shelf={zone.kind === 'SHELF'} />
        {low.length > 0 && (
          <>
            <div className="note">거의 빈 칸</div>
            <div className="lows">
              {low.map(({ l, q }) => (
                <div key={l.code} onClick={() => go(l.code)}>
                  <span>{l.short}</span>
                  <span>{catalog.skus.find((s) => s.shelf.code === l.code)?.name ?? ''}</span>
                  <span>
                    {q}/{l.capacity}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  }
  if (zone.kind === 'BAND') {
    const staged = f.staging.map((s) => ({ s, boxes: sim.staged.get(s.code) ?? [] })).filter((x) => x.boxes.length);
    return (
      <>
        <div className="stats">
          <Stat v={f.lifts.length} k="화물 승강기(92)" />
          <Stat v={f.staging.length} k="출고대기 자리(91)" />
          <Stat v={staged.reduce((a, x) => a + x.boxes.length, 0)} k="출고대기 박스" />
          <Stat v={staged.reduce((a, x) => a + x.boxes.filter((b) => b.state === 'PASSED').length, 0)} k="검품 합격" />
        </div>
        {staged.length ? (
          <div className="lows">
            {staged.map(({ s, boxes }) => (
              <div key={s.code} onClick={() => view.focusLocation(s)}>
                <span>{s.short}</span>
                <span>{MFCS.find((m) => m.id === boxes[0].mfcId)?.name ?? ''}</span>
                <span>
                  {boxes.length}박스 · 합격 {boxes.filter((b) => b.state === 'PASSED').length}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="note">출고대기에 박스가 없습니다.</div>
        )}
      </>
    );
  }
  // 설비
  const e = f.equipment.find((x) => equipZoneId(f.floor, x) === zone.id);
  const q = sim.queues();
  const lit = sim.lights.filter((l) => l.floor === f.floor);
  const rows: [ReactNode, string][] =
    e?.kind === 'DAS'
      ? [
          [sim.lineQueue.get(f.floor)?.length ?? 0, 'DAS 대기 상품 박스'],
          [lit.filter((l) => l.kind === 'LINE').length, '지금 켜진 칸 불'],
          [(sim.dasRt.get(f.floor) ?? 0).toFixed(1), '다 찬 롤테이너(R/T)'],
          [(() => {
            const h = sim.lineLitByFloor.get(f.floor) ?? [];
            const n = h.reduce((a, b) => a + (b ?? 0), 0);
            return n ? (h.reduce((a, b, i) => a + (b ?? 0) * i, 0) / n).toFixed(1) : '—';
          })(), '스캔 1회당 켜진 칸(평균)'],
        ]
      : e?.kind === 'SPLIT'
        ? [
            [people(['SORT']).filter((a) => Number(a.id.slice(-2)) % 2 === 0).length, '분배 작업자 일하는 중'],
            [q.split, '분배 대기 지역 카트'],
            [sim.sealedBy.SPLIT.toLocaleString(), '닫은 MFC 크레이트'],
          ]
        : e?.kind === 'DPS'
          ? [
              [sim.dps.boxes.length, '컨베이어 위 PPC 박스'],
              [lit.filter((l) => l.kind === 'DPS').length, '켜진 선반 불'],
              ...Array.from({ length: FLOW.dps.zones }, (_, i): [ReactNode, string] => {
                const p = sim.dps.pass[i] ?? [];
                return [`${sim.dps.queues[i]?.length ?? 0} · ${p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length / 60) : 0}분`, `${i + 1}구역 대기 박스 · 통과 시간`];
              }),
            ]
          : e?.kind === 'WHEEL_SORTER'
            ? (() => {
                const lg = sim.sorterLog.filter((x) => x.floor === f.floor && x.temp === e.temp);
                const hour = lg.filter((x) => x.kind === 'IN' && sim.time - x.at < 3600).length;
                return [
                  [hour, '시간당 투입 박스'],
                  [sim.sorterTransit.get(`${f.floor}-${e.temp}`) ?? 0, '대기(이동 중) 박스'],
                  [lg.filter((x) => x.kind === 'DAS').length, 'DAS 존으로'],
                  ...MFCS.map((m, i): [ReactNode, string] => [lg.filter((x) => x.kind === 'CHUTE' && x.mfc === i).length, `PPC-${String(m.staging).padStart(2, '0')} 슈트 도착 (${m.name.replace(/^d호점 /, '')})`]),
                ];
              })()
            : (() => {
                const A = f.autostore!;
                const u = sim.portUtil(f.floor);
                return [
                  [`${A.bins.toLocaleString()} / ${A.binsFit.toLocaleString()}`, '통 필요 / 그린 면적에 들어가는 통'],
                  [`${A.skus.toLocaleString()} · ${A.capacity.toLocaleString()}`, 'SKU · 용량(유닛)'],
                  [A.robots, '로봇'],
                  [sim.autoOf(f.floor).waiting, '대기 통(로봇이 가져오는 중)'],
                  [u.length ? u.map((x) => Math.round(x * 100) + '%').join(' / ') : '—', `포트 ${A.ports}개 가동률`],
                  [`${A.floorLoadKgM2.toLocaleString()} / ${A.floorLoadAllowedKgM2.toLocaleString()}`, '바닥 하중 kg/㎡ (16단 / 허용 [확인 필요])'],
                ];
              })();
  return (
    <>
      <div className="stats">
        {rows.map(([v, k]) => (
          <Stat key={k} v={v} k={k} />
        ))}
      </div>
      <div className="note">
        {e?.kind === 'DAS'
          ? `휠소터 컨베이어로 들어온 상품을 스캔하면 받을 PPC 칸들에 작업자 색 불과 수량이 켜집니다. 다 찬 롤테이너는 바로 앞 출고대기로. 라인 작업자: ${sim.agents.filter((a) => a.floor === f.floor && a.role === 'SORT' && Number(a.id.slice(-2)) <= FLOW.lineWorkers[f.floor]).map((a) => `${a.name.split(' ').pop()} ${sim.colorOf(a).name}`).join(', ')}`
          : e?.kind === 'SPLIT'
            ? 'FC 가 가져온 지역 카트(야채)를 PDA 로 스캔 → MFC 별 수량 → MFC 크레이트에 담고 지역 바코드로 확인합니다.'
            : e?.kind === 'DPS'
              ? `PPC 별 빈 박스가 컨베이어를 타고 ${FLOW.dps.zones}개 구역을 지나며, 박스가 구역에 오면 그 구역 선반 칸에 불·수량이 켜집니다. 작업자는 자기 구역에 서서 집어 넣고, 박스는 다음 구역으로(구역당 ${FLOW.dps.workersPerZone}명·컨베이어 ${FLOW.dps.conveyorSpeed}m/s).`
              : e?.kind === 'WHEEL_SORTER'
                ? '박스째 가는 상품은 PPC 별 롤테이너 슈트로 바로, 낱개로 나눌 상품은 DAS 존 라인으로 갑니다.'
              : ''}
      </div>
    </>
  );
}

/** 고른 칸 — 위치 코드·재고(LOT·기한·현물·예약) */
function CellCard() {
  const { backend, catalog } = useApp();
  const view = useView();
  const loc = view.selected!;
  const stock = backend.ledger.cellsAt(loc.code);
  return (
    <Sec title="고른 칸" aside={loc.type === 'PICK_FACE' ? '피킹 선반' : loc.type === 'RESERVE' ? '팔레트 보관' : loc.type === 'STAGING' ? '출고대기' : '접안'}>
      <Row k="위치 코드" v={loc.code} />
      <Row k="통로·베이·단·슬롯" v={`${loc.aisle} · ${loc.bay} · ${loc.level} · ${loc.slot}`} />
      {loc.capacity > 0 && <Row k="용량" v={`${loc.capacity.toLocaleString()} 유닛`} />}
      {stock.length === 0 && loc.type !== 'STAGING' && <Row k="재고" v="비어 있음" />}
      {stock.map((c) => (
        <div key={c.lot}>
          <Row k="상품" v={`${catalog.bySku.get(c.sku)?.name ?? ''} (${c.sku})`} />
          <Row k="LOT · 기한" v={`${c.lot} · ${c.expiresAt}`} />
          <Row k="현물 · 예약" v={`${c.onHand.toLocaleString()} · ${c.reserved.toLocaleString()} 유닛`} />
        </div>
      ))}
    </Sec>
  );
}

/** 실서버 한 건 돌리기 — 새 TRF 하나를 인수부터 출발까지(LAN 에 씀, 사용자 2026-11-26 승인 "LAN 에서 새 TRF 한 건을 처음부터 끝까지 돌리는 점검") */
function LanRun() {
  const { real } = useApp();
  // 상태는 패널 밖(lanRunStore) — 탭이 바뀌어도 진행·팝업이 남는다
  const { mfcId, mode, steps, busy, hideScan } = useLanRun();
  if (!real) return null;
  const go = (resumeTrfId?: string) => {
    setLanRun({ busy: true, steps: [], ...(resumeTrfId ? { trfId: resumeTrfId } : {}) });
    void runLanOne({ gateway: real.backend.client, backend: real.backend, internal: real.internal, operatorId: () => real.tokens.operatorId }, { mfcId, skus: 3, qty: 2, pda: mode === 'pda' || !!resumeTrfId, pdaWaitMin: 60, ...(resumeTrfId ? { resumeTrfId } : {}) }, (st) => {
      const id = [...st].reverse().find((x) => x.trfId)?.trfId;
      setLanRun({ steps: st, ...(id ? { trfId: id } : {}) });
    }).finally(() => setLanRun({ busy: false }));
  };
  const waitingPda = busy && steps?.at(-1)?.name.startsWith('PDA');
  const cur = steps?.at(-1);
  const scanCodes = busy && cur?.state === 'run' && cur.scan?.length ? cur.scan : null;
  return (
    // 실서버 한 건 — 새 TRF 1건을 LAN 에 실제로 넣어 출발까지. 피킹은 자동(시뮬레이터) 또는 PDA 앱(사람)으로(사용자 2026-11-26 "PDA 로 작업 되는지 확인")
    <section className="sec lr">
      <div className="lr-h">
        <b>실서버 한 건 돌리기</b>
        <span className="lr-tag">LAN 에 씀</span>
      </div>
      <div className="lr-form">
        <span>피킹</span>
        <div className="wk-seg c2">
          <button className={mode === 'pda' ? 'on' : ''} onClick={() => setLanRun({ mode: 'pda' })} disabled={busy}>
            PDA 앱으로
          </button>
          <button className={mode === 'auto' ? 'on' : ''} onClick={() => setLanRun({ mode: 'auto' })} disabled={busy}>
            자동
          </button>
        </div>
        <span>MFC</span>
        <select className="lr-sel" value={mfcId} onChange={(e) => setLanRun({ mfcId: e.target.value })} disabled={busy}>
          {MFCS.filter((m) => !m.id.startsWith('ETC-')).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {mode === 'pda' && (
        <ol className="lr-pda">
          <li>
            시작하면 시뮬레이터가 TRF·Wave 배포 · 배차 · <b>입차</b>까지 합니다
          </li>
          <li>
            PDA 앱 DC 업무에서 차례로: <b>피킹</b>(cdcw-fc-01) → <b>분배·패킹</b>(cdcw-dl-01) → <b>검품</b>(cdcw-qc-01) → <b>상차</b>(cdcw-ld-01, 도크 스캔)
          </li>
          <li>상차완료가 되면 시뮬레이터가 출차 → 출발 검증까지</li>
        </ol>
      )}
      <button className="lr-go" onClick={() => go()} disabled={busy}>
        {busy ? (waitingPda ? `PDA 기다리는 중 — ${steps?.at(-1)?.name.replace(/^PDA /, '').split(' — ')[0]}` : '도는 중…') : '새 TRF 로 시작'}
      </button>
      {scanCodes && hideScan && (
        <button className="scan-pop-open" onClick={() => setLanRun({ hideScan: false })}>
          찍을 코드 {scanCodes.length}개 보기
        </button>
      )}
      <LanOpenTrfs onResume={go} busy={busy} />
      {steps && steps.length > 0 && (
        <ol className="lr-steps">
          {steps.map((st, i) => (
            <li key={i} className={st.state}>
              <i>{st.state === 'ok' ? '✓' : st.state === 'fail' ? '!' : i + 1}</i>
              <div>
                <b>{st.name}</b>
                <small>{st.detail}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** PDA 가 찍을 코드 팝업 — 앱 맨 위에 늘 붙어 있어 어느 탭·3D 를 눌러도 남는다(사용자 2026-11-26 "지역 카드 어딨어? 팝업으로", "화면 누르니까 팝업 없어졌어") */
/** LAN 에 출발 전으로 남은 시험 TRF — PDA 로 하던 걸 그 단계부터 이어서(사용자 2026-11-26 "출고대기로 넘어갔는데 계속 피킹 팝업") */
function LanOpenTrfs({ onResume, busy }: { onResume: (trfId: string) => void; busy: boolean }) {
  const { real } = useApp();
  const viewing = useLanRun().trfId;
  const [rows, setRows] = useState<{ trfId: string; trfNumber?: string; state: string; mfcId: string; pickedQty: number; allocatedQty: number; updatedAt?: string }[]>([]);
  useEffect(() => {
    if (!real) return;
    let on = true;
    const load = () =>
      real.backend.client
        .call<{ items?: { trfId: string; trfNumber?: string; state: string; mfcId: string; pickedQty: number; allocatedQty: number; updatedAt?: string }[] }>('GET', '/cdcs/CDC01/transfers', { query: { size: '50' } })
        // 출발한 것도 오늘 것은 남김(도착·인계를 이어 봄) — 단추는 [흐름]만
        .then((r) => on && setRows((r.body.items ?? []).filter((x) => x.trfId.startsWith('TRF-SIM-') && (['IN_WAVE', 'PICKED', 'SORTED', 'INSPECTED', 'LOADED'].includes(x.state) || (x.state === 'DEPARTED' && Date.now() - new Date(x.updatedAt ?? 0).getTime() < 24 * 3600_000))).reverse()))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real]);
  if (!rows.length) return null;
  // 단계 이름으로 — 어느 TRF 가 어디까지 왔는지 한눈에(사용자 2026-11-26 "상차하고 있었는데 웬 피킹" — 다른 TRF 를 이어 하기로 눌렀음)
  const KO: Record<string, string> = { IN_WAVE: '피킹 전·중', PICKED: '분배 전', SORTED: '검품 전', INSPECTED: '상차 전', LOADED: '출차 전', DEPARTED: '출발함' };
  return (
    <div className="lr-open">
      <b>시험 TRF (최근 순)</b>
      {rows.map((x) => (
        <div key={x.trfId} className={`lr-open-row${x.trfId === viewing ? ' on' : ''}`}>
          <span title={x.trfId}>
            <b>{x.trfNumber ?? x.trfId}</b> {KO[x.state] ?? x.state} · 집음 {x.pickedQty}/{x.allocatedQty}
          </span>
          <button className="ghost" onClick={() => setLanRun({ trfId: x.trfId })}>
            흐름
          </button>
          {x.state === 'DEPARTED' ? <i /> : <button disabled={busy} title={busy ? "지금 도는 실행이 끝나야 함" : undefined} onClick={() => onResume(x.trfId)}>이어 하기</button>}
        </div>
      ))}
    </div>
  );
}

export function LanScanPopup() {
  const { steps, busy, hideScan } = useLanRun();
  const cur = steps?.at(-1);
  const codes = busy && cur?.state === 'run' && cur.scan?.length ? cur.scan : null;
  if (!codes) return null;
  const title = cur?.name.replace(/^PDA /, 'PDA · ').split(' — ')[0];
  const now = cur?.detail.split(' · ').slice(-1)[0];
  // 접으면 위쪽 가운데 작은 띠(제목·진행·코드 수), 누르면 다시 펼침 — 사용자 2026-11-26 "접었다 펼 수 있게"
  if (hideScan)
    return createPortal(
      <button className="scan-pop-mini" onClick={() => setLanRun({ hideScan: false })} title="펼치기">
        <b>{title}</b>
        <span>{now}</span>
        <em>코드 {codes.length}개 ▾</em>
      </button>,
      document.body,
    );
  return createPortal(
    <div className="scan-pop" role="dialog" aria-label="PDA 로 찍을 코드">
      <div className="scan-pop-h">
        <b>{title}</b>
        <span>{cur?.trfId ? `${cur.trfId} · ` : ''}PDA 로 이 코드를 찍으세요 · {now}</span>
        <button onClick={() => setLanRun({ hideScan: true })} aria-label="접기" title="접기">
          ▴
        </button>
      </div>
      <div className="scan-pop-list">
        {codes.map((c) => (
          <Barcode key={c.label + c.value} value={c.value} caption={c.label} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function RealCheck() {
  const { real } = useApp();
  const [rows, setRows] = useState<ProbeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    if (!real) return;
    setBusy(true);
    void checkReadiness({ gateway: real.backend.client, outbound: real.internal.outbound, inventory: real.internal.inventory })
      .then(setRows)
      .finally(() => setBusy(false));
  };
  useEffect(run, [real]);
  if (!real) return null;
  return (
    <Sec title="실서버 연결 점검" aside={busy ? '점검 중…' : <button onClick={run}>다시</button>}>
      <div className="help">
        <p>실서버 모드에선 3D 가상 작업자가 움직이지 않습니다(LAN 에 함부로 쓰지 않게). 여기서 LAN 연결을 보고, 아래 "한 건 돌리기"로 실제 흐름을 시험합니다.</p>
        {real.tokens.lastError && <p>토큰: {real.tokens.lastError}</p>}
      </div>
      {/* 서비스마다 한 칸 — 상태는 색 점·글, 자세한 응답은 아래 줄(긴 문구가 값 칸을 한 글자 폭으로 찌그러뜨리던 것, 사용자 2026-11-26 "계속 안 떠") */}
      <div className="rc-list">
        {(rows ?? []).map((r) => (
          <div key={r.service} className={`rc-item ${r.state === 'READY' ? 'ok' : r.state === 'UNREACHABLE' || r.state === 'ERROR' ? 'bad' : 'warn'}`}>
            <div className="rc-top">
              <i />
              <b>{r.service}</b>
              <span>{READINESS_KO[r.state]}</span>
            </div>
            <small>{r.use}</small>
            <code>{r.detail}</code>
          </div>
        ))}
        {!rows && <div className="note">점검 중…</div>}
      </div>
    </Sec>
  );
}

const ROLE_ORDER: Role[] = ['FC', 'DPS', 'SORT', 'JOCKEY', 'INSPECT', 'REPL', 'INBOUND', 'LOADER'];

/** 작업자 목록 — 누르면 그 층으로 가서 PDA 카드를 연다 */
function Workers() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  // 찾기 — 층·역할·상태 버튼 + 검색(이름·번호·하는 일). 사용자 2026-11-26 "원하는 작업자를 보려면 한없이 스크롤 — 검색이나 작업자별 버튼"
  const [q, setQ] = useState('');
  const [fl, setFl] = useState<0 | 5 | 6 | 7>(view.floor as 5 | 6 | 7);
  const [role, setRole] = useState<Role | null>(null);
  const [st, setSt] = useState<'all' | 'busy' | 'idle' | 'off'>('all');
  const stateOf = (a: (typeof sim.agents)[number]) => (/^근무 전|^퇴근|^점심|^휴식/.test(a.activity) ? 'off' : a.idle ? 'idle' : 'busy');
  const k = q.trim();
  const base = sim.agents.filter((a) => !fl || a.floor === fl);
  const list = base
    .filter((a) => (!role || a.role === role) && (st === 'all' || stateOf(a) === st) && (!k || a.name.includes(k) || a.activity.includes(k) || ROLE_KO[a.role].includes(k)))
    .sort((a, b) => a.floor - b.floor || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  const roles = ROLE_ORDER.filter((r) => base.some((a) => a.role === r));
  return (
    <>
      <section className="sec wk-find">
        <input className="search" placeholder="작업자 찾기 (예: 5F-07 · 지게차)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="wk-row-f">
          <span>층</span>
          <div className="wk-seg c4">
          {([0, 5, 6, 7] as const).map((x) => (
            <button key={x} className={fl === x ? 'on' : ''} onClick={() => setFl(x)}>
              {x ? `${x}F` : '전체'}
            </button>
          ))}
          </div>
        </div>
        <div className="wk-row-f">
          <span>역할</span>
          <div className="wk-seg c2 lr">
          <button className={!role ? 'on' : ''} onClick={() => setRole(null)}>
            전체 <small>{base.length}</small>
          </button>
          {roles.map((r) => (
            <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(role === r ? null : r)}>
              {ROLE_KO[r]} <small>{base.filter((a) => a.role === r).length}</small>
            </button>
          ))}
          </div>
        </div>
        <div className="wk-row-f">
          <span>상태</span>
          <div className="wk-seg c2 lr">
          {(
            [
              ['all', '모두'],
              ['busy', '일하는 중'],
              ['idle', '기다리는 중'],
              ['off', '근무 밖'],
            ] as const
          ).map(([v, t]) => (
            <button key={v} className={st === v ? 'on' : ''} onClick={() => setSt(v)}>
              {t} <small>{v === 'all' ? base.filter((a) => !role || a.role === role).length : base.filter((a) => (!role || a.role === role) && stateOf(a) === v).length}</small>
            </button>
          ))}
          </div>
        </div>
      </section>
      <section className="sec wk-list">
        <h4>
          {list.length}명 
        </h4>
        {list.slice(0, 200).map((a) => {
          const s = stateOf(a);
          return (
            <button key={a.id} className={`wk-row${view.selectedWorker === a.id ? ' on' : ''}`} onClick={() => view.selectWorker(a.id, a.floor)} title={`${a.name} · ${a.activity}`}>
              <i className={`wk-dot ${s}`} />
              <span className="wk-name">
                {ROLE_KO[a.role]} <b>{a.name.replace(/^.* /, '')}</b>
              </span>
              <span className="wk-act">{a.activity}</span>
              {a.onDutySeconds > 60 && <span className="wk-util">{Math.round(a.utilization * 100)}%</span>}
            </button>
          );
        })}
        {list.length > 200 && <div className="note">200명까지 표시</div>}
      </section>
      <details className="wk-floors">
        <summary>층별 자세히(예전 목록)</summary>
      {([5, 6, 7] as const).map((fl) => {
        const people = sim.agents.filter((a) => a.floor === fl).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
        const busy = people.filter((a) => !a.idle).length;
        // 층 가동률(근무 시간 가중) — 사용자 2026-11-25 "작업자별 UPH·유휴율"
        const on = people.reduce((x, a) => x + a.onDutySeconds, 0);
        const idle = people.reduce((x, a) => x + a.idleSeconds, 0);
        const util = on > 0 ? Math.round((100 * (on - idle)) / on) : null;
        return (
          <Sec key={fl} title={`${fl}F`} aside={`일하는 사람 ${busy}/${people.length}${util !== null ? ` · 가동 ${util}%` : ''}`}>
            {people.map((a) => (
              <button
                key={a.id}
                className="srow kv"
                style={{ width: '100%', background: view.selectedWorker === a.id ? 'var(--hi-bg, rgba(139,92,246,.18))' : 'none', border: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                onClick={() => view.selectWorker(a.id, fl)}
                title={`${ROLE_KO[a.role]} · ${Math.round(a.distance / WORK.stepLen).toLocaleString()}보`}
              >
                <span className="srow-l">{a.name}</span>
                <b className="srow-v">{a.activity}</b>
                {a.onDutySeconds > 60 && (
                  <span className="wk-rate" title={`근무 ${Math.round(a.onDutySeconds / 60)}분 · 일 없이 기다림 ${Math.round(a.idleSeconds / 60)}분 · 처리 ${a.units.toLocaleString()}개 · 완료 ${a.done}건`}>
                    가동 {Math.round(a.utilization * 100)}% · 유휴 {Math.round((1 - a.utilization) * 100)}%{a.units > 0 ? ` · UPH ${Math.round(a.uph)}` : ` · ${(a.done / Math.max(1 / 60, a.onDutySeconds / 3600)).toFixed(1)}건/h`}
                  </span>
                )}
              </button>
            ))}
          </Sec>
        );
      })}
      </details>
    </>
  );
}


/** 도움말 카드 — kv = 뜻 표, steps = [시각, 할 일] 순서 */
const HELP_CARDS: { title: string; sub?: string; kv?: [string, string][]; steps?: [string, string][] }[] = [
  {
    title: '조작',
    sub: 'MFC 시뮬레이터와 같음',
    kv: [
      ['왼쪽 끌기', '이동'],
      ['오른쪽 끌기', '돌리기'],
      ['휠', '가리킨 곳으로 확대'],
      ['화살표·WASD', '이동'],
      ['Esc', '나가기'],
      ['배속', '위 오른쪽 1×~120×, ❚❚ 멈춤'],
    ],
  },
  {
    title: '누르면',
    kv: [
      ['칸(빈 칸도)', '멀리선 그 구역 위로, 가까이선 칸 정면으로 — 왼쪽에 위치 코드·상품·LOT·현물·예약'],
      ['사람', 'PDA 화면(왼쪽 ☺ 작업자 목록에서도)'],
      ['칸 번호', '가까이 확대하면 빔 앞에 보임(번호 · 랙만 · 끔)'],
    ],
  },
  {
    title: '위치 코드',
    sub: '센터-구역-층-통로-베이-단-슬롯 (예 CDC01-A-5-02-24-3-1)',
    kv: [
      ['A~D', '6F 상온(A·B 무거운 상자, D 인기상품)'],
      ['E·F', '7F 생활용품(F 오토스토어)'],
      ['G', '5F 냉장'],
      ['H', '5F 냉동'],
      ['90', '도크 — 북쪽 벽, 문 번호 층-번호(5F 냉장 3·냉동 2 · 6F 상온 2 · 7F 상온 4)'],
      ['91', '출고대기 롤테이너 자리'],
      ['92', '승강기 문(층 사이 R/T — 층마다 자기 도크라 거의 안 씀)'],
    ],
  },
  {
    title: '하루 흐름',
    sub: '주간조 08:00~17:00 · 석간 13:00~22:00',
    steps: [
      ['08:00', '주간조 TRF 인수·할당 → 지게차로 팔레트 랙 → 피킹 선반 보충'],
      ['08:00~', '입고 차 → 층 입고 검수(5F 냉장·냉동 · 6F·7F 상온 각각) — 화면 흐름만'],
      ['13:00', '석간 Wave 배포 → FC 가 PDA 로 작업 받아 피킹'],
      ['', '분배·라인이 MFC 칸에 담기 → 자키가 출고대기(91)로 → 검품'],
      ['21:30', 'R/T 를 그 층 도크 앞으로'],
      ['22:00', 'R/T 카운팅'],
      ['22:30', '도크 상차'],
      ['출차', '이때만 CDC −q · Transit +q'],
    ],
  },
  {
    title: '밤 운송',
    sub: '오른쪽 ⛟ 운송에서 차마다',
    steps: [
      ['22:00', '배차 — 노선 × 온도대(차 한 대 = 온도대 하나)'],
      ['', '출차 30분 전 도크 상차(방문 역순)'],
      ['01:00', '목포·춘천 출차'],
      ['03:00', '세종·부산 출차'],
      ['05:30', 'MFC 도착 → 하차·인계 → MFC 수령 → 빈 R/T 싣고 복귀'],
    ],
  },
];

function Help() {
  return (
    <>
      {/* 작업자별 흐름과 같은 카드 모양(사용자 2026-11-26 "위에 정리된 것도 그렇게") */}
      <Sec title="도움말">
        <div className="help">
          <ul className="role-flows">
            {HELP_CARDS.map((c) => (
              <li key={c.title}>
                <div className="rf-h">
                  <b>{c.title}</b>
                  {c.sub && <span>{c.sub}</span>}
                </div>
                {c.kv ? (
                  <dl className="rf-kv">
                    {c.kv.map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                ) : (
                  <ol className="rf-steps">
                    {c.steps!.map(([t, s]) => (
                      <li key={t + s}>
                        <b className="rf-t">{t}</b>
                        {s}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Sec>
      <RoleFlows />
    </>
  );
}
/** 작업자별 작업 흐름 — 사용자 2026-11-26 "작업자마다 작업 흐름 한눈에". 시뮬레이션 엔진(simulation.ts 의 역할별 *Once)과 같은 순서 */
const ROLE_FLOWS: { role: string; who: string; when: string; steps: string[] }[] = [
  { role: '지게차 보충', who: '주간 5F 28(냉동 전담 6) · 점심 두 조 · 6F 14 · 7F 16, 석간 층마다 3', when: '08:00~17:00 · 13:00~22:00', steps: ['보충 작업 받기(MOV)', '팔레트 랙에서 팔레트 내리기', '피킹 선반·랙 1단 피킹면·오토스토어 입고 포트로', '박스 뜯어 진열(오토스토어는 통에 채움)'] },
  { role: 'FC 피커', who: '5F 11 · 6F 14 · 7F 19', when: '석간 13:00~22:00', steps: ['PDA 로 다음 작업 받기', '지역 바코드 스캔', '선반·랙·오토스토어 포트에서 피킹(불·숫자대로)', 'MFC 박스 → 휠소터 / 여러 MFC 상품 → DAS 라인 / 냉장 낱개 → 분배대'] },
  { role: 'DPS 구역', who: '5F 냉동 전실 구역마다 3(15)', when: '석간', steps: ['자기 구역 통로 작업 받기(빈 박스)', '선반 불 켜진 칸에서 숫자만큼 담기', '박스를 컨베이어로 다음 구역에', '마지막 구역에서 박스 닫아 → 냉동 휠소터'] },
  { role: 'DAS·분배', who: '라인 5F 6 · 6F 2 · 7F 6 (+5F 분배 7)', when: '석간', steps: ['라인에 모인 상품 박스 스캔', 'MFC 칸마다 내 색 불·숫자 켜짐', '칸마다 숫자만큼 넣기', '그 MFC 몫이 끝나면 칸 박스 닫기 → 자키'] },
  { role: '자키', who: '5F 8 · 6F 4 · 7F 7 (+야간 4)', when: '석간 · 22:00 뒤 야간', steps: ['슈트·라인의 닫힌 박스 모아 롤테이너 싣기', '출고대기(91)에 내려놓기(저온은 보냉 커버)', '21:30 부터 R/T 를 도크 앞으로', '5F 상온은 승강기(92)로 7F 도크'] },
  { role: '검품', who: '층마다 4', when: '석간', steps: ['출고대기에 온 박스 고르기', '수량·봉인·온도 확인', '틀리면 재포장 → 재검품', '통과 → 상차 대기'] },
  { role: '상차', who: '22명 — 도크 층마다(5F 냉장·냉동 · 6F·7F 상온)', when: '야간 22:30~', steps: ['도크 앞 R/T 로', '박스 스캔 대조(MFC·TRF·온도)', '차에 싣기(방문 역순)', '노선별 출차 — 이때만 CDC −q · Transit +q'] },
];

function RoleFlows() {
  return (
    <Sec title="작업자별 작업 흐름">
      <div className="help">
        <ul className="role-flows">
          {ROLE_FLOWS.map((r) => (
            <li key={r.role}>
              <div className="rf-h">
                <b>{r.role}</b>
                <span>
                  {r.who} · {r.when}
                </span>
              </div>
              <ol className="rf-steps">
                {r.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
        <p>왼쪽 ☺ 작업자에서 사람을 누르면 지금 몇 번째 단계인지 PDA 로 보입니다.</p>
      </div>
    </Sec>
  );
}
