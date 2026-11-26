// 실서버(LAN) TRF 출발 전 취소(피킹 시작 전만) — npx vite-node scripts/lan-cancel-trf.ts <trfId>
// 사용자 2026-11-26 "취소로 정리해"(배차 HELD 로 남은 시험 TRF). LAN 에 쓴다.
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { HttpInternal } from '../src/backend/http/HttpInternal';
import { TokenSource } from '../src/backend/http/tokens';
import { ApiProblem } from '../src/domain/contract';

const trfId = process.argv[2];
if (!trfId) throw new Error('trfId 필요');
const O = process.env.SIM_ORIGIN ?? 'http://localhost:5182';
const tokens = new TokenSource('claude-cdc-sup', 90, (u, i) => fetch(O + String(u), i));
const base = { sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 15000, retries: 2 };
const internal = new HttpInternal({ ...base, outboundBase: O + '/svc/cdc-outbound', inventoryBase: O + '/svc/cdc-inventory' });
const backend = new HttpBackend({ ...base, baseUrl: O + '/api/v1', token: () => tokens.get() }, internal);
const before = await internal.getTransferIntake(trfId);
console.log('전:', before.state, '· 할당', before.progress.reduce((a, p) => a + p.allocatedQty, 0), '· 피킹', before.progress.reduce((a, p) => a + p.pickedQty, 0), '· 버전', before.version);
try {
  const r = await backend.cancelBeforeDeparture(trfId, { reason: 'TRANSPORT_UNAVAILABLE', scope: 'FULL', sourceRef: 'sim-lan-test-cleanup' }, `sim-cancel-${trfId}`, before.version);
  console.log('취소 요청:', JSON.stringify(r));
} catch (e) {
  console.log('취소 막힘:', e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code} ${e.problem.detail ?? ''}` : String(e));
}
const after = await internal.getTransferIntake(trfId);
console.log('뒤:', after.state, '· 할당', after.progress.reduce((a, p) => a + p.allocatedQty, 0));
