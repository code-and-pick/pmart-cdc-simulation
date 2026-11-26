// R-27 배포 확인 — MFC 공급 요청 넣고 승인하면 서버가 DC TRF 를 인수하는지(다리 없이). LAN 에 쓴다.
// npx vite-node scripts/lan-check-r27.ts [mfcId] [sku]
import { MFC_SUP_ACCOUNTS } from '../src/backend/http/accounts';
import { HttpClient } from '../src/backend/http/client';
import { HttpInternal } from '../src/backend/http/HttpInternal';
import { TokenSource } from '../src/backend/http/tokens';
import { ApiProblem } from '../src/domain/contract';

const mfcId = process.argv[2] ?? 'MFC-BJG-01';
const sku = process.argv[3] ?? 'B-00000021';
const O = process.env.SIM_ORIGIN ?? 'http://localhost:5182';
const f = (u: RequestInfo | URL, i?: RequestInit) => fetch(O + String(u), i);
const base = { sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 15000, retries: 2 };
const tok = new TokenSource(MFC_SUP_ACCOUNTS[mfcId], 90, f);
const mfc = new HttpClient({ ...base, baseUrl: O + '/api/v1', token: () => tok.get() });
const internal = new HttpInternal({ ...base, outboundBase: O + '/svc/cdc-outbound', inventoryBase: O + '/svc/cdc-inventory' });
const why = (e: unknown) => (e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code} ${e.problem.detail ?? ''}` : String(e));
const run = Date.now().toString(36).toUpperCase();
type SR = { supplyRequestId: string; version: number; state: string; linkedTrfId?: string | null; linkedReceiptId?: string | null; [k: string]: unknown };
const sr = (await mfc.call<SR>('POST', '/supply-requests', { body: { mfcId, requestedReadyAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), urgency: 'NORMAL', reason: 'R-27 배포 확인(DC 시뮬)', lines: [{ sku, qty: 2 }] }, idempotencyKey: `sim-r27-sr-${run}` })).body;
console.log('발주', sr.supplyRequestId, sr.state);
try {
  const a = (await mfc.call<SR>('POST', `/supply-requests/${sr.supplyRequestId}/approvals`, { body: {}, idempotencyKey: `sim-r27-ap-${run}`, expectedVersion: sr.version })).body;
  console.log('승인', a.state, 'linkedTrfId', a.linkedTrfId, 'linkedReceiptId', a.linkedReceiptId, 'transferCdcId', a.transferCdcId);
} catch (e) {
  console.log('승인 막힘', why(e));
}
for (let i = 0; i < 10; i++) {
  const g = (await mfc.call<SR>('GET', `/supply-requests/${sr.supplyRequestId}`)).body;
  const id = g.linkedTrfId ?? `TRF-${sr.supplyRequestId}`;
  try {
    const it = await internal.getTransferIntake(id);
    console.log('DC 인수 확인', id, it.state, it.deadlineMeaning, it.dueAt, JSON.stringify(it.conditions), it.lines.map((l) => `${l.sku}×${l.approvedQty}`).join(','));
    process.exit(0);
  } catch (e) {
    console.log(i, '아직', id, why(e).slice(0, 60), 'linkedTrfId', g.linkedTrfId);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
