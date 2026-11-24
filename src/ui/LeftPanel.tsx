// 왼쪽 패널 — 설정(센터 고정값·시간표) · 구역(층·칸 정보) · 도움말. MFC 시뮬레이터 LeftPanel 의 sec/srow 모양을 쓴다.
import type { ReactNode } from 'react';
import { useApp, useView } from '../app/context';
import { CDC_FACTS, MFCS, SHIFT } from '../config';

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
    <div className="srow">
      <span className="srow-l">{k}</span>
      <b className="srow-v">{v}</b>
    </div>
  );
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function LeftPanel() {
  const view = useView();
  if (!view.leftView) return null;
  return <div className="panel left">{view.leftView === 'zone' ? <ZoneInfo /> : view.leftView === 'help' ? <Help /> : <Settings />}</div>;
}

function Settings() {
  return (
    <>
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
        <Row k="차량 출발" v={hm(SHIFT.departure)} />
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

function Help() {
  return (
    <Sec title="도움말">
      <div className="help">
        <p>위 칩으로 층(5F·6F·7F·B1)과 구역을 고릅니다. 랙 칸을 누르면 위치 코드가 나옵니다.</p>
        <p>위치 코드: 센터-구역-층-통로-베이-단-슬롯 (예 CDC01-C-5-02-24-3-1). 구역 글자 A 냉동 · B 냉장 · C~H 상온.</p>
        <p>91 = 출고대기 롤테이너 자리, 92 = 승강기 반출 문, 90 = 지하 차량 접안.</p>
        <p>작업자·주문(이관)·차량은 다음 단계에서 붙습니다.</p>
      </div>
    </Sec>
  );
}
