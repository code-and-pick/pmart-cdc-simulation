// MockBackend(cdc-outbound) + 원장(cdc-inventory) — WMS 0.3 불변식, 1요청·1이관·1출발, 계약 오류 코드.
import { beforeEach, describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock/MockBackend';
import { buildCatalog, type Catalog } from '../src/domain/catalog';
import { ApiProblem, SKU_PATTERN, type LpnComposition, type Task, type TransferIntakeInput } from '../src/domain/contract';
import { buildLayout, LOCATION_CODE_PATTERN } from '../src/domain/layout';
import { makeTransfers } from '../src/sim/supply';

const BASE = '2026-11-25';
const layout = buildLayout();
const catalog: Catalog = buildCatalog(layout, BASE);

let clock = 13 * 3600;
let mb: MockBackend;
let k = 0;
const key = () => `k-${++k}`;

beforeEach(() => {
  clock = 13 * 3600;
  mb = new MockBackend({ now: () => clock, baseDate: BASE, catalog });
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof ApiProblem) return e.problem.code;
    throw e;
  }
}
function codeSync(f: () => unknown): string {
  try {
    f();
    return 'OK';
  } catch (e) {
    if (e instanceof ApiProblem) return e.problem.code;
    throw e;
  }
}

async function pickAll(t: Task, worker = 'fc-01') {
  await mb.reportPickResult(t.taskId, { workerId: worker, lines: t.lines.map((l) => ({ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: l.plannedQty - l.pickedQty - l.shortQty })) }, key());
}

/** TRF 하나를 실피킹 → 분류(작업마다 BOX 하나) → 검품 합격까지 */
async function throughInspection(trfId: string, waveId: string) {
  for (const t of (await mb.listTasks(waveId)).filter((x) => x.trfId === trfId)) await pickAll(t);
  const tasks = (await mb.listTasks(waveId)).filter((x) => x.trfId === trfId);
  const lpns: LpnComposition[] = tasks.map((t, i) => ({
    lpn: `LPN-${trfId}-${i + 1}`,
    unitType: 'BOX',
    state: 'SEALED',
    contents: t.lines.filter((l) => l.pickedQty > 0).map((l) => ({ sku: l.sku, lot: l.lot, qty: l.pickedQty })),
  }));
  await mb.reportSortingResult({ waveId, trfId, workerId: 'line-01', lpns }, key());
  await mb.reportInspectionResult({ trfId, inspectorId: 'qc-01', items: lpns.map((l) => ({ lpn: l.lpn, result: 'PASSED' as const })) }, key());
  return lpns;
}

async function startDay(n = 5) {
  const trfs = makeTransfers(catalog, BASE, 7).slice(0, n);
  for (const t of trfs) mb.intakeTransfer(t, key());
  const wave = await mb.createWave({ cdcId: 'CDC01', trfIds: trfs.map((t) => t.trfId) }, key());
  await mb.releaseWave(wave.waveId, key(), wave.version);
  return { trfs, waveId: wave.waveId };
}

describe('가짜 상품 마스터·시작 재고', () => {
  it('고회전 2,000 SKU — 계약 SKU 패턴, 랙 기둥 한 칸(1단 피킹면 · 2단 보충 대기 · 3단~ 리저브)', () => {
    expect(catalog.skus).toHaveLength(2000);
    expect(new Set(catalog.skus.map((s) => s.sku)).size).toBe(2000);
    for (const s of catalog.skus) {
      expect(s.sku).toMatch(SKU_PATTERN);
      expect(s.pickFace.type).toBe('PICK_FACE');
      expect(s.pickFace.level).toBe(1);
      expect(s.reserve.level).toBe(3);
      expect([s.reserve.zone, s.reserve.aisle, s.reserve.bay, s.reserve.slot]).toEqual([s.pickFace.zone, s.pickFace.aisle, s.pickFace.bay, s.pickFace.slot]);
      for (const l of s.seed) expect(l.locationCode).toMatch(LOCATION_CODE_PATTERN);
      expect(s.column.map((l) => l.level)).toEqual(Array.from({ length: s.column.length }, (_, i) => i + 1));
      expect(s.column.length).toBe(s.temp === 'AMBIENT' ? 5 : 4);
      expect(s.seed[0].expiresAt < s.seed[s.seed.length - 1].expiresAt).toBe(true); // 피킹면 LOT 이 먼저 끝난다
      expect(s.seed[1].lot).toBe(s.seed[0].lot); // 보충 대기 = 피킹면 LOT
      s.seed.forEach((l, i) => expect(l.qty).toBeLessThanOrEqual(s.column[i].capacity));
    }
  });

  it('시작 재고는 INITIAL_BALANCE 한 번 — 원장 불변식 위반 없음', () => {
    const t = mb.ledger.totals();
    expect(t.initial).toBe(catalog.skus.reduce((s, x) => s + x.seed.reduce((a, l) => a + l.qty, 0), 0));
    expect(t.onHand).toBe(t.initial);
    expect(t.reserved).toBe(0);
    expect(mb.ledger.check()).toEqual([]);
  });
});

