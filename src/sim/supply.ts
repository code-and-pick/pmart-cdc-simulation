// MFC 보충 요청(승인 TRF) 만들기 — MOCK 에서 시뮬레이터가 replenishment(SCM 승인) 역할을 한다.
// 실서버에서는 TransferApproved 이벤트를 cdc-outbound 가 소비한다. 1요청·1이관·1출발: MFC 마다 하루 TRF 하나.

import { CENTER_ID, MFCS, SUPPLY } from '../config';
import type { Catalog } from '../domain/catalog';
import type { TransferIntakeInput } from '../domain/contract';
import { Rng } from '../util/rng';

function nextDayIso(baseDate: string, minute: number): string {
  return new Date(Date.parse(`${baseDate}T00:00:00+09:00`) + (24 * 60 + minute) * 60_000).toISOString();
}

export function makeTransfers(catalog: Catalog, baseDate: string, seed: number, linesPerMfc: number = SUPPLY.linesPerMfc): TransferIntakeInput[] {
  const rng = new Rng(seed);
  const day = baseDate.replace(/-/g, '').slice(2);
  return MFCS.map((m) => {
    const picked = new Set<number>();
    while (picked.size < Math.min(linesPerMfc, catalog.skus.length)) picked.add(rng.int(0, catalog.skus.length - 1));
    return {
      trfId: `TRF-${day}-${m.id.replace(/^MFC-/, '').replace(/-01$/, '')}`,
      trfVersion: 1,
      cdcId: CENTER_ID,
      mfcId: m.id,
      approvalRef: `APR-${day}-${m.staging}`,
      deadlineMeaning: 'ARRIVAL',
      dueAt: nextDayIso(baseDate, SUPPLY.dueNextDayMin),
      lines: [...picked].sort((a, b) => a - b).map((i) => ({ sku: catalog.skus[i].sku, approvedQty: rng.int(SUPPLY.qty[0], SUPPLY.qty[1]) })),
    } satisfies TransferIntakeInput;
  });
}
