// 머리줄·3D 위 보기 칩 — MFC 시뮬레이터 ui/TopBar.tsx 와 같은 모양. 구역 버튼 대신 층 버튼(5F·6F·7F)을 먼저 둔다(설계 §9).
import { useState } from 'react';
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
        <ZonePicker />
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

const ZONE_GROUPS: [string, string][] = [
  ['RACK', '보관 랙'],
  ['SHELF', '피킹 선반'],
  ['EQUIP', '설비'],
  ['BAND', '작업장'],
];
const zoneShort = (label: string) => label.replace(/\s*\((서쪽|동쪽)\)/, ' · $1').replace(/\s*\(.*\)$/, '');
const zoneSub = (label: string) => /\((.*)\)$/.exec(label)?.[1] ?? '';

/**
 * 구역 고르기 — 고르기 상자(브라우저 기본 목록이 발표 자료처럼 보임, 사용자 2026-11-26 "PPT 로 만든 것 같다") 대신 펼침 판:
 * 종류별(보관 랙·피킹 선반·설비·작업장) 카드, 짧은 이름 + 한 줄 설명 + 온도 점, 찾기.
 */
function ZonePicker() {
  const view = useView();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const f = view.floorLayout();
  const cur = view.zoneViews().find((v) => v.key === view.focusedZone);
  const views = view.zoneViews().filter((v) => v.key !== 'ALL');
  const k = q.trim();
  const pick = (key: string) => {
    view.focusZone(key);
    setOpen(false);
    setQ('');
  };
  return (
    <div className="zp" style={{ pointerEvents: 'auto' }}>
      <button className={`zp-btn${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-label="구역">
        <span>구역</span>
        <b>{cur ? (cur.key === 'ALL' ? '전체' : zoneShort(cur.label)) : '전체'}</b>
        <i>▾</i>
      </button>
      {open && (
        <div className="zp-panel" onMouseLeave={() => setOpen(false)}>
          <div className="zp-top">
            <input autoFocus placeholder="구역 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={view.focusedZone === 'ALL' ? 'on' : ''} onClick={() => pick('ALL')}>
              층 전체
            </button>
          </div>
          {ZONE_GROUPS.map(([kind, title]) => {
            const vs = views.filter((v) => (f?.zones.find((z) => z.id === v.key)?.kind ?? 'BAND') === kind && (!k || v.label.includes(k)));
            if (!vs.length) return null;
            return (
              <div key={kind} className="zp-group">
                <small>{title}</small>
                <div className="zp-grid">
                  {vs.map((v) => {
                    const z = f?.zones.find((x) => x.id === v.key);
                    return (
                      <button key={v.key} className={v.key === view.focusedZone ? 'on' : ''} onClick={() => pick(v.key)} title={v.label}>
                        <i className={`tdot ${(z?.temp ?? 'NONE').toLowerCase()}`} />
                        <span>
                          <b>{zoneShort(v.label)}</b>
                          {zoneSub(v.label) && <small>{zoneSub(v.label)}</small>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