describe('TRF 인수·할당 (CDC-F-016)', () => {
  it('할당은 예약만 — 현물 변화 없음, FEFO 로 피킹면 LOT 먼저', async () => {
    const [trf] = makeTransfers(catalog, BASE, 7);
    const before = mb.ledger.totals();
    const r = mb.intakeTransfer(trf, key());
    expect(r.status).toBe('APPLIED');
    const after = mb.ledger.totals();
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(trf.lines.reduce((s, l) => s + l.approvedQty, 0));
    const alloc = mb.ledger.getAllocation(r.resultId!)!;
    for (const l of alloc.lines) expect(l.lots[0].locationCode).toBe(catalog.bySku.get(l.sku)!.pickFace.code);
    expect((await mb.getTransferIntake(trf.trfId)).state).toBe('ALLOCATED');
    expect(mb.ledger.check()).toEqual([]);
  });

  it('같은 키·같은 본문은 기존 결과, 같은 키·다른 본문은 IDEMPOTENCY_CONFLICT, 같은 버전·다른 본문은 TRANSFER_INTAKE_CONFLICT', () => {
    const [trf] = makeTransfers(catalog, BASE, 7);
    const a = mb.intakeTransfer(trf, 'same');
    expect(mb.intakeTransfer(trf, 'same')).toEqual(a);
    const changed: TransferIntakeInput = { ...trf, lines: [{ ...trf.lines[0], approvedQty: trf.lines[0].approvedQty + 1 }, ...trf.lines.slice(1)] };
    expect(codeSync(() => mb.intakeTransfer(changed, 'same'))).toBe('IDEMPOTENCY_CONFLICT');
    expect(codeSync(() => mb.intakeTransfer(changed, 'other'))).toBe('TRANSFER_INTAKE_CONFLICT');
    expect(mb.ledger.totals().reserved).toBe(trf.lines.reduce((s, l) => s + l.approvedQty, 0));
  });

  it('새 버전은 기존 인수를 대체 — 옛 예약을 풀고 다시 할당', () => {
    const [trf] = makeTransfers(catalog, BASE, 7);
    mb.intakeTransfer(trf, key());
    const v2: TransferIntakeInput = { ...trf, trfVersion: 2, lines: trf.lines.slice(0, 3) };
    mb.intakeTransfer(v2, key());
    expect(mb.ledger.totals().reserved).toBe(v2.lines.reduce((s, l) => s + l.approvedQty, 0));
    expect(mb.ledger.check()).toEqual([]);
  });

  it('마지막 재고를 두 MFC 가 동시에 원해도 유효 확보 합은 적격 재고 이하 — 부분 할당', () => {
    const s = catalog.skus[0];
    const stock = s.seed.reduce((a, l) => a + l.qty, 0);
    const [a, b] = makeTransfers(catalog, BASE, 7);
    mb.intakeTransfer({ ...a, lines: [{ sku: s.sku, approvedQty: stock - 5 }] }, key());
    const r = mb.intakeTransfer({ ...b, lines: [{ sku: s.sku, approvedQty: 20 }] }, key());
    const alloc = mb.ledger.getAllocation(r.resultId!)!;
    expect(alloc.state).toBe('PARTIAL');
    expect(alloc.lines[0]).toMatchObject({ allocatedQty: 5, shortQty: 15 });
    expect(mb.ledger.availability(s.sku, 0, 0).available).toBe(0);
    expect(mb.ledger.check()).toEqual([]);
  });
});

