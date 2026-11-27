// 실서버(LAN) 한 건 돌리기 — 새 TRF 하나를 인수 → 할당 → Wave → 피킹 → 분류 → 검품 → 배차(계획완료) → 상차 → 입차·상차완료·출차 → 출발 검증까지
// 계약 API 로만 차례로 부른다(사용자 2026-11-26 "LAN 에서 새 TRF 한 건을 처음부터 끝까지 돌리는 점검", 백엔드 조건 R-25·R-26).
// - replenishment 가 아직 없어 시뮬레이터가 cdc-outbound `POST /internal/transfer-intakes` 로 직접 넣는다(백엔드 안내).
// - 상품·수량은 LAN 시작 재고(`GET /internal/snapshots`)의 피킹면(선반·랙 1단)에 있는 상온 SKU 몇 개 × 작은 수량. MFC 는 지역표 5곳 중 하나.
// - 단계마다 응답 상태·code 를 남기고, 막히면 거기서 멈춘다(실패로 단정하지 않고 응답 그대로 보여 줌). 같은 단계 다시 누르면 같은 Idempotency-Key.
// React 에 의존하지 않는다.

import { CENTER_ID, MFCS, SHELF, SKU_PLACE } from '../../config';
import { stagingCodeFor } from '../../domain/layout';
import { ApiProblem, type Task, type TransferIntake } from '../../domain/contract';
import type { HttpBackend } from './HttpBackend';
import type { HttpInternal } from './HttpInternal';
import type { HttpClient } from './client';

