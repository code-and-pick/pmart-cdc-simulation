// 왼쪽 아이콘 메뉴 — MFC 시뮬레이터 ui/Rail.tsx 와 같은 모양
import { useView } from '../app/context';
import type { LeftView, RightView } from '../render/controller';

const RIGHT: [RightView, string, string][] = [
  ['trf', '📋', 'TRF'],
  ['admin', '⚑', '관리'],
  ['logs', '☰', '현장'],
  ['transport', '⛟', '운송'],
  ['api', '⧉', 'API'],
  ['events', '⇄', '이벤트'],
  ['inventory', '▦', '재고'],
  ['moves', '⇵', '변동'],
  ['barcode', '▥', '바코드'],
];
const LEFT: [LeftView, string, string][] = [
  ['settings', '⚙', '설정'],
  ['zone', '▣', '구역'],
  ['workers', '☺', '작업자'],
  ['help', '?', '도움말'],
  // 개발용 성능 탭 — npm run dev 에서만(MFC 와 같음)
  ...(import.meta.env.DEV ? [['perf', '◔', '성능'] as [LeftView, string, string]] : []),
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