describe('Wave·Task·실피킹 (CDC-F-017·018)', () => {
  it('Wave 배포 → TRF × 층·구역 Task. 피킹은 위치만 옮긴다(랙 → 출고대기 91), 총현물 그대로', async () => {
    const { waveId } = await startDay();
    const wave = await mb.getWave(waveId);
    expect(wave.state).toBe('RELEASED');
    const tasks = await mb.listTasks(waveId);
    expect(tasks.length).toBe(wave.taskSummary.total);
    for (const t of tasks) {
      expect(t.state).toBe('CREATED');
      expect(new Set(t.lines.map((l) => l.locationCode.split('-').slice(1, 3).join('-'))).size).toBe(1);
    }
    const before = mb.ledger.totals();
    await pickAll(tasks[0]);
    const after = mb.ledger.totals();
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved);
    const staged = tasks[0].lines.reduce((s, l) => s + l.plannedQty, 0);
    const stagingCode = mb.ledger.holdingsOf((await mb.getTransferIntake(tasks[0].trfId)).allocationId!).find((h) => h.locationCode.includes('-91-'))!.locationCode;
    expect(stagingCode).toMatch(LOCATION_CODE_PATTERN);
    expect(mb.ledger.onHandAt(stagingCode)).toBe(staged);
    expect((await mb.getTask(tasks[0].taskId)).state).toBe('DONE');
    expect((await mb.getWave(waveId)).state).toBe('IN_PROGRESS');
    expect(mb.ledger.check()).toEqual([]);
  });

  it('이미 Wave 에 든 TRF 는 TRF_ALREADY_IN_WAVE, 미확보 TRF 는 INVALID_STATE', async () => {
    const { trfs } = await startDay(2);
    expect(await code(mb.createWave({ cdcId: 'CDC01', trfIds: [trfs[0].trfId] }, key()))).toBe('TRF_ALREADY_IN_WAVE');
    const [, , c] = makeTransfers(catalog, BASE, 7);
    const none = { ...c, lines: [{ sku: catalog.skus[1].sku, approvedQty: 1_000_000 }] };
    // 가진 만큼만 부분 할당되므로 다른 SKU 로 실패를 만든다: 재고를 먼저 다 가져간다
    mb.intakeTransfer(none, key());
    const [, , , d] = makeTransfers(catalog, BASE, 7);
    mb.intakeTransfer({ ...d, lines: [{ sku: catalog.skus[1].sku, approvedQty: 3 }] }, key());
    expect((await mb.getTransferIntake(d.trfId)).state).toBe('ALLOCATION_FAILED');
    expect(await code(mb.createWave({ cdcId: 'CDC01', trfIds: [d.trfId] }, key()))).toBe('INVALID_STATE');
  });

  it('지시보다 많이 피킹하면 PICK_EXCEEDS_ALLOCATION, 다른 작업자는 INVALID_STATE', async () => {
    const { waveId } = await startDay(1);
    const [t] = await mb.listTasks(waveId);
    const l = t.lines[0];
    expect(await code(mb.reportPickResult(t.taskId, { workerId: 'fc-01', lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: l.plannedQty + 1 }] }, key()))).toBe('PICK_EXCEEDS_ALLOCATION');
    await mb.reportPickResult(t.taskId, { workerId: 'fc-01', lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: 1 }] }, key());
    expect(await code(mb.reportPickResult(t.taskId, { workerId: 'fc-02', lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: 1 }] }, key()))).toBe('INVALID_STATE');
    expect(await code(mb.reportPickResult(t.taskId, { workerId: 'fc-01', lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: 0 }] }, key(), 0))).toBe('VERSION_CONFLICT');
  });

  it('응답 유실 뒤 같은 키 재전송은 한 번만 반영된다', async () => {
    const { waveId } = await startDay(1);
    const [t] = await mb.listTasks(waveId);
    const l = t.lines[0];
    const body = { workerId: 'fc-01', lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: 2 }] };
    await mb.reportPickResult(t.taskId, body, 'retry-1');
    await mb.reportPickResult(t.taskId, body, 'retry-1');
    expect((await mb.getTask(t.taskId)).lines[0].pickedQty).toBe(2);
  });

  it('부족 보고 → 그 칸 예약 해제·차단, 다음 FEFO 칸(2단 보충 대기)으로 재할당한 새 Task. 현물은 지우지 않는다', async () => {
    const { waveId } = await startDay(1);
    const [t] = await mb.listTasks(waveId);
    const l = t.lines[0];
    const before = mb.ledger.totals();
    await mb.reportPickResult(
      t.taskId,
      { workerId: 'fc-01', lines: t.lines.map((x, i) => ({ sku: x.sku, lot: x.lot, locationCode: x.locationCode, pickedQty: i === 0 ? x.plannedQty - 3 : x.plannedQty, ...(i === 0 ? { shortQty: 3, shortReason: 'NOT_FOUND' as const } : {}) })) },
      key(),
    );
    expect((await mb.getTask(t.taskId)).state).toBe('PARTIAL');
    expect(mb.ledger.totals().onHand).toBe(before.onHand);
    const follow = (await mb.listTasks(waveId)).filter((x) => x.taskId !== t.taskId && x.lines.some((y) => y.sku === l.sku));
    expect(follow).toHaveLength(1);
    expect(follow[0].lines[0]).toMatchObject({ sku: l.sku, plannedQty: 3, locationCode: catalog.bySku.get(l.sku)!.buffer.code });
    expect(mb.ledger.check()).toEqual([]);
  });
});

