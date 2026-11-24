// MFC 보충 요청(승인 TRF) 만들기 — MOCK 에서 시뮬레이터가 replenishment(SCM 승인) 역할을 한다.
// 실서버에서는 TransferApproved 이벤트를 cdc-outbound 가 소비한다.
// 이관요청서는 (DC, MFC, 출고일, 온도대) 단위로 1건 — 요청서 1건 = 차량 1대, 나누지 않는다 [정본 TMS 2.2 D-10].
// 그래서 MFC 마다 하루 TRF 를 온도대별로 만든다(1요청·1이관·1출발).

import { CENTER_ID, MFCS, SUPPLY } from '../config';
import type { Catalog } from '../domain/catalog';
import type { TemperatureZone, TransferIntakeInput } from '../domain/contract';
import { Rng } from '../util/rng';

function nextDayIso(baseDate: string, minute: number): string {
  return new Date(Date.parse(`${baseDate}T00:00:00+09:00`) + (24 * 60 + minute) * 60_000).toISOString();
}

export const TEMP_SUFFIX: Record<TemperatureZone, string> = { AMBIENT: 'AMB', CHILLED: 'CHL', FROZEN: 'FRZ' };
const TEMPS: TemperatureZone[] = ['AMBIENT', 'CHILLED', 'FROZEN'];

export const mfcShort = (mfcId: string) => mfcId.replace(/^MFC-/, '').replace(/-01$/, '');

/** MFC 마다 품목 linesPerMfc 개를 고르고 온도대별 TRF 로 나눈다(빈 온도대는 만들지 않음) */
export function makeTransfers(catalog: Catalog, baseDate: string, seed: number, linesPerMfc: number = SUPPLY.linesPerMfc): TransferIntakeInput[] {
  const rng = new Rng(seed);
  const day = baseDate.replace(/-/g, '').slice(2);
  return MFCS.flatMap((m) => {
    const picked = new Set<number>();
    while (picked.size < Math.min(linesPerMfc, catalog.skus.length)) picked.add(rng.int(0, catalog.skus.length - 1));
    const lines = [...picked].sort((a, b) => a - b).map((i) => ({ sku: catalog.skus[i].sku, temp: catalog.skus[i].temp, approvedQty: rng.int(SUPPLY.qty[0], SUPPLY.qty[1]) }));
    return TEMPS.map((temp) => ({ temp, ls: lines.filter((l) => l.temp === temp) }))
      .filter((g) => g.ls.length > 0)
      .map(
        (g) =>
          ({
            trfId: `TRF-${day}-${mfcShort(m.id)}-${TEMP_SUFFIX[g.temp]}`,
            trfVersion: 1,
            cdcId: CENTER_ID,
            mfcId: m.id,
            approvalRef: `APR-${day}-${m.staging}-${TEMP_SUFFIX[g.temp]}`,
            deadlineMeaning: 'ARRIVAL',
            dueAt: nextDayIso(baseDate, SUPPLY.dueNextDayMin),
            conditions: [{ kind: 'TEMPERATURE_ZONE', value: g.temp }],
            lines: g.ls.map((l) => ({ sku: l.sku, approvedQty: l.approvedQty })),
          }) satisfies TransferIntakeInput,
      );
  });
}

/** TRF 의 온도대 (conditions 또는 이름 끝) */
export function trfTemp(t: { trfId: string; conditions?: { kind?: string; value?: string }[] }): TemperatureZone {
  const c = t.conditions?.find((x) => x.kind === 'TEMPERATURE_ZONE')?.value as TemperatureZone | undefined;
  if (c) return c;
  return t.trfId.endsWith('-FRZ') ? 'FROZEN' : t.trfId.endsWith('-CHL') ? 'CHILLED' : 'AMBIENT';
}
