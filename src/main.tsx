import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { AppCtx, PersistedSettings } from './app/context';
import { MockBackend } from './backend/mock/MockBackend';
import { buildCatalog } from './domain/catalog';
import { buildLayout } from './domain/layout';
import { Ticker, ViewController } from './render/controller';
import './ui/styles.css';
import './ui/console.css';

const KEY = 'pmart-cdc-sim-settings';

function load(): PersistedSettings {
  const fallback: PersistedSettings = { mode: 'mock', http: { baseUrl: '/api/v1' } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<PersistedSettings>;
    return { mode: s.mode === 'http' ? 'http' : 'mock', http: { baseUrl: s.http?.baseUrl || fallback.http.baseUrl } };
  } catch {
    return fallback;
  }
}

function save(s: PersistedSettings) {
  try {
    // 토큰은 저장하지 않는다(CLAUDE.md — sessionStorage 만)
    localStorage.setItem(KEY, JSON.stringify({ mode: s.mode, http: { baseUrl: s.http.baseUrl } }));
  } catch {
    /* 저장소를 못 쓰면 기본값 */
  }
}

// 화면 상태는 React 바깥에서 한 번만 만든다
const layout = buildLayout();
const settings = load();
/** 시뮬레이션 첫날 = 오늘(서울) */
const baseDate = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const catalog = buildCatalog(layout, baseDate);
// 시계는 엔진(설계 §12 ⑤)이 붙기 전까지 석간 시작 13:00 에 둔다
const backend = new MockBackend({ now: () => 13 * 3600, baseDate, catalog });
const app: AppCtx = {
  layout,
  catalog,
  backend,
  controller: new ViewController(layout),
  ticker: new Ticker(),
  settings,
  restart: (next) => {
    save(next);
    location.reload();
  },
};
app.controller.focusZone('ALL');

createRoot(document.getElementById('root')!).render(<App app={app} />);

Object.assign(window as unknown as Record<string, unknown>, { layout, catalog, backend, view: app.controller });