describe('분류·검품·상차·출발 (CDC-F-019~022)', () => {
  it('분류 > 실피킹은 SORT_EXCEEDS_PICKED, 같은 LPN 두 번은 LPN_ALREADY_SEALED, 불합격 LPN 상차는 LPN_NOT_PASSED', async () => {
    const { trfs, waveId } = await startDay(1);
    const trfId = trfs[0].trfId;
    const [t] = await mb.listTasks(waveId);
    await pickAll(t);
    const l = t.lines[0];
    const box = (lpn: string, qty: number): LpnComposition => ({ lpn, unitType: 'BOX', state: 'SEALED', contents: [{ sku: l.sku, lot: l.lot, qty }] });
    expect(await code(mb.reportSortingResult({ waveId, trfId, workerId: 'w', lpns: [box('X1', l.plannedQty + 1)] }, key()))).toBe('SORT_EXCEEDS_PICKED');
    await mb.reportSortingResult({ waveId, trfId, workerId: 'w', lpns: [box('X1', 1)] }, key());
    expect(await code(mb.reportSortingResult({ waveId, trfId, workerId: 'w', lpns: [box('X1', 1)] }, key()))).toBe('LPN_ALREADY_SEALED');
    await mb.reportInspectionResult({ trfId, inspectorId: 'q', items: [{ lpn: 'X1', result: 'FAILED', failReason: 'DAMAGE' }] }, key());
    expect(await code(mb.reportLoadingResult({ trfId, tripId: 'TRIP-1', vehicleId: 'V1', workerId: 'j', action: 'LOADED', lpns: [{ lpn: 'X1' }] }, key()))).toBe('LPN_NOT_PASSED');
  });

  it('하루 전체: 상차(LOADED)는 수량 전기 없음, 출발 검증 뒤에만 CDC −q · Transit +q. 단계 수량 상차 ≤ 검품 ≤ 분류 ≤ 피킹 ≤ 할당 ≤ 승인', async () => {
    const { trfs, waveId } = await startDay(5);
    const comps: { trfId: string; mfcId: string; lpns: string[] }[] = [];
    for (const trf of trfs) {
      const lpns = await throughInspection(trf.trfId, waveId);
      await mb.reportLoadingResult({ trfId: trf.trfId, tripId: `TRIP-${trf.mfcId}`, vehicleId: `V-${trf.mfcId}`, workerId: 'jockey-01', action: 'LOADED', lpns: lpns.map((x) => ({ lpn: x.lpn })) }, key());
      comps.push({ trfId: trf.trfId, mfcId: trf.mfcId, lpns: lpns.map((x) => x.lpn) });
      const p = await mb.getTransferIntake(trf.trfId);
      expect(p.state).toBe('LOADED');
      for (const x of p.progress) {
        expect(x.loadedQty).toBeLessThanOrEqual(x.inspectedQty);
        expect(x.inspectedQty).toBeLessThanOrEqual(x.sortedQty);
        expect(x.sortedQty).toBeLessThanOrEqual(x.pickedQty);
        expect(x.pickedQty).toBeLessThanOrEqual(x.allocatedQty);
        expect(x.allocatedQty).toBeLessThanOrEqual(x.approvedQty);
      }
    }
    expect((await mb.getWave(waveId)).state).toBe('WORK_DONE');
    const before = mb.ledger.totals();
    expect(before.onHand).toBe(before.initial); // 피킹·분류·상차 동안 총현물 그대로
    clock = 23 * 3600;
    let shipped = 0;
    for (const c of comps) {
      const v = mb.validateDeparture({ departureId: `DEP-${c.mfcId}`, tripId: `TRIP-${c.mfcId}`, vehicleId: `V-${c.mfcId}`, departedAt: new Date().toISOString(), source: 'SIMULATED', trfCompositions: [c] }, key());
      expect(v.overallResult).toBe('MATCHED');
      shipped += v.transfers[0].departedQty;
      expect((await mb.getShipmentManifest(c.trfId)).lines.reduce((s, l) => s + l.qty, 0)).toBe(v.transfers[0].departedQty);
    }
    const after = mb.ledger.totals();
    expect(after.onHand).toBe(before.onHand - shipped);
    expect(after.transit).toBe(shipped);
    expect(after.reserved).toBe(0);
    expect(mb.ledger.check()).toEqual([]);
    for (const c of comps) expect((await mb.getTransferIntake(c.trfId)).state).toBe('DEPARTED');
  });

  it('1요청·1이관·1출발 — 일부만 실으면 실은 것만 출발, 잔량은 정리되고 두 번째 출발은 불일치', async () => {
    const { trfs, waveId } = await startDay(1);
    const trfId = trfs[0].trfId;
    const lpns = await throughInspection(trfId, waveId);
    expect(lpns.length).toBeGreaterThan(1);
    const first = lpns.slice(0, 1);
    await mb.reportLoadingResult({ trfId, tripId: 'T1', vehicleId: 'V1', workerId: 'j', action: 'LOADED', lpns: first.map((x) => ({ lpn: x.lpn })) }, key());
    const v = mb.validateDeparture({ departureId: 'D1', tripId: 'T1', vehicleId: 'V1', departedAt: '2026-11-25T14:00:00Z', source: 'SIMULATED', trfCompositions: [{ trfId, lpns: first.map((x) => x.lpn) }] }, key());
    expect(v.transfers[0].departedQty).toBe(first[0].contents.reduce((s, c) => s + c.qty, 0));
    expect(mb.ledger.totals().reserved).toBe(0); // 잔량 예약 정리(TransferResidualClosed)
    const rest = lpns.slice(1);
    expect(await code(mb.reportLoadingResult({ trfId, tripId: 'T2', vehicleId: 'V2', workerId: 'j', action: 'LOADED', lpns: rest.map((x) => ({ lpn: x.lpn })) }, key()))).toBe('INVALID_STATE');
    const v2 = mb.validateDeparture({ departureId: 'D2', tripId: 'T2', vehicleId: 'V2', departedAt: '2026-11-25T14:30:00Z', source: 'SIMULATED', trfCompositions: [{ trfId, lpns: rest.map((x) => x.lpn) }] }, key());
    expect(v2.overallResult).toBe('MISMATCHED');
    expect(v2.transfers[0].postingStatus).toBe('REJECTED');
    expect(codeSync(() => mb.validateDeparture({ departureId: 'D1', tripId: 'T1', vehicleId: 'V1', departedAt: 'x', source: 'SIMULATED', trfCompositions: [{ trfId, lpns: [] }] }, key()))).toBe('DEPARTURE_ALREADY_VALIDATED');
    expect(mb.ledger.check()).toEqual([]);
  });

  it('출발 대조 — 실리지 않은 LPN·빠진 LPN·다른 MFC 는 불일치, 전기 없음', async () => {
    const { trfs, waveId } = await startDay(1);
    const trf = trfs[0];
    const lpns = await throughInspection(trf.trfId, waveId);
    await mb.reportLoadingResult({ trfId: trf.trfId, tripId: 'T1', vehicleId: 'V1', workerId: 'j', action: 'LOADED', lpns: lpns.map((x) => ({ lpn: x.lpn })) }, key());
    const before = mb.ledger.totals();
    const v = mb.validateDeparture({ departureId: 'D1', tripId: 'T1', vehicleId: 'V1', departedAt: 'x', source: 'SIMULATED', trfCompositions: [{ trfId: trf.trfId, mfcId: 'MFC-CHC-01', lpns: lpns.slice(1).map((x) => x.lpn) }] }, key());
    expect(v.overallResult).toBe('MISMATCHED');
    expect(v.mismatches.map((m) => m.kind).sort()).toEqual(['LPN_NOT_IN_DEPARTURE', 'WRONG_MFC'].sort());
    expect(mb.ledger.totals()).toEqual(before);
  });

  it('MFC 수령 확인은 receiptId 1회 → Transit −r (정상+격리), 미정산 t 가 남는다', async () => {
    const { trfs, waveId } = await startDay(1);
    const trfId = trfs[0].trfId;
    const lpns = await throughInspection(trfId, waveId);
    await mb.reportLoadingResult({ trfId, tripId: 'T1', vehicleId: 'V1', workerId: 'j', action: 'LOADED', lpns: lpns.map((x) => ({ lpn: x.lpn })) }, key());
    mb.validateDeparture({ departureId: 'D1', tripId: 'T1', vehicleId: 'V1', departedAt: 'x', source: 'SIMULATED', trfCompositions: [{ trfId, lpns: lpns.map((x) => x.lpn) }] }, key());
    const tr = mb.ledger.transit(trfId)!;
    const [first, ...others] = tr.lines;
    const recv = [{ sku: first.sku, lot: first.lot, normalQty: first.q - 2, quarantinedQty: 1 }, ...others.map((l) => ({ sku: l.sku, lot: l.lot, normalQty: l.q, quarantinedQty: 0 }))];
    mb.ledger.acknowledgeReceipt(trfId, 'RCP-1', recv);
    mb.ledger.acknowledgeReceipt(trfId, 'RCP-1', recv); // 같은 수령 두 번 → 한 번만
    const after = mb.ledger.transit(trfId)!;
    expect(after.state).toBe('RECEIPT_POSTED_AWAITING_ACK');
    expect(after.lines.reduce((s, l) => s + l.t, 0)).toBe(1);
    expect(mb.ledger.totals().transit).toBe(1);
    expect(mb.ledger.check()).toEqual([]);
  });
});

