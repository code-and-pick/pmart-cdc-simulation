// 실서버(LAN) 한 건 돌리기 — 새 TRF 하나를 인수 → 할당 → Wave → 피킹 → 분류 → 검품 → 배차(계획완료) → 상차 → 입차·상차완료·출차 → 출발 검증까지
// 계약 API 로만 차례로 부른다(사용자 2026-11-26 "LAN 에서 새 TRF 한 건을 처음부터 끝까지 돌리는 점검", 백엔드 조건 R-25·R-26).
// - replenishment 가 아직 없어 시뮬레이터가 cdc-outbound `POST /internal/transfer-intakes` 로 직접 넣는다(백엔드 안내).
// - 상품·수량은 LAN 시작 재고(`GET /internal/snapshots`)의 피킹면(선반·랙 1단)에 있는 상온 SKU 몇 개 × 작은 수량. MFC 는 지역표 5곳 중 하나.
// - 단계마다 응답 상태·code 를 남기고, 막히면 거기서 멈춘다(실패로 단정하지 않고 응답 그대로 보여 줌). 같은 단계 다시 누르면 같은 Idempotency-Key.
// React 에 의존하지 않는다.

import { CENTER_ID, SHELF, SKU_PLACE } from '../../config';
import { ApiProblem, type Task, type TransferIntake } from '../../domain/contract';
import type { HttpBackend } from './HttpBackend';
import type { HttpInternal } from './HttpInternal';
import type { HttpClient } from './client';

export interface RunStep {
  name: string;
  state: 'ok' | 'fail' | 'run' | 'skip';
  detail: string;
}

interface SnapLoc {
  locationCode: string;
  onHand: number;
  reserved: number;
}
interface SnapItem {
  sku: string;
  available: number;
  lots: { lot: string; locations: SnapLoc[] }[];
}

