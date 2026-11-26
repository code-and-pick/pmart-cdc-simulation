// cdc-outbound-service.yaml 0.3.0(PR #452 — Task 경로 /cdcs/{cdcId}/tasks…, 다음 작업 받기·착수) 의 의미를 브라우저 안에서 흉내 내는 백엔드 [시뮬]. 실서버를 대신하지 않는다.
// 수량은 CdcLedger(cdc-inventory 역할)에만 둔다. 이 파일은 TRF·Wave·Task·LPN·출발의 상태와 계약 검증을 맡는다.
// 규칙 근거: WMS-business-logic.md 0.3(원장)·§12 CDC-F-016~018·§13 CDC-F-019~022.
// 계약에 없어 MOCK 이 정한 것은 docs/backend-requests.md "시뮬레이터가 정한 값"에 적는다.

import { ALLOCATION, CENTER_ID, MFCS, REGIONS, TASK } from '../../config';
import { pickMethodOf, pickModeOf } from '../../domain/pickMethod';
import {
  ApiProblem,
  type CommandResponse,
  type CreateWaveRequest,
  type DepartureValidation,
  type DepartureValidationRequest,
  type InspectionResultRequest,
  type LoadingResultRequest,
  type LpnComposition,
  type NextTaskRequest,
  type OutboundReadiness,
  type PickResultRequest,
  type PreDepartureCancellation,
  type PreDepartureCancelRequest,
  type ShipmentManifest,
  type SortingResultRequest,
  type PickMethod,
  type PickMode,
  type Region,
  type Task,
  type TaskLine,
  type TaskLineShare,
  type TaskState,
  type TemperatureZone,
  type TransferIntake,
  type TransferIntakeInput,
  type TransferIntakeState,
  type TransferProgressLine,
  type Wave,
  type WorkResult,
} from '../../domain/contract';
import type { Catalog } from '../../domain/catalog';
import { stagingCodeFor } from '../../domain/layout';
import type { ApiCallRecord, ApiListener, CdcOutboundPort, DomainEventRecord, EventListener } from '../port';
import { CdcLedger, isPalletLocation, isRackLocation, isShelfLocation, LedgerError } from './ledger';
import { DisplayNumbers } from '../../domain/displayNo';

interface TrfRec {
  intake: TransferIntake;
  body: string;
  cancelled: boolean;
  departed: boolean;
  /** 접수 순서 — Wave 편성 화면 정렬용 */
  seq: number;
}

interface LpnRec {
  trfId: string;
  comp: LpnComposition;
  inspection: 'PASSED' | 'FAILED' | null;
  loaded: { tripId: string; vehicleId: string; compartment?: string; sealNo?: string } | null;
}

interface IdemEntry {
  body: string;
  outcome: { ok: true; value: unknown } | { ok: false; problem: ApiProblem };
}

const problem = (status: number, code: string, detail?: string, retryable = false) => new ApiProblem({ status, code, detail, retryable });

/** Task 가 끝난 상태(남은 일 없음) — PARTIAL 은 MOCK 에서 "부족을 남기고 끝남" [시뮬] */
const TASK_TERMINAL: TaskState[] = ['DONE', 'PARTIAL', 'EXCEPTION', 'CANCELLED'];

export interface MockOptions {
  /** 시뮬레이션 시각(초, baseDate 자정 기준) */
  now: () => number;
  baseDate: string; // YYYY-MM-DD (Asia/Seoul)
  catalog: Catalog;
}

export class MockBackend implements CdcOutboundPort {
  readonly mode = 'mock' as const;
  /** 화면 번호(TRF T······ · Wave W···· · 작업 K·····) — 서버가 정하는 값을 흉내 [시뮬, 사용자 2026-11-26 "글자 + 숫자"]. 계약 필드가 생기면 응답에 싣는다 */
  readonly numbers = new DisplayNumbers();
  readonly ledger: CdcLedger;
  private readonly trfs = new Map<string, TrfRec>();
  private readonly waves = new Map<string, Wave>();
  private readonly tasks = new Map<string, Task>();
  private readonly lpns = new Map<string, LpnRec>();
  private readonly workResults = new Map<string, WorkResult>();
  private readonly departures = new Map<string, DepartureValidation>();
  private readonly manifests = new Map<string, ShipmentManifest>();
  private readonly cancellations = new Map<string, PreDepartureCancellation & { trfId: string }>();
  private readonly idem = new Map<string, IdemEntry>();
  private readonly apiListeners: ApiListener[] = [];
  private readonly eventListeners: EventListener[] = [];
  private seq = 0;

  /** 지역 ↔ MFC (0.9.0 regions) */
  private readonly regions = new Map<string, { regionCode: string; regionName: string }>(REGIONS.flatMap((r) => r.mfcIds.map((m) => [m, { regionCode: r.regionCode, regionName: r.regionName }] as const)));
  /** 작업 기한(몫 TRF 중 가장 이른 dueAt) */
  private readonly taskDue = new Map<string, string>();

  constructor(private readonly opt: MockOptions) {
    this.ledger = new CdcLedger({ cdcId: CENTER_ID, isoNow: () => this.iso(), today: () => this.today() });
    this.ledger.initialBalance(opt.catalog.skus.flatMap((s) => s.seed.map((l) => ({ sku: s.sku, ...l }))));
  }

  onApi(l: ApiListener) {
    this.apiListeners.push(l);
  }
  onEvent(l: EventListener) {
    this.eventListeners.push(l);
  }

