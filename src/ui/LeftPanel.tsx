// 왼쪽 패널 — 설정(센터 고정값·시간표) · 구역(층·칸 정보) · 도움말. MFC 시뮬레이터 LeftPanel 의 sec/srow 모양을 쓴다.
import { useEffect, useState, type ReactNode } from 'react';
import { checkReadiness, READINESS_KO, type ProbeResult } from '../backend/http/readiness';
import { useApp, useTick, useView } from '../app/context';
import { CDC_FACTS, MFCS, OUTBOUND, SHIFT, WORK, WORKFORCE } from '../config';
import { ROLE_KO, type Role } from '../sim/agent';

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

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function LeftPanel() {
  const view = useView();
  if (!view.leftView) return null;
  return <div className="panel left">{view.leftView === 'zone' ? <ZoneInfo /> : view.leftView === 'workers' ? <Workers /> : view.leftView === 'help' ? <Help /> : <Settings />}</div>;
}

function Settings() {
  const { real } = useApp();
  return (
    <>
      {real && <RealCheck />}
      <Sec title="센터" aside="고정값">
        <Row k="이름" v={CDC_FACTS.name} />
        <Row k="주소" v={CDC_FACTS.address} />
        <Row k="면적" v={`${CDC_FACTS.areaPyeong.toLocaleString()}평`} />
        <Row k="사용 층" v={`${CDC_FACTS.floors[0]}~${CDC_FACTS.floors[CDC_FACTS.floors.length - 1]}층 (차량은 지하 B1)`} />
        <Row k="보관 용량" v={`${(CDC_FACTS.capacityUnits / 10_000).toLocaleString()}만 유닛`} />
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

function ZoneInfo() {
  const { layout, backend, catalog } = useApp();
  const view = useView();
  const loc = view.selected;
  if (view.floor === 'B1') {
    return (
      <Sec title="B1 지하 차량 접안" aside={`${layout.docks.length}자리`}>
        {layout.docks.map((d) => (
          <Row key={d.code} k={d.short} v={d.code} />
        ))}
      </Sec>
    );
  }
  const f = view.floorLayout()!;
  const stock = loc ? backend.ledger.cellsAt(loc.code) : [];
  return (
    <>
      {loc && (
        <Sec title="고른 칸" aside={loc.type === 'PICK_FACE' ? '피킹 선반' : '팔레트 보관'}>
          <Row k="위치 코드" v={loc.code} />
          <Row k="번호판" v={loc.short} />
          <Row k="통로·베이·단·슬롯" v={`${loc.aisle} · ${loc.bay} · ${loc.level} · ${loc.slot}`} />
          <Row k="용량" v={`${loc.capacity.toLocaleString()} 유닛`} />
          {stock.length === 0 && <Row k="재고" v="비어 있음" />}
          {stock.map((c) => (
            <div key={c.lot}>
              <Row k="상품" v={`${catalog.bySku.get(c.sku)?.name ?? ''} (${c.sku})`} />
              <Row k="LOT · 기한" v={`${c.lot} · ${c.expiresAt}`} />
              <Row k="현물 · 예약" v={`${c.onHand.toLocaleString()} · ${c.reserved.toLocaleString()} 유닛`} />
            </div>
          ))}
        </Sec>
      )}
      <Sec title={f.label} aside={`문서 ${(Object.values(f.spec.docPyeong.storage).reduce((a, b) => a + b, 0) + f.spec.docPyeong.dt).toLocaleString()}평`}>
        {f.spec.zones.map((z) => (
          <Row key={z.letter} k={z.label} v={`통로 ${z.aisles} · ${z.levels}단`} />
        ))}
        <Row k="팔레트 칸" v={f.locations.length.toLocaleString()} />
        <Row k="선반 칸" v={`${f.shelves.length.toLocaleString()} (통로 ${f.shelfAisles.map((a) => a.plate).join('·')})`} />
        <Row k="출고대기(91)" v={`${f.staging.length}자리`} />
        <Row k="승강기 문(92)" v={`${f.lifts.length}대`} />
        {f.equipment.map((e) => (
          <Row key={e.label} k="설비" v={e.label} />
        ))}
        <Row k="배치 면적" v={`보관 ${Math.round(f.layoutPyeong.storage).toLocaleString()} · 그 밖 ${Math.round(f.layoutPyeong.band).toLocaleString()}평`} />
      </Sec>
    </>
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
    void checkReadiness(real.backend.client)
      .then(setRows)
      .finally(() => setBusy(false));
  };
  useEffect(run, [real]);
  if (!real) return null;
  return (
    <Sec title="실서버 연결 점검" aside={busy ? '점검 중…' : <button onClick={run}>다시</button>}>
      <div className="help">
        <p>실서버 모드에서는 시뮬레이션 엔진을 돌리지 않습니다 — 백엔드에 cdc-outbound·TMS 서비스가 아직 없고(2026-11-25), CDC 시험 계정도 없습니다(R-16). 아래는 조회만 해 보는 연결 점검입니다.</p>
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
