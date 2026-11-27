// 실서버(LAN) 끝까지 점검 — MFC 입고 발주(공급 요청) → 승인 → 서버가 DC TRF 인수(R-27, mfc-inbound 0.23.0) → DC 피킹·분류·검품·상차·출발(자동) → MFC 도착.
// 하차·인계·입고 검수는 MFC 시뮬레이터(실서버 모드)가 도착(ARRIVED)을 보고 한다 — 여기서는 대신하지 않고 상태만 지켜봄.
// npx vite-node scripts/lan-e2e-supply.ts [mfcId] [skus] — LAN 에 쓴다(사용자 2026-11-27 "연동 다시 제대로 확인해").
import { MFC_SUP_ACCOUNTS } from '../src/backend/http/accounts';
import { HttpClient } from '../src/backend/http/client';
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { HttpInternal } from '../src/backend/http/HttpInternal';
import { runLanOne } from '../src/backend/http/lanRun';
import { TokenSource } from '../src/backend/http/tokens';
import { ApiProblem } from '../src/domain/contract';

const mfcId = process.argv[2] ?? 'MFC-BJG-01';
const nSku = Number(process.argv[3] ?? 2);
const O = process.env.SIM_ORIGIN ?? 'http://localhost:5182';
const f = (u: RequestInfo | URL, i?: RequestInit) => fetch(O + String(u), i);
const base = { sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 15000, retries: 2 };
const cdcTok = new TokenSource('claude-cdc-sup', 90, f);
const mfcTok = new TokenSource(MFC_SUP_ACCOUNTS[mfcId], 90, f);
const internal = new HttpInternal({ ...base, outboundBase: O + '/svc/cdc-outbound', inventoryBase: O + '/svc/cdc-inventory' });
const backend = new HttpBackend({ ...base, baseUrl: O + '/api/v1', token: () => cdcTok.get() }, internal);
const mfc = new HttpClient({ ...base, baseUrl: O + '/api/v1', token: () => mfcTok.get() });
const why = (e: unknown) => (e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code} ${e.problem.detail ?? ''}` : e instanceof Error ? e.message : String(e));
const log = (s: string) => console.log(`[${new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}] ${s}`);
const run = Date.now().toString(36).toUpperCase();
await cdcTok.get();

// 1) MFC 입고 발주 — DC 피킹면에 있는 상온 상품(실서버 한 건과 같은 고르기)
const snap = await internal.inventory.call<{ items: { sku: string; available: number; lots: { locations: { locationCode: string; onHand: number; reserved: number }[] }[] }[] }>('GET', '/internal/snapshots', { query: { cdcId: 'CDC01' } });
const face = (c: string) => {
  const [, z, , a, , lv] = c.split('-');
  const n = Number(a);
  return z !== 'G' && z !== 'H' && ((n >= 61 && n < 90) || lv === '1');
};
const skus = snap.body.items.filter((it) => it.available >= 2 && it.lots.some((l) => l.locations.some((x) => face(x.locationCode) && x.onHand - x.reserved >= 2))).slice(0, nSku).map((x) => x.sku);
const readyAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
let sr: { supplyRequestId: string; version: number; state: string };
try {
  sr = (await mfc.call<typeof sr>('POST', '/supply-requests', { body: { mfcId, requestedReadyAt: readyAt, urgency: 'NORMAL', reason: 'DC 연동 끝까지 점검(DC 시뮬)', lines: skus.map((sku) => ({ sku, qty: 2 })) }, idempotencyKey: `sim-e2e-sr-${run}` })).body;
  log(`1. MFC 입고 발주 ${sr.supplyRequestId} ${sr.state} · ${skus.join(', ')} × 2`);
} catch (e) {
  log(`1. MFC 입고 발주 막힘 — ${why(e)}`);
  process.exit(1);
}
// 2) MFC 센터 관리자 승인
try {
  const a = (await mfc.call<{ state: string; linkedTrfId?: string | null; linkedReceiptId?: string | null }>('POST', `/supply-requests/${sr.supplyRequestId}/approvals`, { body: {}, idempotencyKey: `sim-e2e-ap-${run}`, expectedVersion: sr.version })).body;
  log(`2. 승인 ${a.state} · linkedTrfId ${a.linkedTrfId ?? '-'} · linkedReceiptId ${a.linkedReceiptId ?? '-'}`);
} catch (e) {
  log(`2. 승인 막힘 — ${why(e)}`);
  process.exit(1);
}
// 3) DC 로 — 승인하면 서버(R-27)가 TRF-{요청 ID} 로 인수, 공급 요청 linkedTrfId 에 채움
let trfId = '';
for (let i = 0; i < 10 && !trfId; i++) {
  const g = (await mfc.call<{ linkedTrfId?: string | null }>('GET', `/supply-requests/${sr.supplyRequestId}`)).body;
  if (g.linkedTrfId) {
    try {
      const it = await internal.getTransferIntake(g.linkedTrfId);
      trfId = g.linkedTrfId;
      log(`3. 서버가 인수함 ${trfId} ${it.state} · ${it.deadlineMeaning} ${it.dueAt}`);
    } catch {
      /* 아직 */
    }
  }
  if (!trfId) await new Promise((r) => setTimeout(r, 2000));
}
if (!trfId) {
  log('3. 20초 안에 DC TRF 가 안 생김(R-27)');
  process.exit(1);
}
// 4) DC 작업 — 새 TRF 알림의 [가상 작업자(자동)로] 와 같은 실행(할당 → Wave → 피킹 → 분류 → 검품 → 배차·상차 → 출발)
const steps = await runLanOne({ gateway: backend.client, backend, internal, operatorId: () => cdcTok.operatorId }, { mfcId, skus: nSku, qty: 2, pda: false, resumeTrfId: trfId }, () => {});
for (const [i, s] of steps.entries()) log(`4.${i + 1} [${s.state}] ${s.name} — ${s.detail}`);
if (steps.some((s) => s.state === 'fail')) process.exit(1);
// 5) MFC 도착 보내기
type Trip = { tripId: string; state: string; stops: { seq: number; mfcId: string; state: string; trfIds?: string[] }[] };
const trips = (await backend.client.call<{ items?: Trip[] }>('GET', '/cdcs/CDC01/trips', { query: { size: '100' } })).body.items ?? [];
const trip = trips.find((t) => t.stops.some((s) => (s.trfIds ?? []).includes(trfId)));
const stop = trip?.stops.find((s) => (s.trfIds ?? []).includes(trfId));
if (!trip || !stop) {
  log('5. 운행 못 찾음');
  process.exit(1);
}
try {
  const r = await backend.client.call<Trip>('POST', `/trips/${trip.tripId}/stops/${stop.seq}/arrivals`, { body: {}, idempotencyKey: `sim-lan-arrive-${trip.tripId}-${stop.seq}` });
  log(`5. MFC 도착 보냄 ${trip.tripId} 정차 ${stop.seq} → ${r.body.stops.find((s) => s.seq === stop.seq)?.state}`);
} catch (e) {
  log(`5. 도착 막힘 — ${why(e)}`);
}
console.log(JSON.stringify({ supplyRequestId: sr.supplyRequestId, trfId, tripId: trip.tripId, stopSeq: stop.seq }));
