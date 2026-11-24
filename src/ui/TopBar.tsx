// 머리줄·3D 위 보기 칩 — MFC 시뮬레이터 ui/TopBar.tsx 와 같은 모양. 구역 버튼 대신 층 버튼(5F·6F·7F·B1)을 먼저 둔다(설계 §9).
import { useApp, useView } from '../app/context';
import { CDC_FACTS } from '../config';
import type { FloorKey, LabelMode, RightView } from '../render/controller';

const LABEL_MODES: { mode: LabelMode; text: string }[] = [
  { mode: 'all', text: '번호' },
  { mode: 'rack', text: '랙만' },
  { mode: 'off', text: '끔' },
];
const VIEW_KO: Record<RightView, string> = { summary: '지표', inventory: '재고', logs: '현장 흐름' };
const FLOORS: { key: FloorKey; text: string }[] = [
  { key: 5, text: '5F 상온·냉동' },
  { key: 6, text: '6F 냉장' },
  { key: 7, text: '7F 생활용품' },
  { key: 'B1', text: 'B1 접안' },
];

export function TopBar() {
  const { settings, restart } = useApp();
  const view = useView();
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
          <button className={mock ? 'on mock' : ''} onClick={() => !mock || restart({ ...settings, mode: 'mock' })}>
            MOCK
          </button>
          <button className={!mock ? 'on http' : ''} onClick={() => mock && restart({ ...settings, mode: 'http' })}>
            실서버
          </button>
        </span>
      </div>
      <div className="spacer" />
      <div className="clock" title="시뮬레이션 시각 — 엔진은 다음 단계">
        <span className="live paused" />
        13:00
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
        {view.floor !== 'B1' && (
          <div className="seg float" id="zones" aria-label="구역">
            {view.zoneViews().map((v) => (
              <button key={v.key} className={view.focusedZone === v.key ? 'on' : undefined} onClick={() => view.focusZone(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="seg float" title="랙 번호판은 늘, 칸 번호는 가까이 확대했을 때 보입니다">
        {LABEL_MODES.map((l) => (
          <button key={l.mode} className={view.labelMode === l.mode ? 'on' : undefined} onClick={() => view.setLabelMode(l.mode)}>
            {l.text}
          </button>
        ))}
      </div>
    </div>
  );
}
