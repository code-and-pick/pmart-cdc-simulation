// TRF 의 MFC 쪽 — 입고 예정(도착·수령)·입고 작업(품질검사·적치)·재고 이력(SKU 수량 변화)을 그 MFC 센터 관리자 계정으로 읽는다
// (사용자 2026-11-27 "trf 탭에 mfc 작업 현황도 나오게 해줘. mfc 에서 상품 받고 적치하면 재고 변동 실시간으로").
// 읽기만 한다. 계정은 accounts.MFC_SUP_ACCOUNTS — 이 PC 에 비밀번호 파일이 있는 지점만 읽힘(지금 1호점).
import { MFC_SUP_ACCOUNTS } from '../backend/http/accounts';
import { HttpClient } from '../backend/http/client';
import { TokenSource } from '../backend/http/tokens';
import { ApiProblem } from '../domain/contract';

export interface MfcPromise {
  state?: string;
  arrivedAt?: string | null;
  departedAt?: string | null;
  lines: { sku: string; productName?: string | null; expectedQty: number; receivedQty: number; quarantinedQty: number; pendingQty?: number }[];
  receipts?: { receiptId: string; receivedAt?: string | null; postedAt?: string | null; inventoryApplyStatus?: string | null; discrepancies?: unknown[] }[];
  closure?: { closedAt?: string | null; reason?: string | null; cdcNotifiedAt?: string | null } | null;
}
export interface MfcTask {
  taskId: string;
  taskType: 'INSPECT' | 'PUTAWAY' | 'QUARANTINE_MOVE' | string;
  state: string;
  sku: string;
  productName?: string | null;
  plannedQty: number;
  doneQty: number;
  locationCode?: string | null;
  assigneeId?: string | null;
}
export interface MfcLedgerItem {
  occurredAt: string;
  cause: string;
  sourceRef?: string | null;
  delta: { E: number; H: number; Q: number; R: number };
  after: { onHandQty: number; sellableQty: number; quarantinedQty: number };
  entries: { locationCode: string; workState: string; delta: number }[];
  sku: string;
}
export interface MfcSide {
  mfcId: string;
  readable: boolean;
  promise: MfcPromise | null;
  tasks: MfcTask[];
  ledger: MfcLedgerItem[];
  /** SKU → 지금 MFC 재고 */
  stock: Record<string, { onHandQty: number; sellableQty: number }>;
}

const clients = new Map<string, HttpClient>();
function mfcClient(mfcId: string): HttpClient | null {
  const acc = MFC_SUP_ACCOUNTS[mfcId];
  if (!acc) return null;
  if (!clients.has(mfcId)) {
    const tk = new TokenSource(acc, 90);
    clients.set(mfcId, new HttpClient({ baseUrl: '/api/v1', token: () => tk.get(), sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 8000, retries: 1 }));
  }
  return clients.get(mfcId)!;
}

export async function readMfcSide(trfId: string, mfcId: string, skus: string[]): Promise<MfcSide> {
  const c = mfcClient(mfcId);
  const empty: MfcSide = { mfcId, readable: false, promise: null, tasks: [], ledger: [], stock: {} };
  if (!c) return empty;
  let promise: MfcPromise | null = null;
  try {
    promise = (await c.call<MfcPromise>('GET', `/inbound-promises/${encodeURIComponent(trfId)}`)).body;
  } catch (e) {
    if (!(e instanceof ApiProblem && e.problem.status === 404)) return empty; // 403 등 — 못 읽는 지점
  }
  const receiptIds = (promise?.receipts ?? []).map((r) => r.receiptId);
  const tasks = (
    await Promise.all(
      receiptIds.map((rid) =>
        c
          .call<{ items?: MfcTask[] }>('GET', '/inbound-tasks', { query: { mfcId, receiptId: rid } })
          .then((r) => r.body.items ?? [])
          .catch(() => [] as MfcTask[]),
      ),
    )
  ).flat();
  // 이 TRF 의 수령·작업으로 생긴 재고 변화만(sourceRef = 수령 ID 또는 작업 ID)
  const refs = new Set([...receiptIds, ...tasks.map((t) => t.taskId)]);
  const stock: MfcSide['stock'] = {};
  const ledger = (
    await Promise.all(
      skus.map((sku) =>
        c
          .call<{ current?: { onHandQty: number; sellableQty: number }; items?: Omit<MfcLedgerItem, 'sku'>[] }>('GET', `/mfcs/${encodeURIComponent(mfcId)}/stock-ledger`, { query: { sku, size: '30' } })
          .then((r) => {
            if (r.body.current) stock[sku] = { onHandQty: r.body.current.onHandQty, sellableQty: r.body.current.sellableQty };
            return (r.body.items ?? []).filter((x) => x.sourceRef && refs.has(x.sourceRef)).map((x) => ({ ...x, sku }));
          })
          .catch(() => [] as MfcLedgerItem[]),
      ),
    )
  ).flat();
  return { mfcId, readable: true, promise, tasks, ledger, stock };
}

/** MFC 단계: 0 입고 예정 · 1 도착 · 2 수령(재고 +) · 3 품질검사 · 4 적치(판매 가능) · 5 입고 끝 */
export function mfcStage(m: MfcSide | null): number {
  const p = m?.promise;
  if (!p) return -1;
  const ins = m.tasks.filter((t) => t.taskType === 'INSPECT');
  const put = m.tasks.filter((t) => t.taskType === 'PUTAWAY');
  const done = (ts: MfcTask[]) => ts.length > 0 && ts.every((t) => t.state === 'COMPLETED');
  if (done(put) && p.closure?.closedAt) return 6;
  if (done(put)) return 5;
  if (done(ins)) return 4;
  if ((p.receipts ?? []).some((r) => r.postedAt)) return 3;
  if (p.arrivedAt) return 2;
  return 1;
}