describe('미출발 취소 (CDC-F-026 경계)', () => {
  it('상차된 LPN 이 있으면 PENDING → 하차(UNLOADED) 뒤 APPLIED, 예약 해제·남은 Task 취소', async () => {
    const { trfs, waveId } = await startDay(2);
    const trfId = trfs[0].trfId;
    const lpns = await throughInspection(trfId, waveId);
    await mb.reportLoadingResult({ trfId, tripId: 'T1', vehicleId: 'V1', workerId: 'j', action: 'LOADED', lpns: lpns.map((x) => ({ lpn: x.lpn })) }, key());
    const r = await mb.cancelBeforeDeparture(trfId, { reason: 'TRANSPORT_UNAVAILABLE', scope: 'FULL' }, key());
    expect(r.status).toBe('ACCEPTED');
    expect((await mb.getPreDepartureCancellation(trfId, r.resultId!)).state).toBe('PENDING');
    await mb.reportLoadingResult({ trfId, tripId: 'T1', vehicleId: 'V1', workerId: 'j', action: 'UNLOADED', lpns: lpns.map((x) => ({ lpn: x.lpn })) }, key());
    const c = await mb.getPreDepartureCancellation(trfId, r.resultId!);
    expect(c.state).toBe('APPLIED');
    expect(c.releasedQty).toBeGreaterThan(0);
    const alloc = (await mb.getTransferIntake(trfId)).allocationId!;
    expect(mb.ledger.heldQty(alloc)).toBe(0);
    expect((await mb.getTransferIntake(trfId)).state).toBe('CANCELLED');
    expect(mb.ledger.check()).toEqual([]);
  });

  it('출발 뒤 취소는 INVALID_STATE (출발한 실물의 단순 취소로 재고를 되돌리지 않는다)', async () => {
    const { trfs, waveId } = await startDay(1);
    const trfId = trfs[0].trfId;
    const lpns = await throughInspection(trfId, waveId);
    await mb.reportLoadingResult({ trfId, tripId: 'T1', vehicleId: 'V1', workerId: 'j', action: 'LOADED', lpns: lpns.map((x) => ({ lpn: x.lpn })) }, key());
    mb.validateDeparture({ departureId: 'D1', tripId: 'T1', vehicleId: 'V1', departedAt: 'x', source: 'SIMULATED', trfCompositions: [{ trfId, lpns: lpns.map((x) => x.lpn) }] }, key());
    expect(await code(mb.cancelBeforeDeparture(trfId, { reason: 'TRANSFER_CANCELLED', scope: 'FULL' }, key()))).toBe('INVALID_STATE');
  });
});
