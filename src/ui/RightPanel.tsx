// 오른쪽 패널 — 지표(kpis) · 재고 · 현장 흐름. MFC 시뮬레이터 RightPanel 의 kpi 모양을 쓴다. 엔진이 붙기 전이라 배치 지표만.
import { useApp, useView } from '../app/context';

export function RightPanel() {
  const { layout } = useApp();
  const view = useView();
  if (!view.rightView) return null;
  const locs = layout.floors.flatMap((f) => f.locations);
  const pick = locs.filter((l) => l.type === 'PICK_FACE').length;
  const kpis: [string, string][] = [
    ['팔레트 칸', locs.length.toLocaleString()],
    ['피킹면(1단)', pick.toLocaleString()],
    ['리저브', (locs.length - pick).toLocaleString()],
    ['오토스토어 빈', layout.autostore.bins.toLocaleString()],
    ['총 용량(유닛)', layout.totalCapacity.toLocaleString()],
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
            </tr>
          </thead>
          <tbody>
            {layout.floors.flatMap((f) =>
              f.spec.zones.map((z) => {
                const ls = f.locations.filter((l) => l.zone === z.letter);
                return (
                  <tr key={`${f.floor}${z.letter}`}>
                    <td>{f.floor}F</td>
                    <td>{z.label}</td>
                    <td>{ls.length.toLocaleString()}</td>
                    <td>{ls.reduce((s, l) => s + l.capacity, 0).toLocaleString()}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      ) : (
        <div className="note">이관(TRF)·Wave·피킹·분배·라인·상차 흐름은 시뮬레이션 엔진을 붙이면 여기에 나옵니다(설계 §12 ④~⑦).</div>
      )}
    </div>
  );
}
