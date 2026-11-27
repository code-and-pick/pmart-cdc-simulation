// 실서버(LAN) TRF 이어 하기 — 화면의 [가상 작업자(자동)로]와 같은 실행. npx vite-node scripts/lan-resume.ts <trfId>
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { HttpInternal } from '../src/backend/http/HttpInternal';
import { runLanOne } from '../src/backend/http/lanRun';
import { TokenSource } from '../src/backend/http/tokens';
const trfId = process.argv[2];
if (!trfId) throw new Error('trfId 필요');
const O = process.env.SIM_ORIGIN ?? 'http://localhost:5182';
const tokens = new TokenSource('claude-cdc-sup', 90, (u, i) => fetch(O + String(u), i));
const base = { sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 15000, retries: 2 };
const internal = new HttpInternal({ ...base, outboundBase: O + '/svc/cdc-outbound', inventoryBase: O + '/svc/cdc-inventory' });
const backend = new HttpBackend({ ...base, baseUrl: O + '/api/v1', token: () => tokens.get() }, internal);
await tokens.get();
const t = await internal.getTransferIntake(trfId);
const steps = await runLanOne({ gateway: backend.client, backend, internal, operatorId: () => tokens.operatorId }, { mfcId: t.mfcId, skus: 1, qty: 1, pda: false, resumeTrfId: trfId }, () => {});
for (const [i, s] of steps.entries()) console.log(`${i + 1}. [${s.state}] ${s.name} — ${s.detail}`);
