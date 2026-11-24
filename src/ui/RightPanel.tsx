// 오른쪽 패널 — 지표(kpis) · 재고 · 현장 흐름. MFC 시뮬레이터 RightPanel 의 kpi 모양을 쓴다. 재고는 MOCK 원장(cdc-inventory 역할).
import { useApp, useView } from '../app/context';

export function RightPanel() {
  const { layout, backend, catalog } = useApp();
  const view = useView();
  if (!view.rightView) return null;
  const locs = layout.floors.flatMap((f) => f.locations);
  const shelves = layout.floors.flatMap((f) => f.shelves).length;
  const t = backend.ledger.totals();
  const stock = backend.ledger.onHandByLocation();
  const violations = backend.ledger.check();
  const kpis: [string, string][] = [
    ['팔레트 칸(보관)', locs.length.toLocaleString()],
    ['피킹 선반 칸', shelves.toLocaleString()],
    ['오토스토어 빈', layout.autostore.bins.toLocaleString()],
    ['총 용량(유닛)', layout.totalCapacity.toLocaleString()],
    ['CDC 현물', t.onHand.toLocaleString()],
    ['예약', t.reserved.toLocaleString()],
    ['Transit', t.transit.toLocaleString()],
    ['상품(SKU)', catalog.skus.length.toLocaleString()],
    ['지하 접안', `${layout.docks.length}자리`],
  ];
  return (
    <div className="panel right">
      <div className="kpis">
        {kpis.map(([k, v]) => (
          <div className="kpi" key={k}>
            <div className="v">{v}</div>
            <div className="k">{k}</div>
          </div>
        ))}
      </div>
      {view.rightView === 'inventory' ? (
        <table className="inv">
          <thead>
            <tr>
              <th>층</th>
              <th>구역</th>
              <th>칸</th>
              <th>용량</th>
              <th>현물</th>
            </tr>
          </thead>
          <tbody>
            {layout.floors.flatMap((f) =>
              f.spec.zones.map((z) => {
                const ls = [...f.locations, ...f.shelves].filter((l) => l.zone === z.letter);
                return (
                  <tr key={`${f.floor}${z.letter}`}>
                    <td>{f.floor}F</td>
                    <td>{z.label}</td>
                    <td>{ls.length.toLocaleString()}</td>
                    <td>{ls.reduce((s, l) => s + l.capacity, 0).toLocaleString()}</td>
                    <td>{ls.reduce((s, l) => s + (stock.get(l.code) ?? 0), 0).toLocaleString()}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      ) : (
        <div className="note">
          {violations.length ? `원장 불변식 위반 ${violations.length}건: ${violations[0]}` : '원장 불변식 정상 (0 ≤ 예약 ≤ 현물, 시작 = 현물 + 출발, Transit = 출발 − 수령).'} 이관(TRF)·Wave·피킹·분배·라인·상차 흐름은 작업자 엔진을 붙이면 여기에 나옵니다(설계 §12 ⑤~⑦).
        </div>
      )}
    </div>
  );
}
