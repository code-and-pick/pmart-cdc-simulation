// 왼쪽 패널 — 설정(센터 고정값·시간표) · 구역(층·칸 정보) · 도움말. MFC 시뮬레이터 LeftPanel 의 sec/srow 모양을 쓴다.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { checkReadiness, READINESS_KO, type ProbeResult } from '../backend/http/readiness';
import { useApp, useTick, useView } from '../app/context';
import { CDC_FACTS, MFCS, OUTBOUND, SHIFT, WORK, WORKFORCE, RACK } from '../config';
import { ROLE_KO, type Role } from '../sim/agent';
import { equipZoneId } from '../domain/layout';
import type { FloorNo } from '../domain/sites/chilgok';

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
  { role: 'FC', name: 'FC·DPS 피커', max: 20 },
  { role: 'SORT', name: '라인·분배', max: 16 },
  { role: 'JOCKEY', name: '자키', max: 10 },
  { role: 'REPL', name: '지게차(주간)', shift: 'DAY', max: 12 },
  { role: 'INSPECT', name: '검품', max: 6 },
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
  const { real, layout } = useApp();
  return (
    <>
      {real && <RealCheck />}
      <VirtualWorkers />
      <Sec title="센터" aside="고정값">
        <Row k="이름" v={CDC_FACTS.name} />
        <Row k="주소" v={CDC_FACTS.address} />
        <Row k="면적" v={`${CDC_FACTS.areaPyeong.toLocaleString()}평`} />
        <Row k="사용 층" v={`${CDC_FACTS.floors[0]}~${CDC_FACTS.floors[CDC_FACTS.floors.length - 1]}층 (차량은 지하 B1)`} />
        <Row k="보관 용량" v={`${(CDC_FACTS.capacityUnits / 10_000).toLocaleString()}만 유닛`} />
      </Sec>
      <Sec title="층 배치" aside="문서 평수 그대로">
        {layout.floors.map((f) => (
          <Row key={f.floor} k={f.label} v={`보관 ${Math.round(f.layoutPyeong.storage).toLocaleString()} · DT ${Math.round(f.layoutPyeong.band).toLocaleString()}평 · 팔레트 ${f.locations.length.toLocaleString()} · 선반 ${f.shelves.length.toLocaleString()}칸`} />
        ))}
        <Row k="랙" v={`6m 4단 · 묶음 12개 × 양면 · 지게차 통로 ${RACK.aisleW}m`} />
      </Sec>
      <Sec title="하루 시간표">
        <Row k="주간조" v={`${hm(SHIFT.day.start)}~${hm(SHIFT.day.end)}`} />
        <Row k="석간조" v={`${hm(SHIFT.evening.start)}~${hm(SHIFT.evening.end)}`} />
        <Row k="휴식" v={SHIFT.breaks.map((b) => hm(b.start)).join(' · ')} />
        <Row k="R/T 카운팅·상차" v={`${hm(OUTBOUND.rtCountAt)} · ${hm(OUTBOUND.loadFrom)}~`} />
        <Row k="차량 출발" v={`${hm(SHIFT.departure)}~`} />
      </Sec>
      <Sec title="작업자 (층마다)" aside="[가정]">
        {([5, 6, 7] as const).map((fl) => {
          const w = WORKFORCE[fl];
          return <Row key={fl} k={`${fl}F`} v={`지게차 ${w.replDay}+${w.replEve} · FC ${w.fc} · 분배·라인 ${w.sort} · 자키 ${w.jockey} · 검품 ${OUTBOUND.inspectorsPerFloor}`} />;
        })}
        <Row k="B1" v={`상차 ${OUTBOUND.loaders} (${hm(OUTBOUND.loaderShift.start)}~${hm(OUTBOUND.loaderShift.end % (24 * 60))})`} />
      </Sec>
      <Sec title="공급 MFC" aside={`${MFCS.length}곳`}>
        {MFCS.map((m) => (
          <Row key={m.id} k={`${m.region} · PPC-${String(m.staging).padStart(2, '0')}`} v={m.name} />
        ))}
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
function ZoneInfo() {
  const { layout } = useApp();
  const view = useView();
  useTick();
  if (view.floor === 'B1') return <B1Info />;
  const f = view.floorLayout()!;
  const views = view.zoneViews().filter((v) => v.key !== 'ALL');
  const zone = f.zones.find((z) => z.id === view.focusedZone);
  const loc = view.selected;
  const r = zone?.rect;
  return (
    <section className="sec zone-panel">
      <div className="chips zone-chips">
        {views.map((v) => (
          <button key={v.key} className={v.key === view.focusedZone ? 'on' : ''} onClick={() => view.focusZone(v.key)}>
            {v.label}
          </button>
        ))}
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
          <ZoneBody zoneId={zone.id} />
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

function ZoneBody({ zoneId }: { zoneId: string }) {
  const { backend, sim, catalog } = useApp();
  const view = useView();
  const f = view.floorLayout()!;
  const zone = f.zones.find((z) => z.id === zoneId)!;
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
            <div className="note">선반으로 보충할 것 (팔레트 → 선반) — 누르면 그 팔레트 칸으로</div>
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
        <div className="note">{zone.kind === 'RACK' ? '랙별(통로) — › 누르면 단별·칸별' : '선반 통로별 — › 누르면 단별·칸별'}</div>
        <RackList letter={letter} shelf={zone.kind === 'SHELF'} />
        {low.length > 0 && (
          <>
            <div className="note">거의 빈 선반 칸 — 누르면 그 칸으로</div>
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
          [people(['SORT']).filter((a) => Number(a.id.slice(-2)) % 2 === 1).length, '라인 작업자 일하는 중'],
          [q.line, '라인 대기 상품 박스'],
          [lit.filter((l) => l.kind === 'LINE').length, '켜진 칸 불'],
          [sim.sealedBy.LINE.toLocaleString(), '닫은 MFC 박스'],
        ]
      : e?.kind === 'SPLIT'
        ? [
            [people(['SORT']).filter((a) => Number(a.id.slice(-2)) % 2 === 0).length, '분배 작업자 일하는 중'],
            [q.split, '분배 대기 지역 카트'],
            [sim.sealedBy.SPLIT.toLocaleString(), '닫은 MFC 크레이트'],
          ]
        : e?.kind === 'DPS'
          ? [
              [lit.filter((l) => l.kind === 'DPS').length, '켜진 선반 불'],
              [sim.sealedBy.DPS.toLocaleString(), '닫은 MFC 박스'],
            ]
          : e?.kind === 'WHEEL_SORTER'
            ? [['—', '거의 안 씀 (박스 피킹 → 바로 출고대기)']]
            : [['20,000', '빈(bin) [가정]'], ['비식재', '낱개 상품']];
  return (
    <>
      <div className="stats">
        {rows.map(([v, k]) => (
          <Stat key={k} v={v} k={k} />
        ))}
      </div>
      <div className="note">
        {e?.kind === 'DAS'
          ? '자키가 가져온 상품 박스를 스캔하면 그 상품을 받는 MFC 칸에 작업자 색 불과 숫자가 켜지고, 숫자만큼 넣으면 꺼집니다.'
          : e?.kind === 'SPLIT'
            ? 'FC 가 가져온 지역 카트(야채)를 PDA 로 스캔 → MFC 별 수량 → MFC 크레이트에 담고 지역 바코드로 확인합니다.'
            : e?.kind === 'DPS'
              ? '냉동 피킹 — 작업자 색 불·숫자가 켜진 선반 칸에서 집어 MFC 박스에 담고, 박스를 닫아 컨베이어로 보냅니다.'
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

/** B1 지하 — 접안 자리·차·마당 R/T */
function B1Info() {
  const { layout, sim } = useApp();
  const runs = [...sim.runs.values()];
  return (
    <section className="sec zone-panel">
      <h4 className="zone-h">
        B1 지하 차량 접안 <span>8,600평 밖</span>
      </h4>
      <div className="stats">
        <Stat v={layout.docks.length} k="접안 자리(90)" />
        <Stat v={runs.filter((r) => r.state === 'LOADING' || r.state === 'PLANNED').length} k="대기·상차 중 차" />
        <Stat v={sim.atB1.length} k="마당 R/T" />
        <Stat v={runs.filter((r) => r.departedAt !== undefined).length} k="출차한 차" />
      </div>
      <div className="lows">
        {runs.map((r) => (
          <div key={r.plan.tripId}>
            <span>{r.plateNo}</span>
            <span>
              {r.plan.region} {TEMP_NAME[r.plan.temp]}
            </span>
            <span>R/T {Math.ceil(r.loaded.length / OUTBOUND.boxesPerRt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 실서버 연결 점검 — 서비스마다 조회 하나(서버 상태를 바꾸지 않음) */
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
        <p>실서버 모드에서는 시뮬레이션 엔진을 돌리지 않습니다 — cdc-outbound·TMS 가 LAN 에 아직 없고 CDC 시험 계정도 아직 없습니다(R-16, 이름 제안 claude-cdc-sup·cdcw-*). 아래는 조회만 해 보는 연결 점검입니다. 공개 경로는 게이트웨이 + 직원 토큰, 내부 경로는 LAN 서비스 직접(토큰 없음, CDC-9).</p>
        {real.tokens.lastError && <p>토큰: {real.tokens.lastError}</p>}
      </div>
      {(rows ?? []).map((r) => (
        <Row key={r.service} k={`${r.service} · ${r.use}`} v={`${READINESS_KO[r.state]} (${r.detail})`} />
      ))}
    </Sec>
  );
}

const ROLE_ORDER: Role[] = ['FC', 'SORT', 'JOCKEY', 'INSPECT', 'REPL', 'LOADER'];

/** 작업자 목록 — 누르면 그 층으로 가서 PDA 카드를 연다 */
function Workers() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  return (
    <>
      {([5, 6, 7, 'B1'] as const).map((fl) => {
        const people = sim.agents.filter((a) => a.floor === fl).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
        const busy = people.filter((a) => !a.idle).length;
        return (
          <Sec key={fl} title={fl === 'B1' ? 'B1 지하 상차' : `${fl}F`} aside={`일하는 사람 ${busy}/${people.length}`}>
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
              </button>
            ))}
          </Sec>
        );
      })}
    </>
  );
}


function Help() {
  return (
    <Sec title="도움말">
      <div className="help">
        <p>조작(MFC 와 같음): 왼쪽 끌기 = 이동, 오른쪽 끌기 = 돌리기, 휠 = 마우스가 가리킨 곳으로 확대, 화살표·WASD = 이동, Esc = 나가기. 가까이 확대하면 빔 앞에 칸 번호(위치 코드)가 붙습니다(번호 · 랙만 · 끔).</p>
        <p>칸(빈 칸도)을 누르면 멀리서는 그 구역 위로, 가까이서는 그 칸 정면으로 가고 왼쪽에 위치 코드·상품·LOT·현물·예약이 나옵니다. 사람을 누르면 PDA.</p>
        <p>위치 코드: 센터-구역-층-통로-베이-단-슬롯 (예 CDC01-C-5-02-24-3-1). 구역 글자 A 냉동 · B 냉장 · C~H 상온.</p>
        <p>91 = 출고대기 롤테이너 자리, 92 = 승강기 반출 문, 90 = 지하 차량 접안.</p>
        <p>밤: 22:00 배차(노선 × 온도대, 차 한 대 = 온도대 하나) → 출차 30분 전 지하 상차(방문 역순) → 노선별 출차(01:50~03:40) → MFC 도착·하차·인계 → MFC 수령 → 복귀. 오른쪽 ⛟ 운송에서 차마다 봅니다.</p>
        <p>하루: 07:55 시작 → 08:00 주간조가 TRF 를 받아 할당하고 지게차로 팔레트 랙 → 피킹 선반 보충 → 13:00 석간 Wave 배포 → FC 가 PDA 로 다음 작업을 받아 선반에서 피킹 → 분배·라인이 MFC 칸에 박스로 담기 → 자키가 출고대기(91)로 → 검품 → 21:30 부터 R/T 를 승강기로 지하에 → 22:00 R/T 카운팅 → 22:30 지하 상차 → 노선별 출차(이때만 CDC −q · Transit +q).</p>
        <p>위 오른쪽 배속(1×~120×)으로 시간을 빠르게, ❚❚ 로 멈춥니다. 왼쪽 ☺ 작업자에서 사람을 누르면 PDA 화면이 나옵니다.</p>
      </div>
    </Sec>
  );
}
