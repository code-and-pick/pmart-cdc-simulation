import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Layout } from '../domain/layout';
import type { Ticker, ViewController } from '../render/controller';

export interface PersistedSettings {
  mode: 'mock' | 'http';
  http: { baseUrl: string };
}

/** 앱 문맥 — MFC 시뮬레이터 app/context.ts 와 같은 틀. 시뮬레이션 엔진(sim)은 다음 단계에서 붙는다(설계 §12 ④~). */
export interface AppCtx {
  layout: Layout;
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
