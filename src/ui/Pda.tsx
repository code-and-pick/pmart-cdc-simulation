// 고른 작업자의 PDA — MFC 시뮬레이터 .pda 카드와 같은 모양. FC 는 지역 바코드·선반 위치·상품·수량과 이번 카트 줄을 보여 준다 [현장 알바몬 FC].
import { useApp, useTick, useView } from '../app/context';
import { WORK } from '../config';
import { ROLE_KO } from '../sim/agent';

const MARK = { TODO: '·', NOW: '▶', DONE: '✓', SHORT: '!' } as const;

export function Pda() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const a = sim.agents.find((x) => x.id === view.selectedWorker);
  if (!a) return null;
  const p = a.pda;
  return (
    <div className="pda show">
      <div className="hd">
        <b>{a.name}</b>
        <button className="x" onClick={() => view.selectWorker(null)} aria-label="닫기">
          ×
        </button>
      </div>
      <dl>
        <dt>일</dt>
        <dd>{ROLE_KO[a.role]} · {a.shift === 'DAY' ? '주간조' : '석간'}</dd>
        <dt>지금</dt>
        <dd>{a.activity}</dd>
        {p && (
          <>
            <dt>PDA</dt>
            <dd className="loc">{p.step}</dd>
            {p.rows.map(([k, v]) => (
              <FragmentRow key={k} k={k} v={v} />
            ))}
          </>
        )}
        <dt>걸음</dt>
        <dd>{Math.round(a.distance / WORK.stepLen).toLocaleString()}보 · 끝낸 일 {a.done}</dd>
      </dl>
      {p?.basket && (
        <div className="act" style={{ maxHeight: 180, overflow: 'auto', fontSize: 12 }}>
          {p.basket.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, opacity: b.state === 'DONE' ? 0.55 : 1, color: b.state === 'SHORT' ? '#eb5757' : undefined }}>
              <span style={{ width: 12 }}>{MARK[b.state]}</span>
              <span style={{ width: 96, fontVariantNumeric: 'tabular-nums' }}>{b.loc}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <span>
                {b.picked}/{b.planned}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
