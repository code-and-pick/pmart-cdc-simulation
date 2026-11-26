// MFC 보충 요청(승인 TRF) 만들기 — MOCK 에서 시뮬레이터가 replenishment(SCM 승인) 역할을 한다.
// 실서버에서는 TransferApproved 이벤트를 cdc-outbound 가 소비한다.
// 이관요청서는 (DC, MFC, 출고일, 온도대) 단위로 1건 — 요청서 1건 = 차량 1대, 나누지 않는다 [정본 TMS 2.2 D-10].
// 그래서 MFC 마다 하루 TRF 를 온도대별로 만든다(1요청·1이관·1출발).

import { CENTER_ID, isEtc, MFCS, SUPPLY } from '../config';
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
    // 기타 센터는 MFC 한 곳의 etcLines/linesPerMfc 배(시험에서 linesPerMfc 를 줄이면 같이 줄어든다)
    const want = Math.min(isEtc(m.id) ? Math.round((linesPerMfc * SUPPLY.etcLines) / SUPPLY.linesPerMfc) : linesPerMfc, catalog.skus.length);
    // 잘 나가는 상품(모든 MFC 가 같이 요청) — 카탈로그 33번째마다(약 3%)
    const step = Math.max(1, Math.round(1 / SUPPLY.popularPool));
    const pool = catalog.skus.map((_, i) => i).filter((i) => i % step === 0);
    while (picked.size < Math.min(Math.round(want * SUPPLY.popularShare), pool.length)) picked.add(pool[rng.int(0, pool.length - 1)]);
    while (picked.size < want) picked.add(rng.int(0, catalog.skus.length - 1));
    const lines = [...picked].sort((a, b) => a - b).map((i) => ({ sku: catalog.skus[i].sku, temp: catalog.skus[i].temp, approvedQty: rng.int(SUPPLY.qty[0], SUPPLY.qty[1]) }));
    // 기타 센터는 묶인 피패킹센터마다 TRF 하나(품목 etcLinesPerTrf 개씩) — TRF 하나가 차 한 대를 넘지 않게(단일 출발)
    const per = isEtc(m.id) ? Math.max(1, Math.round((linesPerMfc * SUPPLY.etcLinesPerTrf) / SUPPLY.linesPerMfc)) : Infinity;
    // 상온은 상품 층(6F A~D · 7F E·F)마다 TRF 를 나눈다 — 한 TRF 는 한 차·한 층 도크에서 싣는다(단일 출발, 층 구성 재설계 사용자 2026-11-26) [시뮬]
    const floorOf = new Map(catalog.skus.map((x) => [x.sku, x.floor] as [string, number]));
    return TEMPS.flatMap((temp) => {
      const all = lines.filter((l) => l.temp === temp);
      const groups = temp === 'AMBIENT' ? [...new Set(all.map((l) => floorOf.get(l.sku) ?? 0))].sort().map((fl) => ({ fl, ls: all.filter((l) => (floorOf.get(l.sku) ?? 0) === fl) })) : [{ fl: 0, ls: all }];
      const parts: { temp: TemperatureZone; ls: typeof all; part: number; fl: number }[] = [];
      for (const g of groups)
        for (let i = 0, k = 1; i < g.ls.length; i += per === Infinity ? g.ls.length : per, k++) parts.push({ temp, ls: g.ls.slice(i, i + (per === Infinity ? g.ls.length : per)), part: per === Infinity ? 0 : k, fl: temp === 'AMBIENT' ? g.fl : 0 });
      return parts;
    })
      .filter((g) => g.ls.length > 0)
      .map(
        (g) =>
          ({
            trfId: `TRF-${day}-${mfcShort(m.id)}-${TEMP_SUFFIX[g.temp]}${g.fl ? `-F${g.fl}` : ''}${g.part ? `-P${g.part}` : ''}`,
            trfVersion: 1,
            cdcId: CENTER_ID,
            mfcId: m.id,
            approvalRef: `APR-${day}-${m.staging}-${TEMP_SUFFIX[g.temp]}${g.fl ? `-F${g.fl}` : ''}${g.part ? `-P${g.part}` : ''}`,
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
