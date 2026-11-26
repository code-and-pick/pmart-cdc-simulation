// 실서버(LAN) 운행 한 걸음 — npx vite-node scripts/lan-trip-step.ts <tripId> <arrive|stop-depart|end> [stopSeq]
// 사용자 2026-11-26 "도착 보내줘"(DC 트럭 기사 앱이 없어 도착은 운영자가 보냄 — transport-execution arriveAtStop, OPERATOR). LAN 에 쓴다.
import { HttpClient } from '../src/backend/http/client';
import { TokenSource } from '../src/backend/http/tokens';
import { ApiProblem } from '../src/domain/contract';

const [tripId, what, seq = '1'] = process.argv.slice(2);
if (!tripId || !what) throw new Error('tripId · arrive|stop-depart|end 필요');
const O = process.env.SIM_ORIGIN ?? 'http://localhost:5182';
const tokens = new TokenSource('claude-cdc-sup', 90, (u, i) => fetch(O + String(u), i));
const c = new HttpClient({ sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 15000, retries: 2, baseUrl: O + '/api/v1', token: () => tokens.get() });
const path = what === 'arrive' ? `/trips/${tripId}/stops/${seq}/arrivals` : what === 'stop-depart' ? `/trips/${tripId}/stops/${seq}/departures` : `/trips/${tripId}/physical-ends`;
type Trip = { state?: string; stops?: { seq: number; mfcId: string; state: string }[] };
const show = (t: Trip) => `${t.state} · ${(t.stops ?? []).map((s) => `${s.seq} ${s.mfcId} ${s.state}`).join(' / ')}`;
console.log('전:', show((await c.call<Trip>('GET', `/trips/${tripId}`)).body));
try {
  const r = await c.call<Trip>('POST', path, { body: {}, idempotencyKey: `sim-lan-${what}-${tripId}-${seq}` });
  console.log('보냄:', r.status, show(r.body));
} catch (e) {
  console.log('막힘:', e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code} ${e.problem.detail ?? ''}` : String(e));
}