const zoneTemp = (code: string) => {
  const z = code.split('-')[1];
  return z === 'G' ? 'CHILLED' : z === 'H' ? 'FROZEN' : 'AMBIENT';
};
const isFace = (code: string) => {
  const [, z, , a, , lv] = code.split('-');
  const n = Number(a);
  return (n >= SHELF.aisleBase && n < 90) || (lv === '1' && SKU_PLACE.faceZones.includes(z));
};
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const why = (e: unknown) => (e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}${e.problem.detail ? ` — ${e.problem.detail}` : ''}` : e instanceof Error ? e.message : String(e));

export async function runLanOne(
  deps: { gateway: HttpClient; backend: HttpBackend; internal: HttpInternal; operatorId: () => string | null },
  /** pda = 피킹은 PDA 앱(사람)이 한다 — Wave 배포 뒤 그 Wave 작업이 다 끝날 때까지 기다렸다가 이어서(사용자 2026-11-26 "PDA 로 작업 되는지 확인") */
  opt: { mfcId: string; skus: number; qty: number; pda?: boolean; pdaWaitMin?: number },
  onStep: (steps: RunStep[]) => void,
): Promise<RunStep[]> {
  const steps: RunStep[] = [];
  const runId = `${Date.now().toString(36)}`;
  const key = (s: string) => `sim-lan-${runId}-${s}`;
  const step = async <T>(name: string, f: () => Promise<{ v: T; detail: string }>): Promise<T> => {
    const s: RunStep = { name, state: 'run', detail: '…' };
    steps.push(s);
    onStep([...steps]);
    try {
      const { v, detail } = await f();
      s.state = 'ok';
      s.detail = detail;
      onStep([...steps]);
      return v;
    } catch (e) {
      s.state = 'fail';
      s.detail = why(e);
      onStep([...steps]);
      throw e;
    }
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    // 0) 재고에서 고르기
    const picks = await step('시작 재고에서 상품 고르기', async () => {
      const r = await deps.internal.inventory.call<{ items: SnapItem[] }>('GET', '/internal/snapshots', { query: { cdcId: CENTER_ID } });
      const cand = (r.body.items ?? [])
        .map((it) => {
          const loc = it.lots.flatMap((l) => l.locations.map((x) => ({ ...x, lot: l.lot }))).find((x) => isFace(x.locationCode) && x.onHand - x.reserved >= opt.qty);
          return loc && it.available >= opt.qty && zoneTemp(loc.locationCode) === 'AMBIENT' ? { sku: it.sku, loc } : null;
        })
        .filter((x): x is { sku: string; loc: SnapLoc & { lot: string } } => !!x);
      const chosen = cand.slice(0, opt.skus);
      if (!chosen.length) throw new Error('피킹면에 쓸 수 있는 상온 재고가 없음');
      return { v: chosen, detail: chosen.map((c) => `${c.sku} @ ${c.loc.locationCode}`).join(' · ') };
    });
    // 1) 인수
    const now = new Date();
    const shipDate = kst(now);
    const due = new Date(`${shipDate}T00:00:00+09:00`);
    due.setTime(due.getTime() + (24 + 6) * 3600_000); // 다음 날 06:00 KST — [출고일 12:00, 다음 날 12:00) 안
    const trfId = `TRF-SIM-${runId.toUpperCase()}`;
    await step('TRF 인수 (POST /internal/transfer-intakes)', async () => {
      const r = await deps.internal.intakeTransfer(
        {
          trfId,
          trfVersion: 1,
          cdcId: CENTER_ID,
          mfcId: opt.mfcId,
          approvalRef: `SIM-LAN-${runId}`,
          deadlineMeaning: 'ARRIVAL',
          dueAt: due.toISOString(),
          conditions: [{ kind: 'TEMPERATURE_ZONE', value: 'AMBIENT' }],
          lines: picks.map((p) => ({ sku: p.sku, approvedQty: opt.qty })),
        },
        key('intake'),
      );
      return { v: r, detail: `${trfId} → ${opt.mfcId} · ${picks.length}줄 × ${opt.qty} · ${r.status ?? ''}` };
    });
    // 2) 할당 기다림
    let intake: TransferIntake = await step('할당 (인수 상태 확인)', async () => {
      for (let i = 0; i < 15; i++) {
        const t = await deps.internal.getTransferIntake(trfId);
        if (t.state !== 'RECEIVED' && t.state !== 'ALLOCATING') return { v: t, detail: `${t.state} · 할당 ${t.progress.reduce((a, p) => a + p.allocatedQty, 0)} / 승인 ${t.progress.reduce((a, p) => a + p.approvedQty, 0)}` };
        await wait(1000);
      }
      throw new Error('15초 안에 할당 결과가 없음(ALLOCATING)');
    });
    if (intake.state === 'ALLOCATION_FAILED') throw new Error('ALLOCATION_FAILED');
    // 3) Wave
    const wave = await step('Wave 만들기 (POST /waves)', async () => {
      const w = await deps.backend.createWave({ cdcId: CENTER_ID, trfIds: [trfId], temperatureZone: 'AMBIENT' }, key('wave'));
      return { v: w, detail: `${w.waveId} ${w.state}` };
    });
    await step('Wave 배포 (releases)', async () => {
      const r = await deps.backend.releaseWave(wave.waveId, key('release'), wave.version);
      return { v: r, detail: `${r.status}` };
    });
    // 4) 피킹 — 이 Wave 작업을 받아 계획 수량대로
    const worker = deps.operatorId() ?? 'claude-cdc-sup';
    const picked: { sku: string; lot: string; qty: number }[] = [];
    if (opt.pda)
      await step('PDA 피킹 기다림 — PDA 앱에서 DC 업무 → 피킹 → 다음 작업 받기', async () => {
        const until = Date.now() + (opt.pdaWaitMin ?? 30) * 60_000;
        const TERM = ['DONE', 'PARTIAL', 'CANCELLED', 'EXCEPTION'];
        for (;;) {
          const ts = (await deps.backend.listTasks(wave.waveId)).filter((t) => t.kind === 'PICK' || !t.kind);
          const done = ts.filter((t) => TERM.includes(t.state));
          const run = ts.filter((t) => !TERM.includes(t.state));
          const live = steps[steps.length - 1];
          live.detail = `작업 ${ts.length}개 — 끝 ${done.length} · ${run.map((t) => `${t.state}${t.assigneeId ? ` (${t.assigneeId})` : ''}`).join(', ') || '없음'}`;
          onStep([...steps]);
          if (ts.length && !run.length) {
            for (const t of ts) for (const l of t.lines) for (const sh of l.shares) if (sh.trfId === trfId && sh.pickedQty > 0) picked.push({ sku: l.sku, lot: l.lot, qty: sh.pickedQty });
            if (!picked.length) throw new Error('PDA 작업이 끝났는데 집은 수량이 0');
            return { v: ts.length, detail: `PDA 로 작업 ${ts.length}개 끝 · ${picked.reduce((a, x) => a + x.qty, 0)}개 집음 · 담당 ${[...new Set(ts.map((t) => t.assigneeId).filter(Boolean))].join(', ')}` };
          }
          if (Date.now() > until) throw new Error(`${opt.pdaWaitMin ?? 30}분 안에 PDA 피킹이 끝나지 않음`);
          await wait(3000);
        }
      });
    else await step('피킹 (next-tasks → starts → pick-results)', async () => {
      let n = 0;
      for (let i = 0; i < 20; i++) {
        let task: Task;
        try {
          task = (await deps.backend.pullNextTask(CENTER_ID, worker, { kind: 'PICK' }, key(`next-${i}`))).task;
        } catch (e) {
          if (e instanceof ApiProblem && e.problem.code === 'NO_TASK_AVAILABLE') break;
          throw e;
        }
        if (task.waveId !== wave.waveId) throw new Error(`다른 Wave 작업을 받음 ${task.taskId}(${task.waveId}) — 옛 Wave 작업이 남아 있음`);
        if (task.state === 'ACCEPTED' || task.state === 'ASSIGNED' || task.state === 'CREATED') task = await deps.backend.startTask(task.taskId, worker, key(`start-${i}`), task.version);
        const lines = task.lines.map((l) => ({ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: l.plannedQty - l.pickedQty - l.shortQty }));
        await deps.backend.reportPickResult(task.taskId, { workerId: worker, lines }, key(`pick-${i}`), task.version);
        for (const l of lines) picked.push({ sku: l.sku, lot: l.lot, qty: l.pickedQty });
        n++;
      }
      if (!n) throw new Error('받을 작업이 없음');
      return { v: n, detail: `작업 ${n}개 · ${picked.reduce((a, p) => a + p.qty, 0)}개` };
    });
    // 5) 분류(박스 하나) → 검품
    const lpn = `LPN-SIM-${runId.toUpperCase()}-1`;
    await step('분류 (sorting-results — 박스 1)', async () => {
      const r = await deps.backend.reportSortingResult({ waveId: wave.waveId, trfId, workerId: worker, lpns: [{ lpn, unitType: 'BOX', state: 'SEALED', temperatureZone: 'AMBIENT', contents: picked }] }, key('sort'));
      return { v: r, detail: `${lpn} · ${r.status}` };
    });
    await step('검품 (inspection-results — 합격)', async () => {
      const r = await deps.backend.reportInspectionResult({ trfId, inspectorId: worker, items: [{ lpn, result: 'PASSED' }] }, key('inspect'));
      return { v: r, detail: `${r.status}` };
    });
    // 6) 배차 생성 → 이 TRF 가 든 지시서 계획완료
    type Order = { orderId: string; trfIds?: string[]; stops?: { trfIds?: string[] }[]; vehicleId?: string | null; dockCode?: string | null; state: string; version: number; reason?: string | null };
    const order = await step('배차 생성 (transport-orders/generations)', async () => {
      const r = await deps.gateway.call<{ orders?: Order[]; requests?: Record<string, number>; unplannedReasons?: { routeId: string; tempClass: string; reason: string }[] }>('POST', `/cdcs/${CENTER_ID}/transport-orders/generations`, { body: { shipDate }, idempotencyKey: key('gen') });
      const o = (r.body.orders ?? []).find((x) => (x.trfIds ?? []).includes(trfId) || (x.stops ?? []).some((s) => (s.trfIds ?? []).includes(trfId)));
      if (!o) throw new Error(`이 TRF 가 든 지시서 없음 — 요청서 ${JSON.stringify(r.body.requests ?? {})} · 미계획 ${JSON.stringify(r.body.unplannedReasons ?? [])}`);
      return { v: o, detail: `${o.orderId} ${o.state}` };
    });
    const confirmed = await step('계획완료 (confirmations — 차량·도크 예약)', async () => {
      const o = (await deps.gateway.call<Order>('POST', `/cdcs/${CENTER_ID}/transport-orders/${encodeURIComponent(order.orderId)}/confirmations`, { body: {}, idempotencyKey: key('confirm'), expectedVersion: order.version })).body;
      return { v: o, detail: `${o.state} · 차량 ${o.vehicleId ?? '-'} · 도크 ${o.dockCode ?? '-'}` };
    });
    const tripId = confirmed.orderId;
    // 7) 상차(CDC) → 입차·상차완료·출차(TMS)
    await step('상차 실적 (loading-results)', async () => {
      const r = await deps.backend.reportLoadingResult({ trfId, tripId, vehicleId: confirmed.vehicleId ?? '', ...(confirmed.dockCode ? { dockCode: confirmed.dockCode } : {}), workerId: worker, action: 'LOADED', lpns: [{ lpn }] }, key('load'));
      return { v: r, detail: `${r.status}` };
    });
    await step('입차 (trips check-ins)', async () => {
      const r = await deps.gateway.call<{ state?: string }>('POST', `/trips/${encodeURIComponent(tripId)}/check-ins`, { body: {}, idempotencyKey: key('checkin') });
      return { v: r.body, detail: `${r.body.state ?? r.status}` };
    });
    await step('상차완료 (trips loading-completions)', async () => {
      const r = await deps.gateway.call<{ state?: string }>('POST', `/trips/${encodeURIComponent(tripId)}/loading-completions`, { body: { transfers: [{ trfId, lpns: [lpn], rtCount: 1 }] }, idempotencyKey: key('loaded') });
      return { v: r.body, detail: `${r.body.state ?? r.status}` };
    });
    await step('출차 (trips departures → 출발 검증)', async () => {
      const r = await deps.gateway.call<{ state?: string; departureId?: string; outboundLinkage?: unknown }>('POST', `/trips/${encodeURIComponent(tripId)}/departures`, { body: { source: 'SIMULATED' }, idempotencyKey: key('depart') });
      return { v: r.body, detail: `${r.body.state ?? r.status} · ${r.body.departureId ?? ''} · 출발 검증 ${JSON.stringify(r.body.outboundLinkage ?? '-')}` };
    });
    // 8) 확인
    intake = await step('결과 확인 (인수 상태·매니페스트)', async () => {
      let t = await deps.internal.getTransferIntake(trfId);
      for (let i = 0; i < 10 && t.state !== 'DEPARTED'; i++) {
        await wait(1000);
        t = await deps.internal.getTransferIntake(trfId);
      }
      let manifest = '-';
      try {
        const m = await deps.internal.getShipmentManifest(trfId);
        manifest = (m as { shipmentManifestId?: string }).shipmentManifestId ?? 'OK';
      } catch (e) {
        manifest = why(e);
      }
      return { v: t, detail: `${t.state} · 출발 ${t.progress.reduce((a, p) => a + p.departedQty, 0)}개 · 매니페스트 ${manifest}` };
    });
  } catch {
    // 멈춘 단계는 steps 에 fail 로 남아 있다
  }
  return steps;
}
