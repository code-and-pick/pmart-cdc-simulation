// 머리줄·3D 위 보기 칩 — MFC 시뮬레이터 ui/TopBar.tsx 와 같은 모양. 구역 버튼 대신 층 버튼(5F·6F·7F)을 먼저 둔다(설계 §9).
import { useApp, useTick, useView } from '../app/context';
import { CDC_FACTS, SPEEDS } from '../config';
import type { FloorKey, LabelMode, RightView } from '../render/controller';

const WALLS: { o: number; text: string }[] = [
  { o: 0.32, text: '벽' },
  { o: 0, text: '벽 숨김' },
];
const LABEL_MODES: { mode: LabelMode; text: string }[] = [
  { mode: 'all', text: '번호' },
  { mode: 'rack', text: '랙만' },
  { mode: 'off', text: '끔' },
];
const VIEW_KO: Record<RightView, string> = { logs: '현장 흐름', trf: 'TRF', transport: '운송', admin: '관리', api: 'API', events: '이벤트', inventory: '재고', moves: '재고 변동', barcode: '바코드' };
const FLOORS: { key: FloorKey; text: string }[] = [
  { key: 5, text: '5F 냉장·냉동' },
  { key: 6, text: '6F 상온' },
  { key: 7, text: '7F 생활용품' },
];

const clockOf = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

export function TopBar() {
  const { settings, restart, sim, ticker } = useApp();
  const view = useView();
  useTick();
  const busy = sim.agents.filter((a) => !a.idle).length;
  const mock = settings.mode === 'mock';
  return (
    <header className="topbar">
      <div className="brand">
        <span className="title">{CDC_FACTS.short} 가상 현장</span>
        {view.rightView && <span className="sub">{VIEW_KO[view.rightView]}</span>}
        <span className="chip" title={CDC_FACTS.address}>
          {CDC_FACTS.name}
        </span>
        <span className="mode-sw" title={mock ? '가상(MOCK) — 시뮬레이터가 흉내 낸 값' : '실서버(LAN 백엔드)'}>
          <button className={mock ? 'on mock' : ''} onClick={() => mock || restart({ ...settings, mode: 'mock' })}>
            MOCK
          </button>
          <button className={!mock ? 'on http' : ''} onClick={() => mock && restart({ ...settings, mode: 'http' })}>
            실서버
          </button>
        </span>
        <span className="stat" title="일하는 사람 / 전체 (주간조 지게차 + 석간 FC·분배·라인·자키)">
          작업자 <b>{busy}</b>/{sim.agents.length}
        </span>
      </div>
      <div className="spacer" />
      <div className="clock" title="시뮬레이션 시각">
        <span className={`live ${sim.speed === 0 ? 'paused' : ''}`} />
        {sim.clockText()}
      </div>
      {/* 시각 건너뛰기 — 오전(보충만)·석간 피킹을 빨리 넘긴다(사용자 2026-11-26) */}
      {sim.skipping !== null ? (
        <div className="seg skip">
          <button className="on" onClick={() => sim.cancelSkip()} title="멈추면 지금 시각에서 이어 갑니다">
            {clockOf(sim.skipping)} 로 건너뛰는 중 · 멈추기
          </button>
        </div>
      ) : (
        <div className="seg skip">
          {[13, 22].map((h) => (
            <button key={h} onClick={() => void sim.skipTo(h).then(() => ticker.bump())} title={h === 13 ? '석간 피킹 시작(13:00)으로' : '배차·하강·상차(22:00)로'}>
              {h}:00 ▶
            </button>
          ))}
        </div>
      )}
      {/* 좁은 창(약 1,000px 아래)에서는 배속 버튼 대신 고르기 상자(사용자 2026-11-25 "836px 에서 30×~120× 가 화면 밖") */}
      <select
        className="speed-select"
        aria-label="배속"
        value={sim.speed}
        onChange={(e) => {
          sim.speed = Number(e.target.value);
          ticker.bump();
        }}
      >
        {SPEEDS.map((sp) => (
          <option key={sp} value={sp}>
            {sp === 0 ? '멈춤' : `${sp}×`}
          </option>
        ))}
      </select>
      <div className="seg speeds">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            className={sim.speed === sp ? 'on' : undefined}
            onClick={() => {
              sim.speed = sp;
              ticker.bump();
            }}
          >
            {sp === 0 ? '❚❚' : `${sp}×`}
          </button>
        ))}
      </div>
    </header>
  );
}

/** 3D 위 떠 있는 보기 조작 — 왼쪽: 층·구역, 오른쪽: 번호판 */
export function ViewBar() {
  const view = useView();
  return (
    <div className="viewbar">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', pointerEvents: 'none' }}>
        <div className="seg float" aria-label="층">
          {FLOORS.map((f) => (
            <button key={f.key} className={view.floor === f.key ? 'on' : undefined} onClick={() => view.setFloor(f.key)}>
              {f.text}
            </button>
          ))}
        </div>
        {(
          // 구역 고르기 — 칩 줄이 길어 오른쪽 패널에 가려서 고르기 상자로(사용자 2026-11-25). 보관·피킹 선반·설비로 묶음
          <label className="seg float zone-pick" id="zones">
            <span>구역</span>
            <select value={view.focusedZone} onChange={(e) => view.focusZone(e.target.value)} aria-label="구역">
              {(() => {
                const vs = view.zoneViews();
                const all = vs.filter((v) => v.key === 'ALL');
                const store = vs.filter((v) => /^\d-[A-Z]$/.test(v.key));
                const shelf = vs.filter((v) => v.key.includes('SHELF'));
                const equip = vs.filter((v) => !all.includes(v) && !store.includes(v) && !shelf.includes(v));
                return (
                  <>
                    {all.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label}
                      </option>
                    ))}
                    {(
                      [
                        ['보관 (팔레트 랙)', store],
                        ['피킹 선반', shelf],
                        ['설비', equip],
                      ] as const
                    ).map(([g, list]) =>
                      list.length ? (
                        <optgroup key={g} label={g}>
                          {list.map((v) => (
                            <option key={v.key} value={v.key}>
                              {v.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null,
                    )}
                  </>
                );
              })()}
            </select>
          </label>
        )}
      </div>
      <div className="seg float" title="랙 번호판은 늘, 칸 번호는 가까이 확대했을 때 보입니다">
        {LABEL_MODES.map((l) => (
          <button key={l.mode} className={view.labelMode === l.mode ? 'on' : undefined} onClick={() => view.setLabelMode(l.mode)}>
            {l.text}
          </button>
        ))}
        <span className="seg-sep" />
        {WALLS.map((w) => (
          <button key={w.o} className={(view.wallUser ?? 0.32) === w.o ? 'on' : undefined} onClick={() => view.setWallOpacity(w.o)}>
            {w.text}
          </button>
        ))}
      </div>
    </div>
  );
}