  // ── 시각·식별자 ──────────────────────────────────────
  private iso(sec = this.opt.now()): string {
    return new Date(Date.parse(`${this.opt.baseDate}T00:00:00+09:00`) + sec * 1000).toISOString();
  }
  private today(): string {
    // 서울 날짜
    return new Date(Date.parse(`${this.opt.baseDate}T00:00:00+09:00`) + this.opt.now() * 1000 + 9 * 3600_000).toISOString().slice(0, 10);
  }
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(6, '0')}`;
  }
  private emit(type: string, summary: string) {
    const rec: DomainEventRecord = { at: this.opt.now(), type, summary };
    for (const l of this.eventListeners) l(rec);
  }

  /** 가상 HTTP 호출 기록. 원장 거절은 계약 오류로 바꿔 올린다. */
  private run<T>(method: 'GET' | 'POST', path: string, okStatus: number, fn: () => T, note?: string): T {
    const t0 = performance.now();
    const rec: ApiCallRecord = { at: this.opt.now(), method, path, status: okStatus, ms: 0, note };
    try {
      const v = (() => {
        try {
          return fn();
        } catch (e) {
          if (e instanceof LedgerError) throw problem(e.status, e.code, e.message);
          throw e;
        }
      })();
      rec.ms = performance.now() - t0;
      for (const l of this.apiListeners) l(rec);
      return v;
    } catch (e) {
      rec.ms = performance.now() - t0;
      if (e instanceof ApiProblem) {
        rec.status = e.problem.status;
        rec.code = e.problem.code;
      } else rec.status = 'ERR';
      for (const l of this.apiListeners) l(rec);
      throw e;
    }
  }
  private async call<T>(method: 'GET' | 'POST', path: string, okStatus: number, fn: () => T, note?: string): Promise<T> {
    return this.run(method, path, okStatus, fn, note);
  }

  /** 같은 Idempotency-Key · 같은 본문 = 기존 결과, 다른 본문 = 409 IDEMPOTENCY_CONFLICT. */
  private idempotent<T>(scope: string, key: string, body: unknown, fn: () => T): T {
    const k = `${scope}|${key}`;
    const b = JSON.stringify(body);
    const prev = this.idem.get(k);
    if (prev) {
      if (prev.body !== b) throw problem(409, 'IDEMPOTENCY_CONFLICT', '같은 키에 다른 본문');
      if (prev.outcome.ok) return structuredClone(prev.outcome.value) as T;
      throw prev.outcome.problem;
    }
    try {
      const v = fn();
      this.idem.set(k, { body: b, outcome: { ok: true, value: structuredClone(v) } });
      return v;
    } catch (e) {
      if (e instanceof ApiProblem && e.problem.status < 500) this.idem.set(k, { body: b, outcome: { ok: false, problem: e } });
      throw e;
    }
  }

  private mustTrf(trfId: string): TrfRec {
    const r = this.trfs.get(trfId);
    if (!r) throw problem(404, 'NOT_FOUND', `TRF 없음 ${trfId}`);
    return r;
  }
  private mustWave(waveId: string): Wave {
    const w = this.waves.get(waveId);
    if (!w) throw problem(404, 'NOT_FOUND', `Wave 없음 ${waveId}`);
    return w;
  }
  private mustTask(taskId: string): Task {
    const t = this.tasks.get(taskId);
    if (!t) throw problem(404, 'NOT_FOUND', `Task 없음 ${taskId}`);
    return t;
  }
  private checkVersion(current: number, expected?: number) {
    if (expected !== undefined && expected !== current) throw problem(409, 'VERSION_CONFLICT', `버전 ${current} ≠ 기대 ${expected}`);
  }
  private minDays(sku: string): number {
    const info = this.opt.catalog.bySku.get(sku);
    return ALLOCATION.minRemainingDays[info?.temp ?? 'AMBIENT'];
  }
  private mfcStagingNo(mfcId: string): number {
    const m = MFCS.find((x) => x.id === mfcId);
    if (!m) throw problem(422, 'VALIDATION_FAILED', `공급 대상이 아닌 MFC ${mfcId}`);
    return m.staging;
  }

  // ══ replenishment 역할 (실서버에서는 TransferApproved 를 cdc-outbound 가 소비) ══════

  /** POST /internal/transfer-intakes — 승인 TRF 인수 → 할당(cdc-inventory) 즉시 수행 [MOCK 은 동기] */
  intakeTransfer(body: TransferIntakeInput, idempotencyKey: string): CommandResponse {
    return this.run('POST', '/internal/transfer-intakes', 202, () =>
      this.idempotent('intake', idempotencyKey, body, () => {
        if (body.cdcId !== CENTER_ID) throw problem(422, 'VALIDATION_FAILED', `다른 센터 ${body.cdcId}`);
        this.mfcStagingNo(body.mfcId);
        if (!body.lines.length || body.lines.some((l) => l.approvedQty < 1)) throw problem(422, 'VALIDATION_FAILED', '승인 행 없음 또는 수량 < 1');
        if (new Set(body.lines.map((l) => l.sku)).size !== body.lines.length) throw problem(422, 'VALIDATION_FAILED', '같은 SKU 두 행');
        const b = JSON.stringify(body);
        const prev = this.trfs.get(body.trfId);
        if (prev) {
          if (prev.departed) throw problem(409, 'INVALID_STATE', '이미 출발한 TRF');
          if (body.trfVersion === prev.intake.trfVersion) {
            if (prev.body !== b) throw problem(409, 'TRANSFER_INTAKE_CONFLICT', '같은 버전 다른 본문');
            return { status: 'APPLIED', requestId: idempotencyKey, resultId: prev.intake.allocationId, version: prev.intake.version } satisfies CommandResponse;
          }
          if (body.trfVersion < prev.intake.trfVersion) throw problem(409, 'INVALID_STATE', `오래된 버전 ${body.trfVersion} < ${prev.intake.trfVersion}`);
          // 새 버전은 기존 인수를 대체 — MOCK 은 Wave 편성 전까지만 [시뮬]. 그 뒤는 미출발 취소·축소 경로
          if (prev.intake.waveId) throw problem(409, 'INVALID_STATE', 'Wave 편성 뒤 버전 변경 — 미출발 취소로 처리 [MOCK]');
          if (prev.intake.allocationId && this.ledger.heldQty(prev.intake.allocationId) > 0) this.ledger.release(prev.intake.allocationId, 'TRANSFER_CHANGED');
        }
        const intake: TransferIntake = { ...structuredClone(body), state: 'ALLOCATING', version: (prev?.intake.version ?? -1) + 1, progress: [] };
        const rec: TrfRec = { intake, body: b, cancelled: false, departed: false, seq: prev?.seq ?? this.trfs.size + 1 };
        this.trfs.set(body.trfId, rec);
        this.numbers.assign('TRF', body.trfId);
        const alloc = this.ledger.allocate(
          { trfId: body.trfId, trfVersion: body.trfVersion, lines: body.lines.map((l) => ({ sku: l.sku, requestedQty: l.approvedQty, minRemainingDays: this.minDays(l.sku) })) },
          ALLOCATION.safetyQty,
        );
        intake.allocationId = alloc.allocationId;
        intake.state = alloc.state === 'FAILED' ? 'ALLOCATION_FAILED' : alloc.state === 'PARTIAL' ? 'PARTIALLY_ALLOCATED' : 'ALLOCATED';
        const got = alloc.lines.reduce((s, l) => s + l.allocatedQty, 0);
        const want = alloc.lines.reduce((s, l) => s + l.requestedQty, 0);
        this.emit('AllocationResult', `${body.trfId} → ${body.mfcId} 할당 ${got}/${want} (${alloc.state})`);
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: alloc.allocationId, version: intake.version } satisfies CommandResponse;
      }),
    );
  }

  // ══ cdc-inbound 역할 — 선반 보충(MOV). 실서버 cdc-inventory move-postings 는 아직 501(백엔드 회신 2026-11-25) ══

  /** 아직 팔레트 랙에 있는 할당 예약 — 선반으로 보충해야 피킹할 수 있다 (MOCK 전용 조회, 보충 작업자가 본다) */
  private needsCache: { ver: number; at: number; out: { sku: string; lot: string; from: string; to: string; qty: number }[] } | null = null;
  /** maxAgeSec = 원장이 바뀌어도 이만큼(시뮬 초) 안이면 지난 계산을 써도 됨 — 시뮬·화면의 잦은 조회용. 기본 0(늘 최신) */
  replenishmentNeeds(maxAgeSec = 0): { sku: string; lot: string; from: string; to: string; qty: number }[] {
    // 원장이 그대로면 지난 계산을 돌려준다(보충 작업자·패널이 자주 부름 — 성능). 예약·취소·출발은 모두 원장 거래라 version 이 바뀐다
    const ver = this.ledger.version;
    // 원장이 그대로거나, 시뮬 시각 5초 안이면 지난 계산(보충 작업자 수십 명·알림·요약이 같은 순간 자주 부름 — 피킹마다 원장 version 이 올라 매번 다시 세던 것, 2026-11-26).
    // 조금 늦은 목록이어도 보충 작업자는 집기 직전 수량을 다시 보고(qty 0 이면 넘어감) 맡은 칸은 claimed 로 막는다
    const now = this.opt.now();
    if (this.needsCache && (this.needsCache.ver === ver || now - this.needsCache.at < maxAgeSec)) return this.needsCache.out.map((x) => ({ ...x }));
    const out = this.computeNeeds();
    this.needsCache = { ver, at: now, out };
    return out.map((x) => ({ ...x }));
  }

  private computeNeeds(): { sku: string; lot: string; from: string; to: string; qty: number }[] {
    const agg = new Map<string, { sku: string; lot: string; from: string; to: string; qty: number }>();
    for (const r of this.trfs.values()) {
      if (r.cancelled || r.departed || !r.intake.allocationId) continue;
      for (const h of this.ledger.holdingsOf(r.intake.allocationId)) {
        if (!isPalletLocation(h.locationCode)) continue;
        const to = this.opt.catalog.bySku.get(h.sku)?.shelf.code;
        if (!to) continue;
        const k = `${h.sku}|${h.lot}|${h.locationCode}`;
        const cur = agg.get(k) ?? { sku: h.sku, lot: h.lot, from: h.locationCode, to, qty: 0 };
        cur.qty += h.qty;
        agg.set(k, cur);
      }
    }
    return [...agg.values()].sort((a, b) => (a.from < b.from ? -1 : 1));
  }

  /** POST /internal/move-postings (MOV 팔레트 → 선반) — 예약이 있으면 함께 옮긴다. 총현물 불변 */
  replenishMove(body: { sku: string; lot: string; fromLocationCode: string; toLocationCode: string; qty: number; workerId: string }, idempotencyKey: string): CommandResponse {
    return this.run('POST', '/internal/move-postings', 200, () =>
      this.idempotent('move', idempotencyKey, body, () => {
        const c = this.ledger.replenishMove(body.sku, body.lot, body.fromLocationCode, body.toLocationCode, body.qty, `REPL:${body.workerId}`);
        // 새 박스를 진열했으니 그 선반 칸 차단(부족 보고)을 푼다 [시뮬 — 재계수를 대신함]
        this.ledger.blocked.delete(`${body.sku}|${body.lot}|${body.toLocationCode}`);
        for (const r of this.trfs.values()) this.spawnFollowUps(r);
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: c.commitId, appliedQty: body.qty } satisfies CommandResponse;
      }),
      'MOCK — 실서버 move-postings 501',
    );
  }

  /** 접수한 TRF 목록 (화면·Wave 편성용, MOCK 전용 조회) */
  listTransfers(): TransferIntake[] {
    // 작업·LPN 을 TRF 별로 한 번에 나눠 둔다(TRF 마다 전체를 다시 훑지 않게)
    const tb = new Map<string, Task[]>();
    for (const t of this.tasks.values()) for (const id of t.trfIds) (tb.get(id) ?? tb.set(id, []).get(id)!).push(t);
    const lb = new Map<string, LpnRec[]>();
    for (const l of this.lpns.values()) (lb.get(l.trfId) ?? lb.set(l.trfId, []).get(l.trfId)!).push(l);
    return [...this.trfs.values()].sort((a, b) => a.seq - b.seq).map((r) => this.view(r, tb.get(r.intake.trfId) ?? [], lb.get(r.intake.trfId) ?? []));
  }

  // ══ TMS 역할 (실서버에서는 transport-execution 이 TruckActuallyDeparted 로 부른다) ══════

  /** POST /internal/departure-validations — 출발 사실 ↔ 상차 LOADED 대조, 일치 TRF 만 TOUT 전기 */
  validateDeparture(body: DepartureValidationRequest, idempotencyKey: string): DepartureValidation {
    return this.run('POST', '/internal/departure-validations', 200, () =>
      this.idempotent('departure', idempotencyKey, body, () => {
        if (this.departures.has(body.departureId)) throw problem(409, 'DEPARTURE_ALREADY_VALIDATED', body.departureId);
        const out: DepartureValidation = {
          departureId: body.departureId,
          tripId: body.tripId,
          vehicleId: body.vehicleId,
          source: body.source,
          validatedAt: this.iso(),
          overallResult: 'MATCHED',
          transfers: [],
          mismatches: [],
        };
        for (const comp of body.trfCompositions) {
          const rec = this.trfs.get(comp.trfId);
          const before = out.mismatches.length;
          if (!rec) {
            out.mismatches.push({ kind: 'WRONG_TRF', trfId: comp.trfId, detail: '없는 TRF' });
          } else {
            if (rec.departed) out.mismatches.push({ kind: 'WRONG_TRF', trfId: comp.trfId, detail: '이미 출발한 TRF(1요청·1이관·1출발)' });
            if (rec.cancelled) out.mismatches.push({ kind: 'WRONG_TRF', trfId: comp.trfId, detail: '취소된 TRF' });
            if (comp.mfcId && comp.mfcId !== rec.intake.mfcId) out.mismatches.push({ kind: 'WRONG_MFC', trfId: comp.trfId, detail: `${comp.mfcId} ≠ ${rec.intake.mfcId}` });
            const loaded = new Set([...this.lpns.entries()].filter(([, l]) => l.trfId === comp.trfId && l.loaded?.tripId === body.tripId).map(([k]) => k));
            for (const lpn of comp.lpns) {
              const l = this.lpns.get(lpn);
              if (l && l.trfId !== comp.trfId) out.mismatches.push({ kind: 'WRONG_TRF', lpn, trfId: comp.trfId, detail: `${lpn} 은 ${l.trfId}` });
              else if (!loaded.has(lpn)) out.mismatches.push({ kind: 'LPN_NOT_LOADED', lpn, trfId: comp.trfId });
            }
            const listed = new Set(comp.lpns);
            for (const lpn of loaded) if (!listed.has(lpn)) out.mismatches.push({ kind: 'LPN_NOT_IN_DEPARTURE', lpn, trfId: comp.trfId });
            if (comp.sealNos) {
              for (const lpn of comp.lpns) {
                const s = this.lpns.get(lpn)?.loaded?.sealNo;
                if (s && !comp.sealNos.includes(s)) out.mismatches.push({ kind: 'SEAL_MISMATCH', lpn, trfId: comp.trfId, detail: s });
              }
            }
            if (!loaded.size && out.mismatches.length === before) out.mismatches.push({ kind: 'LPN_NOT_LOADED', trfId: comp.trfId, detail: '이 운행에 실린 LPN 없음' });
          }
          if (out.mismatches.length > before || !rec) {
            out.transfers.push({ trfId: comp.trfId, result: 'MISMATCHED', departedQty: 0, postingStatus: 'REJECTED' });
            continue;
          }
          out.transfers.push(this.postTransferDeparture(rec, body, comp.lpns));
        }
        const ok = out.transfers.filter((t) => t.result === 'MATCHED').length;
        out.overallResult = ok === out.transfers.length ? 'MATCHED' : ok === 0 ? 'MISMATCHED' : 'PARTIALLY_MATCHED';
        this.departures.set(body.departureId, out);
        this.emit('TruckDepartureValidated', `${body.vehicleId} ${body.departureId} ${out.overallResult} (TRF ${ok}/${out.transfers.length})`);
        if (out.mismatches.length) this.emit('OutboundDiscrepancyRaised', `${body.departureId} 불일치 ${out.mismatches.length}건`);
        return structuredClone(out);
      }),
    );
  }

  /** 한 TRF 출발 전기 + 매니페스트 + 잔량 정리 */
  private postTransferDeparture(rec: TrfRec, body: DepartureValidationRequest, lpnIds: string[]): DepartureValidation['transfers'][number] {
    const trfId = rec.intake.trfId;
    const allocationId = rec.intake.allocationId!;
    // LPN 내용(SKU·LOT) → 이 할당이 출고대기 칸에 잡은 예약에서 꺼낸다
    const want = new Map<string, number>();
    const comps = lpnIds.map((id) => this.lpns.get(id)!.comp);
    for (const c of comps) for (const x of c.contents) want.set(`${x.sku}|${x.lot}`, (want.get(`${x.sku}|${x.lot}`) ?? 0) + x.qty);
    const holds = this.ledger.holdingsOf(allocationId).filter((h) => !isRackLocation(h.locationCode));
    const lines: { departureLineId: string; sku: string; lot: string; locationCode: string; qty: number }[] = [];
    for (const [k, q] of want) {
      let need = q;
      const [sku, lot] = k.split('|');
      for (const h of holds.filter((x) => x.sku === sku && x.lot === lot)) {
        if (need <= 0) break;
        const take = Math.min(need, h.qty);
        lines.push({ departureLineId: `${body.departureId}-${trfId}-${lines.length + 1}`, sku, lot, locationCode: h.locationCode, qty: take });
        need -= take;
      }
      if (need > 0) throw problem(409, 'DEPARTURE_EXCEEDS_ALLOCATED', `${trfId} ${k} 실은 수량이 출고대기 예약보다 많다`);
    }
    const commit = this.ledger.postDeparture({ departureId: body.departureId, trfId, mfcId: rec.intake.mfcId, allocationId, departedAt: body.departedAt, lines });
    const departedQty = lines.reduce((s, l) => s + l.qty, 0);
    rec.departed = true;
    rec.intake.departureId = body.departureId;
    rec.intake.tripId = body.tripId;
    rec.intake.version += 1;
    const manifestId = this.id('SMF');
    rec.intake.shipmentManifestId = manifestId;
    const agg = new Map<string, number>();
    for (const l of lines) agg.set(`${l.sku}|${l.lot}`, (agg.get(`${l.sku}|${l.lot}`) ?? 0) + l.qty);
    this.manifests.set(trfId, {
      shipmentManifestId: manifestId,
      trfId,
      trfVersion: rec.intake.trfVersion,
      departureId: body.departureId,
      tripId: body.tripId,
      vehicleId: body.vehicleId,
      cdcId: CENTER_ID,
      mfcId: rec.intake.mfcId,
      departedAt: body.departedAt,
      lpns: structuredClone(comps),
      lines: [...agg.entries()].map(([k, qty]) => {
        const [sku, lot] = k.split('|');
        return { sku, lot, expiresAt: this.ledger.expiryOf(sku, lot), qty };
      }),
      issuedAt: this.iso(),
    });
    this.emit('TransferDeparted', `${trfId} → ${rec.intake.mfcId} 출발 ${departedQty} (CDC −${departedQty} · Transit +${departedQty})`);
    this.emit('TransferShipmentManifestIssued', `${trfId} ${manifestId}`);
    // 못 실은 잔량은 두 번째 차로 보내지 않는다(1요청·1이관·1출발) → replenishment 잔량 정리 [MOCK 은 바로]
    const residual = this.ledger.heldQty(allocationId);
    if (residual > 0) {
      this.ledger.release(allocationId, 'RESIDUAL_CLOSED');
      this.emit('TransferResidualClosed', `${trfId} 미출발 잔량 ${residual} 예약 해제`);
    }
    return { trfId, result: 'MATCHED', departedQty, postingStatus: 'APPLIED', commitId: commit.commitId, shipmentManifestId: manifestId };
  }

  // ══ 진행 계산 ═══════════════════════════════════════
  /** 진행(줄마다) — SKU 별 합을 한 번씩만 모은다(물량 30만: TRF 하나 250줄 × 작업 수천 개를 줄마다 다시 훑어 화면 요약이 프레임을 잡아먹던 것, 2026-11-26) */
  private progress(rec: TrfRec, tasks: Task[] = this.tasksOf(rec.intake.trfId), lpns: LpnRec[] = [...this.lpns.values()].filter((l) => l.trfId === rec.intake.trfId)): TransferProgressLine[] {
    const alloc = rec.intake.allocationId ? this.ledger.getAllocation(rec.intake.allocationId) : undefined;
    const trfId = rec.intake.trfId;
    const add = (m: Map<string, number>, k: string, q: number) => m.set(k, (m.get(k) ?? 0) + q);
    const picked = new Map<string, number>();
    for (const t of tasks) for (const x of t.lines) for (const sh of x.shares) if (sh.trfId === trfId) add(picked, x.sku, sh.pickedQty);
    const sorted = new Map<string, number>();
    const inspected = new Map<string, number>();
    const loaded = new Map<string, number>();
    for (const l of lpns)
      for (const c of l.comp.contents) {
        add(sorted, c.sku, c.qty);
        if (l.inspection === 'PASSED') add(inspected, c.sku, c.qty);
        if (l.loaded) add(loaded, c.sku, c.qty);
      }
    const al = new Map((alloc?.lines ?? []).map((x) => [x.sku, x] as const));
    return rec.intake.lines.map((l) => {
      const a = al.get(l.sku);
      return {
        sku: l.sku,
        approvedQty: l.approvedQty,
        allocatedQty: a ? a.allocatedQty - a.releasedQty + a.departedQty : 0,
        pickedQty: picked.get(l.sku) ?? 0,
        sortedQty: sorted.get(l.sku) ?? 0,
        inspectedQty: inspected.get(l.sku) ?? 0,
        loadedQty: loaded.get(l.sku) ?? 0,
        departedQty: a?.departedQty ?? 0,
      };
    });
  }

  private stateOf(rec: TrfRec, p: TransferProgressLine[]): TransferIntakeState {
    if (rec.departed) return 'DEPARTED';
    if (rec.cancelled) return 'CANCELLED';
    const base = rec.intake.state;
    if (!rec.intake.waveId) return base;
    const tasks = this.tasksOf(rec.intake.trfId);
    const done = tasks.length > 0 && tasks.every((t) => TASK_TERMINAL.includes(t.state));
    const tot = (f: keyof TransferProgressLine) => p.reduce((s, x) => s + (x[f] as number), 0);
    const picked = tot('pickedQty');
    if (!done || picked === 0) return 'IN_WAVE';
    if (tot('loadedQty') > 0 && tot('loadedQty') === tot('inspectedQty') && tot('inspectedQty') === picked) return 'LOADED';
    if (tot('inspectedQty') > 0 && tot('inspectedQty') === tot('sortedQty') && tot('sortedQty') === picked) return 'INSPECTED';
    if (tot('sortedQty') > 0 && tot('sortedQty') === picked) return 'SORTED';
    return 'PICKED';
  }

  private view(rec: TrfRec, tasks?: Task[], lpns?: LpnRec[]): TransferIntake {
    const p = this.progress(rec, tasks, lpns);
    return { ...structuredClone(rec.intake), state: this.stateOf(rec, p), progress: p, inventoryAsOf: { asOf: this.iso(), freshness: 'CURRENT' } };
  }

  private refreshWave(w: Wave) {
    const ts = [...this.tasks.values()].filter((t) => t.waveId === w.waveId);
    w.taskSummary = { total: ts.length, done: ts.filter((t) => t.state === 'DONE' || t.state === 'PARTIAL').length, exception: ts.filter((t) => t.state === 'EXCEPTION').length };
    const prev = w.state;
    // 첫 착수(IN_PROGRESS 이상) 때 RELEASED → IN_PROGRESS (0.2.0 startTask)
    if (w.state === 'RELEASED' && ts.some((t) => t.state !== 'CREATED' && t.state !== 'ACCEPTED' && t.state !== 'ASSIGNED')) w.state = 'IN_PROGRESS';
    if ((w.state === 'RELEASED' || w.state === 'IN_PROGRESS') && ts.length > 0 && ts.every((t) => TASK_TERMINAL.includes(t.state))) {
      w.state = ts.every((t) => t.state === 'CANCELLED') ? 'CANCELLED' : 'WORK_DONE';
    }
    if (w.state !== prev) {
      w.version += 1;
      this.emit('WaveStateChanged', `${w.waveId} ${prev} → ${w.state}`);
    }
  }

  // ══ CdcOutboundPort ════════════════════════════════
  async getTransferIntake(trfId: string): Promise<TransferIntake> {
    return this.call('GET', `/internal/transfer-intakes/${trfId}`, 200, () => this.view(this.mustTrf(trfId)));
  }

  async createWave(body: CreateWaveRequest, idempotencyKey: string): Promise<Wave> {
    return this.call('POST', '/waves', 201, () =>
      this.idempotent('wave', idempotencyKey, body, () => {
        if (body.cdcId !== CENTER_ID) throw problem(422, 'VALIDATION_FAILED', `다른 센터 ${body.cdcId}`);
        for (const id of body.trfIds) {
          const r = this.mustTrf(id);
          if (r.intake.waveId) throw problem(409, 'TRF_ALREADY_IN_WAVE', `${id} 는 ${r.intake.waveId}`);
          if (r.cancelled || r.departed || !(r.intake.state === 'ALLOCATED' || r.intake.state === 'PARTIALLY_ALLOCATED'))
            throw problem(409, 'INVALID_STATE', `미확보 TRF ${id} (${this.stateOf(r, this.progress(r))})`);
        }
        const w: Wave = {
          waveId: this.id('WAV'),
          cdcId: CENTER_ID,
          // 계약 태그 DRAFT→PLANNED — MOCK 은 편성 검증을 생성 때 끝내 PLANNED 로 만든다 [시뮬]
          state: 'PLANNED',
          version: 0,
          trfIds: [...body.trfIds],
          plannedDepartureWindow: body.plannedDepartureWindow,
          taskSummary: { total: 0, done: 0, exception: 0 },
          createdAt: this.iso(),
        };
        this.waves.set(w.waveId, w);
        this.numbers.assign('WAVE', w.waveId);
        for (const id of body.trfIds) {
          const r = this.trfs.get(id)!;
          r.intake.waveId = w.waveId;
          r.intake.version += 1;
        }
        this.emit('WaveStateChanged', `${w.waveId} 편성 TRF ${w.trfIds.length}건 → PLANNED`);
        return structuredClone(w);
      }),
    );
  }

  async getWave(waveId: string): Promise<Wave> {
    return this.call('GET', `/waves/${waveId}`, 200, () => structuredClone(this.mustWave(waveId)));
  }

  /** 지역 ↔ MFC 대응표 (0.9.0 listRegions) — 지역 코드 순 */
  async listRegions(cdcId: string): Promise<Region[]> {
    return this.call('GET', `/cdcs/${cdcId}/regions`, 200, () => this.regionTable());
  }

  /** MFC 의 지역 정하기 (0.9.0 setRegions) — 다음 Wave 릴리스부터 */
  async setRegions(cdcId: string, items: { mfcId: string; regionCode: string; regionName: string }[], idempotencyKey: string): Promise<Region[]> {
    return this.call('POST', `/cdcs/${cdcId}/regions`, 200, () =>
      this.idempotent(`regions:${cdcId}`, idempotencyKey, items, () => {
        if (cdcId !== CENTER_ID) throw problem(403, 'FORBIDDEN', `다른 센터 ${cdcId}`);
        if (!items.length || items.length > 200) throw problem(400, 'VALIDATION_FAILED', '1~200행');
        if (new Set(items.map((i) => i.mfcId)).size !== items.length) throw problem(400, 'VALIDATION_FAILED', '같은 MFC 두 번');
        for (const i of items) {
          if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(i.regionCode)) throw problem(400, 'VALIDATION_FAILED', `지역 코드 ${i.regionCode}`);
          this.regions.set(i.mfcId, { regionCode: i.regionCode, regionName: i.regionName });
        }
        return this.regionTable();
      }),
    );
  }

  private regionTable(): Region[] {
    const by = new Map<string, Region>();
    for (const [mfcId, r] of this.regions) (by.get(r.regionCode) ?? by.set(r.regionCode, { ...r, mfcIds: [] }).get(r.regionCode)!).mfcIds.push(mfcId);
    return [...by.values()].sort((a, b) => (a.regionCode < b.regionCode ? -1 : 1)).map((r) => ({ ...r, mfcIds: [...r.mfcIds].sort() }));
  }

  /** MFC 의 지역 코드(대응표에 없으면 MFC 자신) */
  regionOf(mfcId: string): string {
    return this.regions.get(mfcId)?.regionCode ?? mfcId;
  }

  /** PLANNED → RELEASED, 피킹 Task 생성 (0.9.0 묶음 피킹 — 위치 통로 방식으로 DISCRETE·REGION_BATCH·SKU_BATCH) */
  async releaseWave(waveId: string, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse> {
    return this.call('POST', `/waves/${waveId}/releases`, 202, () =>
      this.idempotent(`release:${waveId}`, idempotencyKey, { expectedVersion }, () => {
        const w = this.mustWave(waveId);
        this.checkVersion(w.version, expectedVersion);
        if (w.state !== 'PLANNED') throw problem(409, 'INVALID_STATE', `Wave ${w.state}`);
        // 피킹은 선반에서만 — 팔레트 랙에 남은 예약은 선반 보충(MOV) 뒤에 배포한다(CDC-F-017 "필요 내부 보충이 유효할 때 릴리스") [시뮬]
        const pending = w.trfIds.flatMap((id) => {
          const r = this.trfs.get(id)!;
          return r.cancelled ? [] : this.ledger.holdingsOf(r.intake.allocationId!).filter((h) => isPalletLocation(h.locationCode));
        });
        if (pending.length) throw problem(409, 'INVALID_STATE', `선반 보충 미완료 ${pending.length}칸 (${pending.reduce((a, h) => a + h.qty, 0)}개)`);
        const n = this.buildTasks(
          w.waveId,
          w.trfIds.filter((id) => !this.trfs.get(id)!.cancelled).map((id) => ({ trfId: id, holds: this.ledger.holdingsOf(this.trfs.get(id)!.intake.allocationId!).filter((h) => isShelfLocation(h.locationCode)) })),
        ).length;
        w.state = 'RELEASED';
        w.version += 1;
        w.releasedAt = this.iso();
        this.refreshWave(w);
        this.emit('WaveStateChanged', `${w.waveId} PLANNED → RELEASED (피킹 작업 ${n}개)`);
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: w.waveId, version: w.version } satisfies CommandResponse;
      }),
    );
  }

  /**
   * 피킹 Task 만들기 (0.9.0) — 위치마다 통로 방식(pickMethod)으로 묶는다:
   * DISCRETE = TRF × 방식 × 구역 × 층, REGION_BATCH = 지역 × 방식 × 구역 × 층, SKU_BATCH = 방식 × 구역 × 층(Wave 안 모든 TRF).
   * 같은 SKU·LOT·위치는 한 줄로 합치고 shares[] 에 TRF 별 몫. 줄은 위치 코드 순, TASK.maxLines 로 자른다(서버 batch-max-lines) [시뮬].
   */
  private buildTasks(waveId: string, per: { trfId: string; holds: { sku: string; lot: string; locationCode: string; qty: number }[] }[]): Task[] {
    type G = { mode: PickMode; method?: PickMethod; region: string | null; aisle: string | null; lines: Map<string, TaskLine> };
    const groups = new Map<string, G>();
    for (const { trfId, holds } of per) {
      const rec = this.trfs.get(trfId)!;
      const mfcId = rec.intake.mfcId;
      const region = this.regionOf(mfcId);
      for (const h of holds) {
        const [, zone, floor] = h.locationCode.split('-');
        const method = pickMethodOf(h.locationCode);
        const mode = pickModeOf(method);
        const aisle = method === 'DPS' ? h.locationCode.split('-')[3] : null;
        const k = mode === 'DISCRETE' ? `D|${trfId}|${method ?? ''}|${zone}|${floor}|${aisle ?? ''}` : mode === 'REGION_BATCH' ? `R|${region}|${method}|${zone}|${floor}` : `S|${method}|${zone}|${floor}`;
        const g = groups.get(k) ?? groups.set(k, { mode, method, region: mode === 'REGION_BATCH' ? region : null, aisle, lines: new Map() }).get(k)!;
        const lk = `${h.sku}|${h.lot}|${h.locationCode}`;
        const l = g.lines.get(lk) ?? g.lines.set(lk, { sku: h.sku, lot: h.lot, locationCode: h.locationCode, plannedQty: 0, pickedQty: 0, shortQty: 0, shares: [] }).get(lk)!;
        l.plannedQty += h.qty;
        const sh = l.shares.find((x) => x.trfId === trfId);
        if (sh) sh.plannedQty += h.qty;
        else l.shares.push({ trfId, mfcId, dueAt: rec.intake.dueAt, plannedQty: h.qty, pickedQty: 0, shortQty: 0 });
      }
    }
    const out: Task[] = [];
    for (const [, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const lines = [...g.lines.values()].sort((a, b) => (a.locationCode < b.locationCode ? -1 : 1));
      for (const l of lines) l.shares.sort((a, b) => (a.trfId < b.trfId ? -1 : 1));
      // 자르기: 줄 수(TASK.maxLines — 서버 batch-max-lines)
      const chunks: TaskLine[][] = [];
      for (let i = 0; i < lines.length; i += TASK.maxLines) chunks.push(lines.slice(i, i + TASK.maxLines));
      for (const ls of chunks) {
        const trfIds = [...new Set(ls.flatMap((l) => l.shares.map((x) => x.trfId)))].sort();
        const t: Task = {
          taskId: this.id('PICK'),
          waveId,
          trfId: g.mode === 'DISCRETE' ? trfIds[0] : null,
          trfIds,
          pickMode: g.mode,
          ...(g.method ? { pickMethod: g.method } : {}),
          regionCode: g.region,
          aisle: g.aisle,
          kind: 'PICK',
          state: 'CREATED',
          version: 0,
          lines: ls,
          createdAt: this.iso(),
        };
        this.tasks.set(t.taskId, t);
        this.numbers.assign('TASK', t.taskId);
        this.taskDue.set(t.taskId, ls.flatMap((l) => l.shares.map((x) => x.dueAt)).sort()[0]);
        out.push(t);
      }
    }
    return out;
  }

  /** 이 TRF 몫이 든 작업 */
  private tasksOf(trfId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.trfIds.includes(trfId));
  }

  async listTasks(waveId: string, filter: { state?: TaskState; assigneeId?: string } = {}): Promise<Task[]> {
    const q = new URLSearchParams({ waveId, ...(filter.state ? { state: filter.state } : {}), ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}) });
    return this.call('GET', `/cdcs/${CENTER_ID}/tasks?${q}`, 200, () =>
      [...this.tasks.values()]
        .filter((t) => t.waveId === waveId && (!filter.state || t.state === filter.state) && (!filter.assigneeId || t.assigneeId === filter.assigneeId))
        .map((t) => this.publicTask(t)),
    );
  }

  /** 작업 수·끝난 수 — 복사 없이(화면 요약이 자주 부름) */
  taskCounts(): { total: number; done: number } {
    let total = 0;
    let done = 0;
    for (const t of this.tasks.values()) {
      total++;
      if (t.state === 'DONE' || t.state === 'PARTIAL') done++;
    }
    return { total, done };
  }

  /** 시뮬레이터가 모든 Wave 의 작업을 한 번에 본다 (MOCK 전용 조회) */
  allTasks(): Task[] {
    return [...this.tasks.values()].map((t) => this.publicTask(t));
  }

  /** 조건에 맞는 작업만 복사해 본다 (MOCK 전용 조회 — 전부 복사하지 않게) */
  /** 조건에 맞는 작업이 하나라도 있나 — 복사하지 않는다(시뮬이 자주 부르는 확인용, 물량 30만에서 findTasks 복사가 시간 대부분이었음 2026-11-26) */
  anyTask(pred: (t: Readonly<Task>) => boolean): boolean {
    for (const t of this.tasks.values()) if (pred(t)) return true;
    return false;
  }

  findTasks(pred: (t: Task) => boolean): Task[] {
    const out: Task[] = [];
    for (const t of this.tasks.values()) if (pred(t)) out.push(this.publicTask(t));
    return out;
  }

  private publicTask(t: Task): Task {
    return structuredClone(t);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.call('GET', `/cdcs/${CENTER_ID}/tasks/${taskId}`, 200, () => this.publicTask(this.mustTask(taskId)));
  }

  /** 작업의 층·구역 — 같은 Task 의 줄은 모두 한 층·구역(배포 규칙) */
  private taskScope(t: Task): { floor: string; zone: string } {
    const [, zone, floor] = (t.lines[0]?.locationCode ?? '--').split('-');
    return { floor, zone };
  }

  /**
   * 다음 작업 받기 (0.2.0 pullNextTask) — 들고 있는 ACCEPTED·IN_PROGRESS 가 있으면 그것(200),
   * 없으면 RELEASED·IN_PROGRESS Wave 의 담당 없는 CREATED 작업 하나를 ACCEPTED 로 배정(201).
   * 순서: 작업 기한(몫 TRF 중 가장 이른 dueAt) 이른 순 → 만든 순. 근무·자격·온도대 검사는 계약대로 아직 하지 않는다.
   */
  async pullNextTask(cdcId: string, workerId: string, body: NextTaskRequest, idempotencyKey: string): Promise<{ status: 200 | 201; task: Task }> {
    return this.call('POST', `/cdcs/${cdcId}/workers/${workerId}/next-tasks`, 201, () =>
      this.idempotent(`next:${cdcId}:${workerId}`, idempotencyKey, body, () => {
        if (cdcId !== CENTER_ID) throw problem(403, 'FORBIDDEN', `다른 센터 ${cdcId}`);
        const held = [...this.tasks.values()].find((t) => t.assigneeId === workerId && (t.state === 'ACCEPTED' || t.state === 'IN_PROGRESS'));
        if (held) return { status: 200 as const, task: this.publicTask(held) };
        const cands = [...this.tasks.values()].filter((t) => {
          if (t.state !== 'CREATED' || t.assigneeId) return false;
          const w = this.waves.get(t.waveId);
          if (!w || (w.state !== 'RELEASED' && w.state !== 'IN_PROGRESS')) return false;
          if (!t.trfIds.some((id) => { const r = this.trfs.get(id); return r && !r.cancelled && !r.departed; })) return false;
          const sc = this.taskScope(t);
          return (!body.kind || t.kind === body.kind) && (!body.zone || sc.zone === body.zone) && (!body.floor || sc.floor === String(body.floor)) && (!body.pickMode || t.pickMode === body.pickMode) && (!body.aisles?.length || (!!t.aisle && body.aisles.includes(t.aisle)));
        });
        cands.sort((a, b) => {
          const da = this.taskDue.get(a.taskId)!;
          const db = this.taskDue.get(b.taskId)!;
          if (da !== db) return da < db ? -1 : 1;
          if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
          return a.taskId < b.taskId ? -1 : 1;
        });
        const t = cands[0];
        if (!t) throw problem(409, 'NO_TASK_AVAILABLE', '받을 작업 없음');
        t.assigneeId = workerId;
        t.state = 'ACCEPTED';
        t.version += 1;
        return { status: 201 as const, task: this.publicTask(t) };
      }),
    );
  }

  /** 착수 (0.2.0 startTask) — 담당만 ACCEPTED → IN_PROGRESS. workerId = 토큰 주체(MOCK 은 인자로 받는다). 이미 IN_PROGRESS 면 그대로 */
  async startTask(taskId: string, workerId: string, idempotencyKey: string, expectedVersion?: number): Promise<Task> {
    return this.call('POST', `/cdcs/${CENTER_ID}/tasks/${taskId}/starts`, 200, () =>
      this.idempotent(`start:${taskId}:${workerId}`, idempotencyKey, { expectedVersion }, () => {
        const t = this.mustTask(taskId);
        if (t.assigneeId !== workerId) throw problem(409, 'NOT_ASSIGNEE', `담당 ${t.assigneeId ?? '없음'}`);
        if (t.state === 'IN_PROGRESS') return this.publicTask(t);
        this.checkVersion(t.version, expectedVersion);
        if (t.state !== 'ACCEPTED') throw problem(409, 'INVALID_STATE', `Task ${t.state}`);
        t.state = 'IN_PROGRESS';
        t.version += 1;
        this.refreshWave(this.mustWave(t.waveId));
        return this.publicTask(t);
      }),
    );
  }

  /**
   * 실피킹 결과 — 실피킹 ≤ 유효할당. 피킹한 수량은 랙 칸 → 출고대기(91) 로 위치만 옮긴다(총현물 불변).
   * 부족은 그 칸 예약을 풀고(PICK_SHORTAGE) 다른 적격 LOT·칸으로 재할당해 새 Task 를 만든다. 못 하면 부족으로 남긴다.
   * (0.2.0) 담당(workerId = assigneeId)의 IN_PROGRESS 작업에만 — 아니면 409 NOT_ASSIGNEE / INVALID_STATE.
   */
  async reportPickResult(taskId: string, body: PickResultRequest, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse> {
    return this.call('POST', `/cdcs/${CENTER_ID}/tasks/${taskId}/pick-results`, 202, () =>
      this.idempotent(`pick:${taskId}`, idempotencyKey, { body, expectedVersion }, () => {
        const t = this.mustTask(taskId);
        this.checkVersion(t.version, expectedVersion);
        if (t.assigneeId !== body.workerId) throw problem(409, 'NOT_ASSIGNEE', `담당 ${t.assigneeId ?? '없음'}`);
        if (t.state !== 'IN_PROGRESS') throw problem(409, 'INVALID_STATE', `Task ${t.state} — 착수 뒤에만 실적`);
        if (!body.lines.length) throw problem(422, 'VALIDATION_FAILED', '행 없음');
        // 먼저 전부 검사
        for (const l of body.lines) {
          const tl = t.lines.find((x) => x.sku === l.sku && x.lot === l.lot && x.locationCode === l.locationCode);
          if (!tl) throw problem(409, 'INVALID_STATE', `지시에 없는 SKU·LOT·위치 ${l.sku}/${l.lot}/${l.locationCode}`);
          if (l.pickedQty < 0 || (l.shortQty ?? 0) < 0) throw problem(422, 'VALIDATION_FAILED', '음수 수량');
          if ((l.shortQty ?? 0) > 0 && !l.shortReason) throw problem(422, 'VALIDATION_FAILED', '부족 사유 없음');
          if (tl.pickedQty + tl.shortQty + l.pickedQty + (l.shortQty ?? 0) > tl.plannedQty)
            throw problem(409, 'PICK_EXCEEDS_ALLOCATION', `${l.sku} 지시 ${tl.plannedQty} 초과`);
          for (const sh of tl.shares) {
            const r = this.mustTrf(sh.trfId);
            if ((r.cancelled || r.departed) && sh.plannedQty - sh.pickedQty - sh.shortQty > 0) throw problem(409, 'INVALID_STATE', `TRF ${sh.trfId} ${r.cancelled ? '취소' : '출발'}`);
          }
        }
        let applied = 0;
        const touched = new Set<string>();
        for (const l of body.lines) {
          const tl = t.lines.find((x) => x.sku === l.sku && x.lot === l.lot && x.locationCode === l.locationCode)!;
          const left = (sh: TaskLineShare) => sh.plannedQty - sh.pickedQty - sh.shortQty;
          // 실피킹은 기한 이른 몫부터, 부족은 기한 늦은 몫부터(같으면 trfId 순) [0.9.0, 사용자 결정 §7-2]
          const early = [...tl.shares].sort((a, b) => (a.dueAt !== b.dueAt ? (a.dueAt < b.dueAt ? -1 : 1) : a.trfId < b.trfId ? -1 : 1));
          const short = l.shortQty ?? 0;
          const shortBy = new Map<TaskLineShare, number>();
          let sLeft = short;
          for (const sh of [...early].reverse()) {
            if (sLeft <= 0) break;
            const q = Math.min(sLeft, left(sh));
            if (q > 0) shortBy.set(sh, q);
            sLeft -= q;
          }
          let pLeft = l.pickedQty;
          for (const sh of early) {
            const q = Math.min(pLeft, left(sh) - (shortBy.get(sh) ?? 0));
            if (q <= 0) continue;
            const rec = this.mustTrf(sh.trfId);
            this.ledger.move(rec.intake.allocationId!, l.sku, l.lot, l.locationCode, stagingCodeFor(l.locationCode, this.mfcStagingNo(sh.mfcId)), q, taskId);
            sh.pickedQty += q;
            tl.pickedQty += q;
            applied += q;
            pLeft -= q;
            touched.add(sh.trfId);
          }
          for (const [sh, q] of shortBy) {
            const rec = this.mustTrf(sh.trfId);
            sh.shortQty += q;
            tl.shortQty += q;
            tl.shortReason = l.shortReason;
            this.ledger.release(rec.intake.allocationId!, 'PICK_SHORTAGE', [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, qty: q }]);
            // 현물은 지우지 않는다(차이 보고 ≠ 손실). 재계수 전까지 그 칸을 새 할당에서 뺀다
            this.ledger.blocked.add(`${l.sku}|${l.lot}|${l.locationCode}`);
            const re = this.ledger.reallocate(rec.intake.allocationId!, l.sku, q, this.minDays(l.sku), ALLOCATION.safetyQty);
            const got = re.reduce((s, x) => s + x.qty, 0);
            this.emit('PickShortageReported', `${sh.trfId} ${l.sku} 부족 ${q} (${l.shortReason}) → 재할당 ${got}${got < q ? ` · 남은 부족 ${q - got}` : ''}`);
            touched.add(sh.trfId);
          }
        }
        const resolved = t.lines.every((x) => x.pickedQty + x.shortQty === x.plannedQty);
        t.state = resolved ? (t.lines.some((x) => x.shortQty > 0) ? 'PARTIAL' : 'DONE') : 'IN_PROGRESS';
        if (resolved) t.completedAt = this.iso();
        t.version += 1;
        // 재할당분이 선반에 있으면 바로 새 Task, 팔레트에 있으면 선반 보충 뒤에(replenishMove) 생긴다
        for (const id of touched) this.spawnFollowUps(this.mustTrf(id));
        this.refreshWave(this.mustWave(t.waveId));
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: taskId, appliedQty: applied, version: t.version } satisfies CommandResponse;
      }),
    );
  }

  /**
   * 배포된 TRF 의 선반 예약 중 아직 Task 가 없는 몫으로 새 피킹 Task 를 만든다(같은 층·구역끼리, 원 Task 는 그대로).
   * 불변식: 선반 예약 = 끝나지 않은 Task 줄의 남은 지시량 합.
   */
  private spawnFollowUps(rec: TrfRec) {
    const w = rec.intake.waveId ? this.waves.get(rec.intake.waveId) : undefined;
    if (!w || w.state === 'PLANNED' || w.state === 'CANCELLED' || rec.cancelled || rec.departed) return;
    const open = new Map<string, number>();
    for (const t of this.tasksOf(rec.intake.trfId)) {
      if (TASK_TERMINAL.includes(t.state)) continue;
      for (const l of t.lines) for (const sh of l.shares) if (sh.trfId === rec.intake.trfId) open.set(`${l.sku}|${l.lot}|${l.locationCode}`, (open.get(`${l.sku}|${l.lot}|${l.locationCode}`) ?? 0) + sh.plannedQty - sh.pickedQty - sh.shortQty);
    }
    const extra = this.ledger
      .holdingsOf(rec.intake.allocationId!)
      .filter((h) => isShelfLocation(h.locationCode))
      .map((h) => ({ ...h, qty: h.qty - (open.get(`${h.sku}|${h.lot}|${h.locationCode}`) ?? 0) }))
      .filter((h) => h.qty > 0);
    if (!extra.length) return;
    this.buildTasks(w.waveId, [{ trfId: rec.intake.trfId, holds: extra }]);
    if (w.state === 'WORK_DONE') {
      w.state = 'IN_PROGRESS';
      w.version += 1;
      this.emit('WaveStateChanged', `${w.waveId} WORK_DONE → IN_PROGRESS (재할당 작업)`);
    }
    this.refreshWave(w);
  }

  // ── 분류·검품·상차 (시뮬레이터 = 가상 수행 모듈) ─────────────
  private workResult(kind: WorkResult['kind'], trfId: string): WorkResult {
    const w: WorkResult = { workResultId: this.id('WR'), kind, trfId, status: 'APPLIED', recordedAt: this.iso() };
    this.workResults.set(w.workResultId, w);
    return w;
  }

  private pickedBySkuLot(trfId: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const t of this.tasksOf(trfId)) for (const l of t.lines) for (const sh of l.shares) if (sh.trfId === trfId) m.set(`${l.sku}|${l.lot}`, (m.get(`${l.sku}|${l.lot}`) ?? 0) + sh.pickedQty);
    return m;
  }

  /** 분류 ≤ 실피킹 (SKU·LOT 별). 한 LPN 은 한 TRF. PLT 의 contents 는 직접 담은 것만(하위 BOX 를 두 번 세지 않는다) */
  async reportSortingResult(body: SortingResultRequest, idempotencyKey: string): Promise<CommandResponse> {
    return this.call('POST', '/sorting-results', 202, () =>
      this.idempotent('sorting', idempotencyKey, body, () => {
        const rec = this.mustTrf(body.trfId);
        if (rec.intake.waveId !== body.waveId) throw problem(409, 'INVALID_STATE', `TRF 가 이 Wave 에 없다 (${rec.intake.waveId ?? '없음'})`);
        if (rec.cancelled || rec.departed) throw problem(409, 'INVALID_STATE', 'TRF 종료');
        const ids = new Set<string>();
        for (const c of body.lpns) {
          if (this.lpns.has(c.lpn) || ids.has(c.lpn)) throw problem(409, 'LPN_ALREADY_SEALED', c.lpn);
          ids.add(c.lpn);
          if (!c.contents.length && c.unitType === 'BOX') throw problem(422, 'VALIDATION_FAILED', `${c.lpn} 빈 BOX`);
          if (c.parentLpn) {
            const p = this.lpns.get(c.parentLpn) ?? (body.lpns.find((x) => x.lpn === c.parentLpn) ? { trfId: body.trfId, comp: body.lpns.find((x) => x.lpn === c.parentLpn)! } : undefined);
            if (!p || p.comp.unitType !== 'PLT' || p.trfId !== body.trfId) throw problem(422, 'VALIDATION_FAILED', `${c.lpn} 의 부모 ${c.parentLpn} 가 같은 TRF 의 PLT 가 아니다`);
          }
        }
        const picked = this.pickedBySkuLot(body.trfId);
        const sorted = new Map<string, number>();
        for (const l of this.lpns.values()) if (l.trfId === body.trfId) for (const x of l.comp.contents) sorted.set(`${x.sku}|${x.lot}`, (sorted.get(`${x.sku}|${x.lot}`) ?? 0) + x.qty);
        for (const c of body.lpns) for (const x of c.contents) sorted.set(`${x.sku}|${x.lot}`, (sorted.get(`${x.sku}|${x.lot}`) ?? 0) + x.qty);
        for (const [k, q] of sorted) if (q > (picked.get(k) ?? 0)) throw problem(409, 'SORT_EXCEEDS_PICKED', `${k} 분류 ${q} > 실피킹 ${picked.get(k) ?? 0}`);
        for (const c of body.lpns) this.lpns.set(c.lpn, { trfId: body.trfId, comp: structuredClone(c), inspection: null, loaded: null });
        const w = this.workResult('SORTING', body.trfId);
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: w.workResultId, appliedQty: body.lpns.reduce((s, c) => s + c.contents.reduce((a, x) => a + x.qty, 0), 0) } satisfies CommandResponse;
      }),
    );
  }

  async reportInspectionResult(body: InspectionResultRequest, idempotencyKey: string): Promise<CommandResponse> {
    return this.call('POST', '/inspection-results', 202, () =>
      this.idempotent('inspection', idempotencyKey, body, () => {
        const rec = this.mustTrf(body.trfId);
        if (rec.cancelled || rec.departed) throw problem(409, 'INVALID_STATE', 'TRF 종료');
        for (const it of body.items) {
          const l = this.lpns.get(it.lpn);
          if (!l) throw problem(404, 'NOT_FOUND', `LPN 없음 ${it.lpn}`);
          if (l.trfId !== body.trfId) throw problem(409, 'INVALID_STATE', `${it.lpn} 은 ${l.trfId} 의 LPN`);
          if (l.loaded) throw problem(409, 'INVALID_STATE', `${it.lpn} 상차됨 — 하차 뒤 재검품`);
          if (l.inspection === 'PASSED' && it.result === 'PASSED') throw problem(409, 'INVALID_STATE', `${it.lpn} 이미 합격`);
          if (it.result === 'FAILED' && !it.failReason) throw problem(422, 'VALIDATION_FAILED', `${it.lpn} 불합격 사유 없음`);
        }
        for (const it of body.items) this.lpns.get(it.lpn)!.inspection = it.result;
        const w = this.workResult('INSPECTION', body.trfId);
        const failed = body.items.filter((i) => i.result === 'FAILED').length;
        if (failed) this.emit('OutboundDiscrepancyRaised', `${body.trfId} 검품 불합격 ${failed} LPN`);
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: w.workResultId } satisfies CommandResponse;
      }),
    );
  }

  /** 상차 ≤ 검품합격. LOADED ≠ 출발 — 수량 전기 없음 */
  async reportLoadingResult(body: LoadingResultRequest, idempotencyKey: string): Promise<CommandResponse> {
    return this.call('POST', '/loading-results', 202, () =>
      this.idempotent('loading', idempotencyKey, body, () => {
        const rec = this.mustTrf(body.trfId);
        if (rec.departed) throw problem(409, 'INVALID_STATE', '이미 출발');
        if (body.action === 'LOADED') {
          if (rec.cancelled) throw problem(409, 'INVALID_STATE', '취소된 TRF');
          if (rec.intake.tripId && rec.intake.tripId !== body.tripId) throw problem(409, 'TRIP_MISMATCH', `${rec.intake.trfId} 는 운행 ${rec.intake.tripId}`);
        }
        for (const x of body.lpns) {
          const l = this.lpns.get(x.lpn);
          if (!l) throw problem(404, 'NOT_FOUND', `LPN 없음 ${x.lpn}`);
          if (l.trfId !== body.trfId) throw problem(409, 'INVALID_STATE', `${x.lpn} 은 ${l.trfId} 의 LPN`);
          if (body.action === 'LOADED') {
            if (l.inspection !== 'PASSED') throw problem(409, 'LPN_NOT_PASSED', x.lpn);
            if (l.loaded) throw problem(409, 'INVALID_STATE', `${x.lpn} 이미 상차`);
          } else if (!l.loaded || l.loaded.tripId !== body.tripId) throw problem(409, 'INVALID_STATE', `${x.lpn} 이 운행에 실려 있지 않다`);
        }
        for (const x of body.lpns) {
          const l = this.lpns.get(x.lpn)!;
          l.loaded = body.action === 'LOADED' ? { tripId: body.tripId, vehicleId: body.vehicleId, compartment: x.compartment, sealNo: x.sealNo } : null;
        }
        if (body.action === 'LOADED') rec.intake.tripId = body.tripId;
        else if (![...this.lpns.values()].some((l) => l.trfId === body.trfId && l.loaded)) {
          delete rec.intake.tripId;
          this.applyPendingCancellations(body.trfId);
        }
        rec.intake.version += 1;
        const w = this.workResult('LOADING', body.trfId);
        return { status: 'APPLIED', requestId: idempotencyKey, resultId: w.workResultId, version: rec.intake.version } satisfies CommandResponse;
      }),
    );
  }

  async getWorkResult(workResultId: string): Promise<WorkResult> {
    return this.call('GET', `/work-results/${workResultId}`, 200, () => {
      const w = this.workResults.get(workResultId);
      if (!w) throw problem(404, 'NOT_FOUND', workResultId);
      return structuredClone(w);
    });
  }

  // ── 미출발 취소·축소 ──────────────────────────────
  async cancelBeforeDeparture(trfId: string, body: PreDepartureCancelRequest, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse> {
    return this.call('POST', `/transfers/${trfId}/pre-departure-cancellations`, 202, () =>
      this.idempotent(`cancel:${trfId}`, idempotencyKey, { body, expectedVersion }, () => {
        const rec = this.mustTrf(trfId);
        this.checkVersion(rec.intake.version, expectedVersion);
        if (rec.departed) throw problem(409, 'INVALID_STATE', '실제 출발 후 — 취소 불가');
        if (rec.cancelled) throw problem(409, 'INVALID_STATE', '이미 취소');
        const c: PreDepartureCancellation & { trfId: string; scope: 'FULL' | 'PARTIAL'; lines?: PreDepartureCancelRequest['lines'] } = {
          requestId: this.id('PDC'),
          trfId,
          state: 'PENDING',
          releasedQty: 0,
          unloadedLpns: [],
          reason: body.reason,
          scope: body.scope,
          lines: body.lines,
        };
        this.cancellations.set(c.requestId, c);
        if (body.scope === 'PARTIAL') {
          // MOCK 은 배포 전 축소만 [시뮬] — 배포 뒤 축소는 작업 버전 재발행이 필요해 거절
          const released = this.tasksOf(trfId).length > 0;
          if (released || !body.lines?.length) {
            c.state = 'REJECTED';
            c.reason = released ? 'MOCK: 작업 배포 뒤 부분 축소 미지원' : '축소 행 없음';
          } else {
            try {
              const commit = this.ledger.release(rec.intake.allocationId!, 'PRE_DEPARTURE_CANCEL', body.lines.map((l) => ({ sku: l.sku, qty: l.reduceQty })));
              c.state = 'APPLIED';
              c.releasedQty = body.lines.reduce((s, l) => s + l.reduceQty, 0);
              c.releaseCommitId = commit.commitId;
            } catch (e) {
              c.state = 'REJECTED';
              c.reason = e instanceof Error ? e.message : String(e);
            }
          }
        } else this.applyPendingCancellations(trfId);
        rec.intake.version += 1;
        return { status: c.state === 'APPLIED' ? 'APPLIED' : c.state === 'REJECTED' ? 'REJECTED' : 'ACCEPTED', requestId: idempotencyKey, resultId: c.requestId, version: rec.intake.version, nextAction: c.state === 'PENDING' ? 'QUERY_RESULT' : undefined } satisfies CommandResponse;
      }),
    );
  }

  /** 상차된 LPN 이 모두 내려오면 전량 취소를 반영 — 예약 해제, 남은 Task 취소 */
  private applyPendingCancellations(trfId: string) {
    const rec = this.trfs.get(trfId)!;
    const pend = [...this.cancellations.values()].filter((c) => c.trfId === trfId && c.state === 'PENDING');
    if (!pend.length) return;
    if ([...this.lpns.values()].some((l) => l.trfId === trfId && l.loaded)) return; // 하차(UNLOADED) 기다림
    const held = rec.intake.allocationId ? this.ledger.heldQty(rec.intake.allocationId) : 0;
    const commit = held > 0 ? this.ledger.release(rec.intake.allocationId!, 'PRE_DEPARTURE_CANCEL') : undefined;
    for (const t of this.tasksOf(trfId)) {
      if (TASK_TERMINAL.includes(t.state)) continue;
      // 묶음 작업이면 그 TRF 남은 몫만 뺀다 — 다른 TRF 몫이 남으면 작업은 그대로 [시뮬]
      for (const l of t.lines)
        for (const sh of l.shares)
          if (sh.trfId === trfId) {
            const left = sh.plannedQty - sh.pickedQty - sh.shortQty;
            sh.plannedQty -= left;
            l.plannedQty -= left;
          }
      const resolved = t.lines.every((x) => x.pickedQty + x.shortQty === x.plannedQty);
      if (resolved) t.state = t.lines.some((x) => x.pickedQty > 0) ? (t.lines.some((x) => x.shortQty > 0) ? 'PARTIAL' : 'DONE') : 'CANCELLED';
      t.version += 1;
    }
    rec.cancelled = true;
    rec.intake.version += 1;
    const unloaded = [...this.lpns.entries()].filter(([, l]) => l.trfId === trfId).map(([k]) => k);
    for (const c of pend) {
      c.state = 'APPLIED';
      c.releasedQty = held;
      c.releaseCommitId = commit?.commitId;
      c.unloadedLpns = unloaded;
    }
    if (rec.intake.waveId) this.refreshWave(this.mustWave(rec.intake.waveId));
    this.emit('TransferCancelled', `${trfId} 미출발 취소 — 예약 해제 ${held}`);
  }

  async getPreDepartureCancellation(trfId: string, requestId: string): Promise<PreDepartureCancellation> {
    return this.call('GET', `/transfers/${trfId}/pre-departure-cancellations/${requestId}`, 200, () => {
      const c = this.cancellations.get(requestId);
      if (!c || c.trfId !== trfId) throw problem(404, 'NOT_FOUND', requestId);
      const { requestId: rid, state, releasedQty, unloadedLpns, releaseCommitId, reason } = c;
      return structuredClone({ requestId: rid, state, releasedQty, unloadedLpns, releaseCommitId, reason });
    });
  }

  // ── 조회 ─────────────────────────────────────────
  async getOutboundReadiness(trfId: string): Promise<OutboundReadiness> {
    return this.call('GET', `/internal/outbound-readiness?trfId=${trfId}`, 200, () => {
      const rec = this.mustTrf(trfId);
      const v = this.view(rec);
      const ready = [...this.lpns.values()].filter((l) => l.trfId === trfId && l.inspection === 'PASSED');
      const readiness: OutboundReadiness['readiness'] =
        v.state === 'DEPARTED' ? 'DEPARTED' : v.state === 'CANCELLED' ? 'CANCELLED' : v.state === 'LOADED' ? 'LOADED' : v.state === 'INSPECTED' ? 'INSPECTED' : v.state === 'SORTED' ? 'SORTED' : v.state === 'IN_WAVE' || v.state === 'PICKED' ? 'PICKING' : 'NOT_STARTED';
      const blockers: string[] = [];
      const open = [...this.tasks.values()].filter((t) => t.trfId === trfId && !TASK_TERMINAL.includes(t.state)).length;
      if (open) blockers.push(`피킹 작업 ${open}개 진행 중`);
      const failed = [...this.lpns.values()].filter((l) => l.trfId === trfId && l.inspection === 'FAILED').length;
      if (failed) blockers.push(`검품 불합격 LPN ${failed}`);
      const unsorted = v.progress.reduce((s, p) => s + p.pickedQty - p.sortedQty, 0);
      if (unsorted > 0) blockers.push(`미분류 ${unsorted}`);
      const temps = new Set<TemperatureZone>();
      for (const l of ready) for (const c of l.comp.contents) temps.add(this.opt.catalog.bySku.get(c.sku)?.temp ?? 'AMBIENT');
      return {
        trfId,
        asOf: { asOf: this.iso(), freshness: 'CURRENT' },
        readiness,
        readyLpnCount: ready.length,
        readyQty: ready.reduce((s, l) => s + l.comp.contents.reduce((a, c) => a + c.qty, 0), 0),
        totalWeightG: ready.reduce((s, l) => s + (l.comp.weightG ?? 0), 0),
        temperatureZones: [...temps],
        earliestReadyAt: null,
        blockers,
      };
    });
  }

  async getShipmentManifest(trfId: string): Promise<ShipmentManifest> {
    return this.call('GET', `/internal/shipment-manifests/${trfId}`, 200, () => {
      this.mustTrf(trfId);
      const m = this.manifests.get(trfId);
      if (!m) throw problem(404, 'NOT_DEPARTED', `${trfId} 아직 출발 검증 전`);
      return structuredClone(m);
    });
  }

  getDepartureValidation(departureId: string): DepartureValidation | undefined {
    const d = this.departures.get(departureId);
    return d && structuredClone(d);
  }
}
