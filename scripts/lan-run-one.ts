// 실서버(LAN) 한 건 돌리기 — 화면 설정 탭 "한 건 돌리기"와 같은 코드(src/backend/http/lanRun.ts)를 이 PC 개발 서버 프록시로 돌린다.
// npx vite-node scripts/lan-run-one.ts [mfcId] — LAN 에 쓴다(사용자 승인 뒤에만).
import { HttpBackend } from '../src/backend/http/HttpBackend';
import { HttpInternal } from '../src/backend/http/HttpInternal';
import { runLanOne } from '../src/backend/http/lanRun';
import { TokenSource } from '../src/backend/http/tokens';
const O = process.env.SIM_ORIGIN ?? 'http://localhost:5182';
const tokens = new TokenSource('claude-cdc-sup', 90, (u, i) => fetch(O + String(u), i));
const base = { sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 15000, retries: 2 };
const internal = new HttpInternal({ ...base, outboundBase: O + '/svc/cdc-outbound', inventoryBase: O + '/svc/cdc-inventory' });
const backend = new HttpBackend({ ...base, baseUrl: O + '/api/v1', token: () => tokens.get() }, internal);
await tokens.get();
const steps = await runLanOne({ gateway: backend.client, backend, internal, operatorId: () => tokens.operatorId }, { mfcId: process.argv[2] ?? 'MFC-BJG-01', skus: 3, qty: 2 }, () => {});
for (const [i, s] of steps.entries()) console.log(`${i + 1}. [${s.state}] ${s.name} — ${s.detail}`);
