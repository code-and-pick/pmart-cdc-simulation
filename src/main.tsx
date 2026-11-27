import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { AppCtx, PersistedSettings } from './app/context';
import { MockBackend } from './backend/mock/MockBackend';
import { buildCatalog } from './domain/catalog';
import { buildLayout } from './domain/layout';
import { Simulation } from './sim/simulation';
import { HttpBackend } from './backend/http/HttpBackend';
import { HttpTms } from './backend/http/HttpTms';
import { HttpInternal } from './backend/http/HttpInternal';
import { TokenSource } from './backend/http/tokens';
import { CDC_OPERATOR_ACCOUNT } from './backend/http/accounts';
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
  real: settings.mode === 'http' ? makeReal() : undefined,
  restart: (next) => {
    save(next);
    location.reload();
  },
};
app.controller.focusZone('ALL');
// 실서버 모드: 백엔드에 cdc-outbound·TMS 가 아직 없어(2026-11-25) 엔진을 돌리지 않는다 — 설정 탭의 연결 점검만
// 실서버 모드에서도 가상 현장(3D 작업자·요약)을 그대로 돌린다 — 엔진은 늘 MockBackend 라 LAN 에 쓰지 않음(사용자 2026-11-27 "실서버 버전에서도 localhost 에서 뜨는 거 다 뜨게")
if (app.real) {
  app.controller.leftView = 'settings';
}

function makeReal() {
  const tokens = new TokenSource(CDC_OPERATOR_ACCOUNT, 90);
  const opt = { baseUrl: settings.http.baseUrl, token: () => tokens.get(), sourceSystem: 'pmart-cdc-simulation', now: () => sim?.time ?? 0, timeoutMs: 8000, retries: 2 };
  const internal = new HttpInternal({ sourceSystem: opt.sourceSystem, now: opt.now, timeoutMs: opt.timeoutMs, retries: opt.retries });
  return { backend: new HttpBackend(opt, internal), tms: new HttpTms(opt), internal, tokens };
}

createRoot(document.getElementById('root')!).render(<App app={app} />);

Object.assign(window as unknown as Record<string, unknown>, { layout, catalog, backend, sim, view: app.controller });
