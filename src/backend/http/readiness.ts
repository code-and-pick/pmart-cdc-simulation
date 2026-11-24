// 실서버 연결 점검 — 시뮬레이터가 부를 서비스마다 조회(GET) 하나로 "게이트웨이가 넘기는지·인증·구현됐는지"를 본다.
// 조회만 하므로 서버 상태를 바꾸지 않는다. 결과는 화면 설정 탭에 표로 보여 준다(설계 §12 ⑧).

import { CENTER_ID } from '../../config';
import { ApiProblem, ResultUnknown } from '../../domain/contract';
import type { HttpClient } from './client';

export type Readiness = 'READY' | 'NO_TOKEN' | 'FORBIDDEN' | 'NOT_ROUTED' | 'NOT_IMPLEMENTED' | 'UNREACHABLE' | 'ERROR';

export const READINESS_KO: Record<Readiness, string> = {
  READY: '준비됨',
  NO_TOKEN: '토큰 없음(401)',
  FORBIDDEN: '권한 없음(403)',
  NOT_ROUTED: '게이트웨이 경로 없음',
  NOT_IMPLEMENTED: '미구현(501)',
  UNREACHABLE: '연결 안 됨',
  ERROR: '오류',
};

export interface Probe {
  service: string;
  /** gateway = 게이트웨이 + 직원 토큰 · outbound/inventory = LAN 서비스 직접(토큰 없음, CDC-9) */
  via: 'gateway' | 'outbound' | 'inventory';
  /** 무엇에 쓰는지 */
  use: string;
  path: string;
  query?: Record<string, string>;
}

/** 서비스 응답의 404(문제 코드 NOT_FOUND 등)는 "경로는 있다" — 게이트웨이 404 와 구별한다 */
export const PROBES: Probe[] = [
  { service: 'cdc-location', via: 'gateway', use: '칠곡 위치(랙·선반·출고대기·접안)', path: `/cdcs/${CENTER_ID}/locations/${CENTER_ID}-C-5-01-01-1-1` }, // cdc-location 0.3.0(PR #456) — /locations/** 는 mfc-location
  { service: 'cdc-inventory', via: 'gateway', use: 'SKU 취급', path: `/cdcs/${CENTER_ID}/sku-handlings` },
  { service: 'cdc-outbound', via: 'gateway', use: 'Wave·작업·실적·분류·검품·상차', path: '/waves/__probe__' },
  { service: 'cdc-outbound 내부', via: 'outbound', use: 'TRF 인수·출발 검증·매니페스트(LAN 직접 :8603)', path: '/internal/transfer-intakes/__probe__' },
  { service: 'cdc-inventory 내부', via: 'inventory', use: '가용·할당·Transit·보충 MOV(LAN 직접 :8601)', path: '/internal/availability', query: { cdcId: CENTER_ID, sku: 'E-10000037' } },
  { service: 'fleet', via: 'gateway', use: '차량·기사', path: '/vehicles' },
  { service: 'transport-execution', via: 'gateway', use: '운행·출발·도착·인계', path: '/trips/__probe__' },
];

export interface ProbeResult extends Probe {
  state: Readiness;
  detail: string;
}

export async function checkReadiness(clients: { gateway: HttpClient; outbound: HttpClient; inventory: HttpClient }, probes: Probe[] = PROBES): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const p of probes) {
    try {
      await clients[p.via].call('GET', p.path, { query: p.query });
      out.push({ ...p, state: 'READY', detail: '200' });
    } catch (e) {
      if (e instanceof ApiProblem) {
        const { status, code } = e.problem;
        const state: Readiness =
          status === 401 ? 'NO_TOKEN' : status === 403 ? 'FORBIDDEN' : status === 501 ? 'NOT_IMPLEMENTED' : status === 404 && (code === `HTTP_404` || code === 'ROUTE_NOT_FOUND') ? 'NOT_ROUTED' : status === 404 ? 'READY' : status === 502 || status === 503 ? 'NOT_ROUTED' : 'ERROR';
        out.push({ ...p, state, detail: `${status} ${code}` });
      } else if (e instanceof ResultUnknown) out.push({ ...p, state: 'UNREACHABLE', detail: e.message });
      else out.push({ ...p, state: 'ERROR', detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