export interface RunStep {
  name: string;
  state: 'ok' | 'fail' | 'run' | 'skip';
  detail: string;
  /** PDA 가 이 단계에서 찍을 코드(화면 팝업 — 사용자 2026-11-26 "지역 카드 찍으라는데 어딨어? 팝업으로") */
  scan?: { label: string; value: string }[];
  /** 이 단계가 다루는 TRF(팝업 제목) */
  trfId?: string;
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
  opt: { mfcId: string; skus: number; qty: number; pda?: boolean; pdaWaitMin?: number; /** LAN 에 이미 있는 TRF 를 지금 단계부터 이어서(PDA 모드) — 새로고침으로 끊긴 실행·다른 TRF 를 PDA 로 하고 있을 때(사용자 2026-11-26 "출고대기로 넘어갔는데 계속 피킹 팝업") */ resumeTrfId?: string },
  onStep: (steps: RunStep[]) => void,
): Promise<RunStep[]> {
  const steps: RunStep[] = [];
  const runId = `${Date.now().toString(36)}`;
  const key = (s: string) => `sim-lan-${runId}-${s}`;
  let curTrf: string | undefined = opt.resumeTrfId;
  const step = async <T>(name: string, f: () => Promise<{ v: T; detail: string }>): Promise<T> => {
    const s: RunStep = { name, state: 'run', detail: '…', ...(curTrf ? { trfId: curTrf } : {}) };
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
    type Ord0 = { orderId: string; trfIds?: string[]; stops?: { trfIds?: string[] }[]; vehicleId?: string | null; dockCode?: string | null; state: string; version: number };
    const res = opt.resumeTrfId
      ? await step('이어 하기 — 지금 상태 읽기', async () => {
          const it = await deps.internal.getTransferIntake(opt.resumeTrfId!);
          if (it.state === 'DEPARTED' || it.state === 'CANCELLED') throw new Error(`이미 ${it.state}`);
          // Wave 가 없으면(새로 들어온 TRF) 할당 확인 → Wave 만들기·배포부터(사용자 2026-11-26 "새 TRF 들어오면 가상 작업자 or PDA 로 작업하기")
          // 출고일 = 도착 기한(다음 날 06:00) − 30시간
          // 출고일 = TMS 운송 요청서의 shipDate(백엔드가 정함 — R-27 은 READY·dueAt = 희망 시각이라 계산하지 않고 읽음). 못 읽으면 도착 기한 − 30시간
          const tr = await deps.gateway.call<{ shipDate?: string; tempClass?: string }>('GET', `/cdcs/${CENTER_ID}/transport-requests/${encodeURIComponent(it.trfId)}`).then((r) => r.body).catch(() => null);
          // 배차 생성 전엔 운송 요청서가 없어(404) 같은 규칙으로 셈 — READY(R-28, transport-planning 0.5.0): "D+1 07:30 ≤ dueAt" 인 가장 늦은 D,
          // ARRIVAL: dueAt 이 [D 12:00, D+1 12:00) KST → D(CCdc 백엔드 2026-11-27)
          const due = new Date(it.dueAt).getTime();
          const day = tr?.shipDate ?? (it.deadlineMeaning === 'READY' ? kst(new Date(due - 7.5 * 3600_000 - 86_400_000)) : kst(new Date(due - 12 * 3600_000)));
          const r = await deps.gateway.call<{ items?: Ord0[] } | Ord0[]>('GET', `/cdcs/${CENTER_ID}/transport-orders`, { query: { shipDate: day } });
          const list = Array.isArray(r.body) ? r.body : (r.body.items ?? []);
          const order = list.find((x) => (x.trfIds ?? []).includes(it.trfId) || (x.stops ?? []).some((st) => (st.trfIds ?? []).includes(it.trfId))) ?? null;
          return { v: { intake: it, shipDate: day, order, tempClass: tr?.tempClass }, detail: `${it.state} · Wave ${it.waveId ?? '아직 없음'} · 출고일 ${day} · 지시서 ${order ? `${order.orderId} ${order.state}` : '없음'}` };
        })
      : null;
    // 0) 재고에서 고르기
    const picks = res
      ? res.intake.lines.map((l) => ({ sku: l.sku, loc: { locationCode: '', onHand: 0, reserved: 0, lot: '' } as unknown as SnapLoc & { lot: string } }))
      : await step('시작 재고에서 상품 고르기', async () => {
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
    // 출고일 고르기 — 그 MFC 노선·상온 운송지시서가 이미 계획완료(닫힘)인 날은 새 TRF 가 HELD ORDER_CLOSED 로 남는다(2026-11-26 두 번째 시험에서 막힘).
    // 오늘부터 하루씩 보며 닫힌 지시서가 없는 첫 날을 쓴다
    const shipDate = res
      ? res.shipDate
      : await step('출고일 고르기 (닫히지 않은 운송지시서)', async () => {
      type Ord = { orderId: string; tempClass?: string; state: string; stops?: { mfcId?: string }[] };
      const base = new Date(`${kst(new Date())}T00:00:00+09:00`);
      for (let d = 0; d < 14; d++) {
        const day = kst(new Date(base.getTime() + d * 86_400_000));
        const r = await deps.gateway.call<{ items?: Ord[] } | Ord[]>('GET', `/cdcs/${CENTER_ID}/transport-orders`, { query: { shipDate: day } });
        const list = Array.isArray(r.body) ? r.body : (r.body.items ?? []);
        const closed = list.find((o) => (o.tempClass ?? 'AMBIENT') === 'AMBIENT' && o.state !== 'PLANNING' && o.state !== 'CANCELLED' && (o.stops ?? []).some((s) => s.mfcId === opt.mfcId));
        if (!closed) return { v: day, detail: `${day}${d ? ` (오늘 지시서 ${d}일치가 닫혀 있어 건너뜀)` : ''}` };
      }
      throw new Error('14일 안에 열린 출고일이 없음');
    });
    const due = new Date(`${shipDate}T00:00:00+09:00`);
    due.setTime(due.getTime() + (24 + 6) * 3600_000); // 다음 날 06:00 KST — [출고일 12:00, 다음 날 12:00) 안
    const trfId = res ? res.intake.trfId : `TRF-SIM-${runId.toUpperCase()}`;
    curTrf = trfId;
    if (!res) await step('TRF 인수 (POST /internal/transfer-intakes)', async () => {
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
    const hasWave = !!res?.intake.waveId;
    // 온도대 — 인수 conditions, 없으면 TMS 운송 요청서 tempClass(같은 저장 값 — cdc-outbound 0.30.1 전엔 조회에 conditions 가 빠짐, PC1 백엔드 2026-11-27), 그것도 없으면 상온
    const zone = ((res?.intake.conditions ?? []).find((c) => c.kind === 'TEMPERATURE_ZONE')?.value ?? res?.tempClass ?? 'AMBIENT') as 'AMBIENT' | 'CHILLED' | 'FROZEN';
    let intake: TransferIntake = res && (hasWave || !['RECEIVED', 'ALLOCATING'].includes(res.intake.state))
      ? res.intake
      : await step('할당 (인수 상태 확인)', async () => {
      for (let i = 0; i < 15; i++) {
        const t = await deps.internal.getTransferIntake(trfId);
        if (t.state !== 'RECEIVED' && t.state !== 'ALLOCATING') return { v: t, detail: `${t.state} · 할당 ${t.progress.reduce((a, p) => a + p.allocatedQty, 0)} / 승인 ${t.progress.reduce((a, p) => a + p.approvedQty, 0)}` };
        await wait(1000);
      }
      throw new Error('15초 안에 할당 결과가 없음(ALLOCATING)');
    });
    if (intake.state === 'ALLOCATION_FAILED') throw new Error('ALLOCATION_FAILED');
    // 3) Wave
    const wave = res && hasWave
      ? ({ waveId: res.intake.waveId! } as Awaited<ReturnType<HttpBackend['createWave']>>)
      : await step('Wave 만들기 (POST /waves)', async () => {
      const w = await deps.backend.createWave({ cdcId: CENTER_ID, trfIds: [trfId], temperatureZone: zone }, key('wave'));
      return { v: w, detail: `${(w as { waveNumber?: string }).waveNumber ?? w.waveId} ${w.state}` };
    });
    // 이어 하기 — Wave 는 있는데 아직 배포 전(PLANNED)이면 배포부터(2026-11-27 계란 TRF: 만들기만 되고 배포 안 된 Wave)
    const waveNow = res && hasWave ? await deps.backend.getWave(wave.waveId).catch(() => null) : null;
    if (!(res && hasWave) || waveNow?.state === 'PLANNED') await step('Wave 배포 (releases)', async () => {
      const r = await deps.backend.releaseWave(wave.waveId, key('release'), waveNow?.version ?? wave.version);
      return { v: r, detail: `${r.status}` };
    });
    const worker = deps.operatorId() ?? 'claude-cdc-sup';
    type Order = { orderId: string; trfIds?: string[]; stops?: { trfIds?: string[] }[]; vehicleId?: string | null; dockCode?: string | null; state: string; version: number; reason?: string | null };
    // 배차 생성 → 이 TRF 가 든 지시서 계획완료(차량·도크 예약)
    const dispatch = async (): Promise<Order> => {
      const order = await step('배차 생성 (transport-orders/generations)', async () => {
        const r = await deps.gateway.call<{ orders?: Order[]; requests?: Record<string, number>; unplannedReasons?: { routeId: string; tempClass: string; reason: string }[] }>('POST', `/cdcs/${CENTER_ID}/transport-orders/generations`, { body: { shipDate }, idempotencyKey: key('gen') });
        const o = (r.body.orders ?? []).find((x) => (x.trfIds ?? []).includes(trfId) || (x.stops ?? []).some((s) => (s.trfIds ?? []).includes(trfId)));
        if (!o) {
          // 이 TRF 요청서가 왜 빠졌는지(보류 사유) 바로 보여 준다
          let why = '';
          try {
            const req = (await deps.gateway.call<{ state?: string; reason?: string | null }>('GET', `/cdcs/${CENTER_ID}/transport-requests/${encodeURIComponent(trfId)}`)).body;
            // 사람이 읽는 말로 — 보류 사유(사용자 2026-11-27 "이거 뭔데")
            const REASON: Record<string, string> = {
              ORDER_CLOSED: '그날 이 MFC·온도대 차가 이미 계획완료(닫힘)라 실을 차가 없음',
              READY_UNREACHABLE: '준비 시각까지 갈 수 있는 출고일 차가 이미 닫힘',
            };
            why = ` · 운송 요청서 ${req.state ?? '?'}${req.reason ? ` — ${REASON[req.reason] ?? req.reason}` : ''}`;
          } catch {
            /* 사유 조회 실패는 넘어감 */
          }
          throw new Error(`배차 안 됨(출고일 ${shipDate})${why}. 지금은 다른 날 차로 옮기는 기능이 없어 백엔드 처리가 필요합니다`);
        }
        return { v: o, detail: `${o.orderId} ${o.state}` };
      });
      return step('계획완료 (confirmations — 차량·도크 예약)', async () => {
        const o = (await deps.gateway.call<Order>('POST', `/cdcs/${CENTER_ID}/transport-orders/${encodeURIComponent(order.orderId)}/confirmations`, { body: {}, idempotencyKey: key('confirm'), expectedVersion: order.version })).body;
        return { v: o, detail: `${o.state} · 차량 ${o.vehicleId ?? '-'} · 도크 ${o.dockCode ?? '-'}` };
      });
    };
    const checkIn = (tid: string) =>
      step('입차 (trips check-ins)', async () => {
        const r = await deps.gateway.call<{ state?: string }>('POST', `/trips/${encodeURIComponent(tid)}/check-ins`, { body: {}, idempotencyKey: key('checkin') });
        return { v: r.body, detail: `${r.body.state ?? r.status}` };
      });
    let tripId = '';
    if (opt.pda) {
      // PDA 모드 — 피킹·분배/패킹·검품·상차는 PDA 앱(사람), 시뮬레이터는 TRF·Wave·배차·입차·출차만(사용자 2026-11-26 "PDA 앱에 DC 기능 추가했어").
      // 차가 먼저 도크에 들어와 있어야 PDA 상차(도크 스캔 → 운행)가 되므로 배차·입차를 먼저 한다
      const confirmed: Order = res?.order && res.order.state !== 'PLANNING' ? res.order : await dispatch();
      tripId = confirmed.orderId;
      // 이어 하기 — 이미 입차했으면 건너뜀
      const tripNow = res ? (await deps.gateway.call<{ state?: string }>('GET', `/trips/${encodeURIComponent(tripId)}`).catch(() => null))?.body.state : undefined;
      if (!tripNow || tripNow === 'SCHEDULED') await checkIn(tripId);
      const until = Date.now() + (opt.pdaWaitMin ?? 60) * 60_000;
      const sum = (t: TransferIntake, k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'sortedQty' | 'inspectedQty' | 'loadedQty') => t.progress.reduce((a, p) => a + p[k], 0);
      /** 인수 진행을 3초마다 보며 기다림 — 다 되면 그 단계 끝 */
      const waitStage = (name: string, hint: string, done: (t: TransferIntake) => boolean, show: (t: TransferIntake) => string, codes?: () => Promise<{ label: string; value: string }[]>) =>
        step(name, async () => {
          for (;;) {
            const t = await deps.internal.getTransferIntake(trfId);
            const live = steps[steps.length - 1];
            live.trfId = trfId;
            // 끝났으면 코드를 다시 읽지 않고 바로 다음 단계로 — 팝업이 곧장 다음 작업으로 바뀜(사용자 2026-11-26 "피킹 끝나면 자동으로 QR 닫고 분배패킹 팝업 바로")
            if (done(t)) {
              live.scan = [];
              return { v: t, detail: `${t.state} · ${show(t)}` };
            }
            live.detail = `${hint} · 지금 ${t.state} · ${show(t)}`;
            if (codes) live.scan = await codes().catch(() => live.scan);
            onStep([...steps]);
            if (Date.now() > until) throw new Error(`${opt.pdaWaitMin ?? 60}분 안에 끝나지 않음 — ${t.state}`);
            await wait(2000);
          }
        });
      const TERM = ['DONE', 'PARTIAL', 'CANCELLED', 'EXCEPTION'];
      // 피킹 — 남은 작업의 지역 카드(지역 묶음) · 줄마다 위치·상품
      // 작업이 다 끝남(부족 보고로 끝난 PARTIAL 포함) — 집음 수가 할당보다 적어도 피킹 단계는 끝
      let pickTasksDone = false;
      const pickCodes = async () => {
        const all = await deps.backend.listTasks(wave.waveId);
        const ts = all.filter((x) => !TERM.includes(x.state));
        pickTasksDone = all.length > 0 && ts.length === 0;
        const out: { label: string; value: string }[] = [];
        for (const x of ts) {
          if (x.regionCode) out.push({ label: `지역 카드 ${x.regionCode}`, value: x.regionCode });
          for (const l of x.lines) if (l.pickedQty + l.shortQty < l.plannedQty) out.push({ label: `위치 — 여기서 ${l.sku} ${l.plannedQty - l.pickedQty - l.shortQty}개 집기`, value: l.locationCode }, { label: `상품 ${l.sku} — ${l.plannedQty - l.pickedQty - l.shortQty}번 찍기`, value: l.sku });
        }
        return out.filter((c, i, a) => a.findIndex((y) => y.value === c.value) === i);
      };
      // 이 TRF 의 박스(LPN)
      // 남은 박스만(검품은 검품 전, 상차는 안 실은 것) — 다 보이면 카메라가 옆 QR 을 읽음(사용자 2026-11-26 "BOX-… QR 인식이 안돼")
      const lpnCodes = async (label: string, left: (x: { inspection?: string | null; loaded?: boolean }) => boolean = () => true) => {
        const r = await deps.gateway.call<{ items?: { lpn: string; inspection?: string | null; loaded?: boolean }[] }>('GET', `/cdcs/${CENTER_ID}/lpns`, { query: { trfId, size: '50' } });
        return (r.body.items ?? []).filter(left).map((x) => ({ label, value: x.lpn }));
      };
      const box = `BOX-${runId.toUpperCase()}-1`;
      // 분배·패킹 — 상품마다 [① 새 박스 → ② 상품] 짝으로(PDA 는 박스 먼저, 그다음 상품). 박스 자리에 상품 QR 을 찍어 박스 이름이 상품 코드가 되던 것(사용자 2026-11-27 "응")
      const boxBase = box.replace(/-1$/, '');
      const sortCodes = async () => {
        const t = await deps.internal.getTransferIntake(trfId);
        const left = t.progress.filter((x) => x.pickedQty > x.sortedQty);
        return left.flatMap((x, i) => [
          { label: `① 새 박스 ${i + 1} — PDA 가 "박스 스캔"일 때 먼저`, value: `${boxBase}-${i + 1}` },
          { label: `② 상품 ${x.sku} × ${x.pickedQty - x.sortedQty} — 박스 찍은 다음`, value: x.sku },
        ]);
      };
      // 검품 — 먼저 출고대기(91) 자리, 그다음 박스. 자리 = 집은 칸의 층·온도대 출고대기, MFC 자리 번호(PPC-01~05, 정본 CDC-5)
      const inspectCodes = async () => {
        const ts = await deps.backend.listTasks(wave.waveId).catch(() => []);
        const loc = ts.flatMap((x) => x.lines.map((l) => l.locationCode))[0];
        const mfcNo = Math.max(0, MFCS.findIndex((m) => m.id === (res?.intake.mfcId ?? opt.mfcId))) + 1;
        const stage = loc ? [{ label: '출고대기 자리(먼저)', value: stagingCodeFor(loc, mfcNo) }] : [];
        return [...stage, ...(await lpnCodes('검품할 박스', (x) => !x.inspection))];
      };
      await waitStage('PDA 피킹', 'DC 업무 → 피킹 → 다음 작업 받기 → 칸·상품 스캔', (t) => (sum(t, 'allocatedQty') > 0 && sum(t, 'pickedQty') >= sum(t, 'allocatedQty')) || (pickTasksDone && t.state !== 'IN_WAVE'), (t) => `집음 ${sum(t, 'pickedQty')}/${sum(t, 'allocatedQty')}`, pickCodes);
      await waitStage('PDA 분배·패킹', 'DC 업무 → 분배 → 박스(LPN) 닫기', (t) => sum(t, 'pickedQty') > 0 && sum(t, 'sortedQty') >= sum(t, 'pickedQty'), (t) => `박스에 담음 ${sum(t, 'sortedQty')}/${sum(t, 'pickedQty')}`, sortCodes);
      await waitStage('PDA 검품', 'DC 업무 → 검품 → 출고대기 박스 스캔', (t) => sum(t, 'sortedQty') > 0 && sum(t, 'inspectedQty') >= sum(t, 'sortedQty'), (t) => `합격 ${sum(t, 'inspectedQty')}/${sum(t, 'sortedQty')}`, inspectCodes);
      await step('PDA 상차 — 도크 스캔 → 운행 → 박스 스캔 → 상차완료', async () => {
        for (;;) {
          const trip = (await deps.gateway.call<{ state?: string; vehicleId?: string | null; plateNo?: string | null }>('GET', `/trips/${encodeURIComponent(tripId)}`)).body;
          const t = await deps.internal.getTransferIntake(trfId);
          const live = steps[steps.length - 1];
          live.detail = `도크 ${confirmed.dockCode ?? '-'} · 운행 ${tripId} ${trip.state ?? ''} · 실음 ${sum(t, 'loadedQty')}/${sum(t, 'inspectedQty')}`;
          live.trfId = trfId;
          // PDA 상차 = 도크 → 차량(차량 ID 나 번호판, 사용자 2026-11-26 "차량 번호 스캔하라는데 QR 이 없네") → 박스
          const veh = trip.vehicleId ?? confirmed.vehicleId;
          live.scan = [...(confirmed.dockCode ? [{ label: '도크', value: confirmed.dockCode }] : []), ...(veh ? [{ label: `차량${trip.plateNo ? ` ${trip.plateNo}` : ''}`, value: veh }] : []), ...(await lpnCodes('실을 박스', (x) => !x.loaded).catch(() => []))];
          onStep([...steps]);
          if (trip.state === 'LOADED' || trip.state === 'DEPARTED') {
            // 검품 합격분을 다 안 실었는데 상차완료됐으면 출차하지 않는다 — 출발은 한 번뿐이라 남은 박스는 미출발로 남음(사용자 2026-11-26 "박스 스캔 다 안 했는데 상차완료가 넘어갔어")
            const left = (await lpnCodes('', (x) => !x.loaded).catch(() => [])).map((x) => x.value);
            if (trip.state === 'LOADED' && left.length) throw new Error(`상차완료됐지만 안 실은 박스 ${left.length}개(${left.join(', ')}) — 출차하지 않음. 출발은 TRF 당 한 번이라 이대로 출차하면 남은 박스는 미출발로 남습니다`);
            return { v: trip, detail: `운행 ${trip.state} · 실음 ${sum(t, 'loadedQty')}개` };
          }
          if (Date.now() > until) throw new Error(`${opt.pdaWaitMin ?? 60}분 안에 상차완료가 안 됨 — 운행 ${trip.state}`);
          await wait(3000);
        }
      });
    } else {
      // 자동 — 시뮬레이터가 피킹·분류·검품·상차까지. 실을 차(배차)부터 확인 — 차가 없으면 집기 전에 멈춤(2026-11-27 T830694: 검품까지 하고 배차에서 막힘)
      const confirmedEarly: Order = res?.order && res.order.state !== 'PLANNING' ? res.order : await dispatch();
      // 이어 하기 — 이미 한 단계는 건너뜀(검품까지 끝나고 배차에서 멈췄던 TRF 를 이월·용차 뒤 다시, 2026-11-27 T830694)
      const t0 = await deps.internal.getTransferIntake(trfId);
      const q0 = (k: 'allocatedQty' | 'pickedQty' | 'sortedQty' | 'inspectedQty') => t0.progress.reduce((a, x) => a + x[k], 0);
      const pickedDone = q0('pickedQty') > 0 && q0('pickedQty') >= q0('allocatedQty');
      const sortedDone = q0('sortedQty') > 0 && q0('sortedQty') >= q0('pickedQty');
      const inspectedDone = q0('inspectedQty') > 0 && q0('inspectedQty') >= q0('sortedQty');
      const picked: { sku: string; lot: string; qty: number }[] = [];
      if (pickedDone) for (const tk of await deps.backend.listTasks(wave.waveId)) for (const l of tk.lines) if (l.pickedQty > 0) picked.push({ sku: l.sku, lot: l.lot, qty: l.pickedQty });
      if (!pickedDone) await step('피킹 (next-tasks → starts → pick-results)', async () => {
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
      // 상품(SKU·LOT)마다 박스 하나 — 섞인 박스는 MFC PDA 수령이 상품 수만큼 세어 막힘(mfc 시뮬 C-5, 2026-11-26). 온도대는 TRF 온도대
      const boxes = [...new Map(picked.map((p) => [`${p.sku}|${p.lot}`, { ...p, qty: picked.filter((x) => x.sku === p.sku && x.lot === p.lot).reduce((a, x) => a + x.qty, 0) }])).values()].map((p, i) => ({ lpn: `LPN-SIM-${runId.toUpperCase()}-${i + 1}`, contents: [p] }));
      const existing = sortedDone ? (await deps.gateway.call<{ items?: { lpn: string }[] }>('GET', `/cdcs/${CENTER_ID}/lpns`, { query: { trfId, size: '50' } })).body.items ?? [] : [];
      const lpnIds = sortedDone ? existing.map((x) => x.lpn) : boxes.map((b) => b.lpn);
      if (!sortedDone) await step(`분류 (sorting-results — 박스 ${boxes.length})`, async () => {
        const r = await deps.backend.reportSortingResult({ waveId: wave.waveId, trfId, workerId: worker, lpns: boxes.map((b) => ({ lpn: b.lpn, unitType: 'BOX' as const, state: 'SEALED' as const, temperatureZone: zone, contents: b.contents })) }, key('sort'));
        return { v: r, detail: `${lpnIds.join(', ')} · ${r.status}` };
      });
      if (!inspectedDone) await step('검품 (inspection-results — 합격)', async () => {
        const r = await deps.backend.reportInspectionResult({ trfId, inspectorId: worker, items: lpnIds.map((lpn) => ({ lpn, result: 'PASSED' as const })) }, key('inspect'));
        return { v: r, detail: `${r.status}` };
      });
      const confirmed = confirmedEarly;
      tripId = confirmed.orderId;
      await step('상차 실적 (loading-results)', async () => {
        const r = await deps.backend.reportLoadingResult({ trfId, tripId, vehicleId: confirmed.vehicleId ?? '', ...(confirmed.dockCode ? { dockCode: confirmed.dockCode } : {}), workerId: worker, action: 'LOADED', lpns: lpnIds.map((lpn) => ({ lpn })) }, key('load'));
        return { v: r, detail: `${r.status}` };
      });
      // 이어 하기로 이미 입차한 운행이면 건너뜀
      const tripState = (await deps.gateway.call<{ state?: string }>('GET', `/trips/${encodeURIComponent(tripId)}`).catch(() => null))?.body.state;
      if (!tripState || tripState === 'SCHEDULED') await checkIn(tripId);
      await step('상차완료 (trips loading-completions)', async () => {
        const r = await deps.gateway.call<{ state?: string }>('POST', `/trips/${encodeURIComponent(tripId)}/loading-completions`, { body: { transfers: [{ trfId, lpns: lpnIds, rtCount: 1 }] }, idempotencyKey: key('loaded') });
        return { v: r.body, detail: `${r.body.state ?? r.status}` };
      });
    }
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
