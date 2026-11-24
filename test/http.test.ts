// 실서버 어댑터 — 가짜 fetch 로 계약 경로·헤더·같은 키 재전송·결과 불명·페이지·연결 점검 분류를 본다(실서버 없이).
import { describe, expect, it } from 'vitest';
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { HttpTms } from '../src/backend/http/HttpTms';
import { HttpClient } from '../src/backend/http/client';
import { checkReadiness } from '../src/backend/http/readiness';
import { ApiProblem, ResultUnknown } from '../src/domain/contract';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fakeFetch(responder: (s: Seen, n: number) => Response | Promise<Response> | 'NETWORK') {
  const seen: Seen[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const s: Seen = { url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    seen.push({ ...s, headers: { ...s.headers } });
    const r = await responder(s, seen.length);
    if (r === 'NETWORK') throw new TypeError('fetch failed');
    return r;
  }) as unknown as typeof fetch;
  return { f, seen };
}

const json = (status: number, body: unknown, problem = false) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': problem ? 'application/problem+json' : 'application/json' } });
const opt = (f: typeof fetch) => ({ baseUrl: '/api/v1', token: () => 'tok-1', sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 1000, retries: 2, fetchImpl: f });

describe('cdc-outbound 실호출 어댑터 (계약 0.3.0 경로·헤더)', () => {
  it('명령은 Idempotency-Key·X-Source-System·Bearer 토큰·X-Expected-Version 을 붙여 계약 경로로 보낸다', async () => {
    const { f, seen } = fakeFetch(() => json(201, { waveId: 'WAV-1', state: 'PLANNED' }));
    const be = new HttpBackend(opt(f));
    const w = await be.createWave({ cdcId: 'CDC01', trfIds: ['TRF-1'] }, 'k-wave');
    expect(w.waveId).toBe('WAV-1');
    expect(seen[0]).toMatchObject({ url: '/api/v1/waves', method: 'POST', body: { cdcId: 'CDC01', trfIds: ['TRF-1'] } });
    expect(seen[0].headers).toMatchObject({ 'Idempotency-Key': 'k-wave', 'X-Source-System': 'pmart-cdc-simulation', Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' });
    await be.releaseWave('WAV-1', 'k-rel', 3);
    expect(seen[1]).toMatchObject({ url: '/api/v1/waves/WAV-1/releases', method: 'POST' });
    expect(seen[1].headers['X-Expected-Version']).toBe('3');
  });

  it('다음 작업 받기 200(들고 있던 것)·201(새 배정), 착수는 본문 없이 담당 토큰으로', async () => {
    let n = 0;
    const { f, seen } = fakeFetch(() => json(++n === 1 ? 201 : 200, { taskId: 'PICK-1', state: n === 1 ? 'ACCEPTED' : 'IN_PROGRESS' }));
    const be = new HttpBackend(opt(f));
    expect((await be.pullNextTask('CDC01', 'fc-5-01', { kind: 'PICK', floor: '5' }, 'k1')).status).toBe(201);
    expect(seen[0].url).toBe('/api/v1/cdcs/CDC01/workers/fc-5-01/next-tasks');
    await be.startTask('PICK-1', 'fc-5-01', 'k2', 1);
    expect(seen[1]).toMatchObject({ url: '/api/v1/cdcs/CDC01/tasks/PICK-1/starts', method: 'POST', body: undefined });
  });

  it('128자를 넘는 키는 같은 입력이면 같은 키로 줄인다', async () => {
    const { f, seen } = fakeFetch(() => json(202, { status: 'APPLIED', requestId: 'x' }));
    const be = new HttpBackend(opt(f));
    const long = 'k'.repeat(300);
    await be.reportSortingResult({ waveId: 'W', trfId: 'T', workerId: 'w', lpns: [{ lpn: 'L', unitType: 'BOX', state: 'SEALED', contents: [{ sku: 'E-00000001', lot: 'L1', qty: 1 }] }] }, long);
    await be.reportSortingResult({ waveId: 'W', trfId: 'T', workerId: 'w', lpns: [{ lpn: 'L', unitType: 'BOX', state: 'SEALED', contents: [{ sku: 'E-00000001', lot: 'L1', qty: 1 }] }] }, long);
    expect(seen[0].headers['Idempotency-Key'].length).toBeLessThanOrEqual(128);
    expect(seen[1].headers['Idempotency-Key']).toBe(seen[0].headers['Idempotency-Key']);
  });

  it('업무 거절(409)은 ApiProblem 그대로 — 다시 보내지 않는다', async () => {
    const { f, seen } = fakeFetch(() => json(409, { type: 'about:blank', title: 'x', status: 409, code: 'PICK_EXCEEDS_ALLOCATION', traceId: 't' }, true));
    const be = new HttpBackend(opt(f));
    const e = await be.reportPickResult('PICK-1', { workerId: 'w', lines: [{ sku: 'E-00000001', lot: 'L', locationCode: 'C', pickedQty: 9 }] }, 'k').catch((x) => x);
    expect(e).toBeInstanceOf(ApiProblem);
    expect((e as ApiProblem).problem.code).toBe('PICK_EXCEEDS_ALLOCATION');
    expect(seen).toHaveLength(1);
  });

  it('응답 불명(503·연결 끊김)은 같은 키로 다시 보내고, 끝까지 모르면 ResultUnknown(실패로 단정하지 않음)', async () => {
    const a = fakeFetch((_, n) => (n === 1 ? json(503, { code: 'DEPENDENCY_UNAVAILABLE', status: 503 }, true) : json(202, { status: 'APPLIED', requestId: 'r' })));
    const r = await new HttpBackend(opt(a.f)).reportLoadingResult({ trfId: 'T', tripId: 'TR', vehicleId: 'V', workerId: 'w', action: 'LOADED', lpns: [{ lpn: 'L' }] }, 'k-load');
    expect(r.status).toBe('APPLIED');
    expect(a.seen.map((s) => s.headers['Idempotency-Key'])).toEqual(['k-load', 'k-load']);
    const b = fakeFetch(() => 'NETWORK');
    const e = await new HttpBackend(opt(b.f)).reportInspectionResult({ trfId: 'T', inspectorId: 'q', items: [{ lpn: 'L', result: 'PASSED' }] }, 'k-insp').catch((x) => x);
    expect(e).toBeInstanceOf(ResultUnknown);
    expect(b.seen).toHaveLength(3);
    expect(new Set(b.seen.map((s) => s.headers['Idempotency-Key']))).toEqual(new Set(['k-insp']));
  });

  it('작업 목록은 nextCursor 를 끝까지 따라간다', async () => {
    const { f, seen } = fakeFetch((s) => (s.url.includes('cursor=c2') ? json(200, { items: [{ taskId: 'B' }], page: { nextCursor: null } }) : json(200, { items: [{ taskId: 'A' }], page: { nextCursor: 'c2' } })));
    const tasks = await new HttpBackend(opt(f)).listTasks('WAV-1', { state: 'CREATED' });
    expect(tasks.map((t) => t.taskId)).toEqual(['A', 'B']);
    expect(seen[0].url).toBe('/api/v1/cdcs/CDC01/tasks?waveId=WAV-1&state=CREATED');
  });
});

describe('TMS 실호출 어댑터 (transport-execution 0.1.0)', () => {
  it('출발·도착·인계·정차 출발·물리 종료를 계약 경로로', async () => {
    const { f, seen } = fakeFetch(() => json(201, {}));
    const t = new HttpTms(opt(f));
    await t.recordDeparture('TRIP-1', { departedAt: 'x', source: 'SIMULATED', vehicleId: 'VH-01', driverId: 'DR-01', evidenceRef: 'e', trfCompositions: [{ trfId: 'T', lines: [{ sku: 'E-00000001', qty: 1 }] }] }, 'k1');
    await t.recordStopArrival('TRIP-1', 'S1', { occurredAt: 'x' }, 'k2');
    await t.recordHandover('TRIP-1', 'S1', { trfId: 'T', handedAt: 'x', handedBy: 'd', receivedBy: 'm', lines: [{ sku: 'E-00000001', qty: 1 }], evidenceRef: 'e' }, 'k3');
    await t.recordStopDeparture('TRIP-1', 'S1', { occurredAt: 'x' }, 'k4');
    await t.recordPhysicalEnd('TRIP-1', { endedAt: 'x', returnCenterId: 'CDC01' }, 'k5');
    expect(seen.map((s) => s.url)).toEqual([
      '/api/v1/trips/TRIP-1/departures',
      '/api/v1/trips/TRIP-1/stops/S1/arrivals',
      '/api/v1/trips/TRIP-1/stops/S1/handovers',
      '/api/v1/trips/TRIP-1/stops/S1/departures',
      '/api/v1/trips/TRIP-1/physical-ends',
    ]);
  });
});

describe('실서버 연결 점검', () => {
  it('401 토큰 없음 · 게이트웨이 404 경로 없음 · 서비스 404 는 경로 있음 · 501 미구현 · 연결 안 됨을 가른다', async () => {
    const { f } = fakeFetch((s) => {
      if (s.url.includes('/locations/')) return json(404, { code: 'NOT_FOUND', status: 404 }, true);
      if (s.url.includes('sku-handlings')) return json(401, { code: 'UNAUTHENTICATED', status: 401 }, true);
      if (s.url.includes('/waves/')) return new Response('', { status: 404 });
      if (s.url.includes('/vehicles')) return json(501, { code: 'NOT_IMPLEMENTED', status: 501 }, true);
      return 'NETWORK';
    });
    const rows = await checkReadiness(new HttpClient({ ...opt(f), retries: 0 }));
    expect(Object.fromEntries(rows.map((r) => [r.service, r.state]))).toEqual({
      'cdc-location': 'READY',
      'cdc-inventory': 'NO_TOKEN',
      'cdc-outbound': 'NOT_ROUTED',
      fleet: 'NOT_IMPLEMENTED',
      'transport-execution': 'UNREACHABLE',
    });
  });
});
