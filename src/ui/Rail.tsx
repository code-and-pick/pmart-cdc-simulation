// 왼쪽 아이콘 메뉴 — MFC 시뮬레이터 ui/Rail.tsx 와 같은 모양
import { useView } from '../app/context';
import type { LeftView, RightView } from '../render/controller';

const RIGHT: [RightView, string, string][] = [
  ['summary', '▤', '지표'],
  ['logs', '☰', '현장'],
  ['inventory', '▦', '재고'],
];
const LEFT: [LeftView, string, string][] = [
  ['settings', '⚙', '설정'],
  ['zone', '▣', '구역'],
  ['help', '?', '도움말'],
];

export function Rail() {
  const view = useView();
  return (
    <nav className="rail" aria-label="화면">
      <span className="rail-logo" aria-hidden>
        P
      </span>
      {RIGHT.map(([v, icon, label]) => (
        <button key={v} className={view.rightView === v ? 'on' : ''} aria-pressed={view.rightView === v} onClick={() => view.toggleRight(v)} title={`${label} (다시 누르면 접기)`}>
          <span className="rail-i" aria-hidden>
            {icon}
          </span>
          <span className="rail-l">{label}</span>
        </button>
      ))}
      <span className="rail-sep" />
      {LEFT.map(([v, icon, label]) => (
        <button key={v} className={view.leftView === v ? 'on' : ''} aria-pressed={view.leftView === v} onClick={() => view.toggleLeft(v)} title={`${label} (다시 누르면 접기)`}>
          <span className="rail-i" aria-hidden>
            {icon}
          </span>
          <span className="rail-l">{label}</span>
        </button>
      ))}
      <button className="rail-theme" onClick={() => view.setTheme(view.theme === 'dark' ? 'light' : 'dark')} title={view.theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}>
        <span className="rail-i" aria-hidden>
          {view.theme === 'dark' ? '☀' : '☾'}
        </span>
        <span className="rail-l">{view.theme === 'dark' ? '밝게' : '어둡게'}</span>
      </button>
    </nav>
  );
}
