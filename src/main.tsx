import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { AppCtx, PersistedSettings } from './app/context';
import { MockBackend } from './backend/mock/MockBackend';
import { buildCatalog } from './domain/catalog';
import { buildLayout } from './domain/layout';
import { Simulation } from './sim/simulation';
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
// 시계는 시뮬레이션이 가진다(07:55 시작)
let sim: Simulation | null = null;
const backend = new MockBackend({ now: () => sim?.time ?? 0, baseDate, catalog });
sim = new Simulation(layout, catalog, backend, { baseDate });
const app: AppCtx = {
  layout,
  catalog,
  backend,
  sim,
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

Object.assign(window as unknown as Record<string, unknown>, { layout, catalog, backend, sim, view: app.controller });
