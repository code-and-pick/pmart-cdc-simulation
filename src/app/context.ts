import { createContext, useContext, useSyncExternalStore } from 'react';
import type { MockBackend } from '../backend/mock/MockBackend';
import type { Catalog } from '../domain/catalog';
import type { Layout } from '../domain/layout';
import type { Simulation } from '../sim/simulation';
import type { HttpBackend } from '../backend/http/HttpBackend';
import type { HttpTms } from '../backend/http/HttpTms';
import type { TokenSource } from '../backend/http/tokens';
import type { Ticker, ViewController } from '../render/controller';

export interface PersistedSettings {
  mode: 'mock' | 'http';
  http: { baseUrl: string };
}

/** 앱 문맥 — MFC 시뮬레이터 app/context.ts 와 같은 틀 */
export interface AppCtx {
  layout: Layout;
  /** 가짜 상품 마스터·시작 재고 [시뮬] */
  catalog: Catalog;
  /** MOCK 백엔드(cdc-outbound + 원장). 실서버 모드는 설계 §12 ⑧ */
  backend: MockBackend;
  /** 하루 시뮬레이션(시계·작업자) — 설계 §12 ⑤ */
  sim: Simulation;
  /** 실서버 모드일 때만 — 계약 실호출 어댑터(설계 §12 ⑧). 엔진은 아직 MOCK 만 돈다 */
  real?: { backend: HttpBackend; tms: HttpTms; tokens: TokenSource };
  controller: ViewController;
  ticker: Ticker;
  settings: PersistedSettings;
  restart: (s: PersistedSettings) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext 밖에서 useApp 을 불렀다');
  return ctx;
}

export function useView(): ViewController {
  const { controller } = useApp();
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller;
}

export function useTick(): number {
  const { ticker } = useApp();
  return useSyncExternalStore(ticker.subscribe, ticker.getVersion);
}
