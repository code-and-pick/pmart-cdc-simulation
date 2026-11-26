// MFC 공급 요청(입고 신청) → DC TRF 인수 — 임시 다리. 백엔드 R-27(공급 요청 승인 → cdc-outbound 인수)이 생기기 전까지만 켠다
// (사용자 2026-11-26 "mfc 시뮬레이션에서 입고신청하기 누르면 dc 시뮬레이션이랑 연동돼서 … 새 trf 들어왔다고", mfc 시뮬 세션 전달 — 선택 "DC 시뮬레이터 임시 다리").
// 규칙(시뮬레이터가 정한 값 — docs/backend-requests.md):
//  · APPROVED 요청만, 승인 0 줄은 뺌. trfId = TRF-SR-{supplyRequestId}, Idempotency-Key = sim-bridge-{supplyRequestId} → 다시 읽어도 한 번만.
//  · 온도대 = 줄 SKU 의 CDC 재고 위치 구역(G 냉장 · H 냉동 · 그 밖 상온), 줄마다 다르면 첫 줄 기준(MFC 가 온도대마다 한 건으로 보냄).
//  · 출고일 = 희망 사용준비 시각(없으면 오늘)에서 30시간 앞 날부터, 그 MFC·온도대 운송지시서가 닫히지 않은 첫 날. dueAt = 출고일 다음 날 06:00 KST(실서버 한 건과 같음).
import { CENTER_ID } from '../../config';
import { ApiProblem } from '../../domain/contract';
import type { HttpClient } from './client';
import type { HttpInternal } from './HttpInternal';

export interface SupplyRequest {
  supplyRequestId: string;
  mfcId: string;
  state: string;
  requestedReadyAt?: string | null;
  approvedLines?: { sku: string; requestedQty: number; approvedQty: number }[];
  lines?: { sku: string; qty: number }[];
}
export interface BridgeResult {
  supplyRequestId: string;
  mfcId: string;
  trfId: string;
  state: 'CREATED' | 'EXISTS' | 'SKIPPED' | 'FAILED';
  detail: string;
}

export const trfIdForSupply = (supplyRequestId: string) => `TRF-SR-${supplyRequestId}`.slice(0, 64);
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const tempOfLoc = (code: string) => {
  const z = code.split('-')[1];
  return z === 'G' ? 'CHILLED' : z === 'H' ? 'FROZEN' : 'AMBIENT';
};

/** 한 바퀴 — 읽을 수 있는 MFC 마다 APPROVED 요청을 보고 TRF 가 없는 것만 인수 */
export async function bridgeOnce(deps: { mfcGateway: HttpClient; gateway: HttpClient; internal: HttpInternal }, mfcIds: string[]): Promise<BridgeResult[]> {
  const out: BridgeResult[] = [];
  let snap: Map<string, string> | null = null;
  const tempOf = async (sku: string) => {
    if (!snap) {
      snap = new Map();
      const r = await deps.internal.inventory.call<{ items?: { sku: string; lots: { locations: { locationCode: string }[] }[] }[] }>('GET', '/internal/snapshots', { query: { cdcId: CENTER_ID } });
      for (const it of r.body.items ?? []) {
        const loc = it.lots.flatMap((l) => l.locations)[0];
        if (loc) snap.set(it.sku, tempOfLoc(loc.locationCode));
      }
    }
    return snap.get(sku) ?? 'AMBIENT';
  };
  for (const mfcId of mfcIds) {
    let reqs: SupplyRequest[];
    try {
      const r = await deps.mfcGateway.call<{ items?: SupplyRequest[] }>('GET', '/supply-requests', { query: { mfcId, state: 'APPROVED' } });
      reqs = r.body.items ?? [];
    } catch {
      continue; // 이 계정으로 못 읽는 MFC(403) — 건너뜀
    }
    for (const q of reqs) {
      const trfId = trfIdForSupply(q.supplyRequestId);
      const lines = (q.approvedLines ?? []).filter((l) => l.approvedQty > 0).map((l) => ({ sku: l.sku, approvedQty: l.approvedQty }));
      const base = { supplyRequestId: q.supplyRequestId, mfcId, trfId };
      if (!lines.length) {
        out.push({ ...base, state: 'SKIPPED', detail: '승인 수량 0' });
        continue;
      }
      try {
        await deps.internal.getTransferIntake(trfId);
        out.push({ ...base, state: 'EXISTS', detail: '이미 인수됨' });
        continue;
      } catch (e) {
        if (!(e instanceof ApiProblem && e.problem.status === 404)) {
          out.push({ ...base, state: 'FAILED', detail: e instanceof Error ? e.message : String(e) });
          continue;
        }
      }
      try {
        const temp = await tempOf(lines[0].sku);
        // 출고일 — 희망 시각 30시간 앞 날(오늘보다 앞이면 오늘)부터 닫히지 않은 첫 날
        const today = new Date(`${kst(new Date())}T00:00:00+09:00`);
        const want = q.requestedReadyAt ? new Date(`${kst(new Date(new Date(q.requestedReadyAt).getTime() - 30 * 3600_000))}T00:00:00+09:00`) : today;
        const start = want.getTime() < today.getTime() ? today : want;
        let shipDate = '';
        for (let d = 0; d < 14 && !shipDate; d++) {
          const day = kst(new Date(start.getTime() + d * 86_400_000));
          type Ord = { tempClass?: string; state: string; stops?: { mfcId?: string }[] };
          const r = await deps.gateway.call<{ items?: Ord[] } | Ord[]>('GET', `/cdcs/${CENTER_ID}/transport-orders`, { query: { shipDate: day } });
          const list = Array.isArray(r.body) ? r.body : (r.body.items ?? []);
          if (!list.some((o) => (o.tempClass ?? 'AMBIENT') === temp && o.state !== 'PLANNING' && o.state !== 'CANCELLED' && (o.stops ?? []).some((s) => s.mfcId === mfcId))) shipDate = day;
        }
        if (!shipDate) throw new Error('14일 안에 열린 출고일이 없음');
        const due = new Date(new Date(`${shipDate}T00:00:00+09:00`).getTime() + 30 * 3600_000);
        await deps.internal.intakeTransfer(
          { trfId, trfVersion: 1, cdcId: CENTER_ID, mfcId, approvalRef: q.supplyRequestId, deadlineMeaning: 'ARRIVAL', dueAt: due.toISOString(), conditions: [{ kind: 'TEMPERATURE_ZONE', value: temp }], lines },
          `sim-bridge-${q.supplyRequestId}`,
        );
        out.push({ ...base, state: 'CREATED', detail: `${temp} · ${lines.length}줄 · 출고일 ${shipDate}` });
      } catch (e) {
        out.push({ ...base, state: 'FAILED', detail: e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}` : e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return out;
}
