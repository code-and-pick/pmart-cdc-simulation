// TMS 계약(fleet 0.1.0 · transport-planning 0.1.0 · transport-execution 0.1.0) 의미를 흉내 내는 MOCK [시뮬]. 실서버를 대신하지 않는다.
// 업무 근거: TMS-business-logic.md 2.2 (정규차 고정 노선 × 온도대 운송지시서, 혼적 금지, 멀티드롭 ≤3·방문 역순 상차,
//   출차 = max(23:00, 첫 도착 목표 − 주행), 하차 30분·MFC 동시 3대, 도착 ≠ 인계, 상차완료만으로 출차하지 않음).
// 출발 기록(recordDeparture)은 TruckActuallyDeparted 를 내고, cdc-outbound 가 그것을 소비해 출발 검증(departure-validations)을 한다 —
// MOCK 에서는 MockBackend.validateDeparture 를 바로 부른다. 계약 공백은 docs/backend-requests.md R-14·R-15.

import { CENTER_ID, TMS } from '../../config';
import {
  ApiProblem,
  type Departure,
  type DepartureInput,
  type DepartureValidation,
  type Driver,
  type Handover,
  type HandoverInput,
  type PreDepartureCheckInput,
  type StopEventInput,
  type TemperatureZone,
  type TransferIntake,
  type Trip,
  type Vehicle,
} from '../../domain/contract';
import { trfTemp } from '../../sim/supply';
import type { ApiCallRecord, ApiListener, DomainEventRecord, EventListener } from '../port';
import type { MockBackend } from './MockBackend';

const problem = (status: number, code: string, detail?: string) => new ApiProblem({ status, code, detail });

/** 시뮬레이터가 보는 운행 계획(계약 Trip 밖의 계획 시각) — 분 단위, D일 0시 = 0 [TMS §19.2] */
export interface TripPlan {
  tripId: string;
  routeId: string;
  region: string;
  temp: TemperatureZone;
  vehicleId: string;
  driverId: string;
  plannedDepartMin: number;
  /** 정차별 계획 도착(분) */
  plannedArriveMin: number[];
  plannedReturnMin: number;
  /** 정차 순서대로 MFC 와 TRF */
  stops: { mfcId: string; trfIds: string[] }[];
}

export interface MockTmsOptions {
  now: () => number;
  baseDate: string;
  outbound: MockBackend;
}

const TEMP_CODE: Record<TemperatureZone, string> = { AMBIENT: 'A', CHILLED: 'C', FROZEN: 'F' };

export class MockTms {
  readonly vehicles: Vehicle[] = [];
  readonly drivers: Driver[] = [];
  private readonly trips = new Map<string, Trip>();
  readonly plans = new Map<string, TripPlan>();
  private readonly handovers = new Map<string, Handover>();
  private readonly idem = new Map<string, { body: string; value: unknown }>();
  private readonly apiListeners: ApiListener[] = [];
  private readonly eventListeners: EventListener[] = [];
  private seq = 0;

  constructor(private readonly opt: MockTmsOptions) {
    // 정규차: 노선 × 온도대 한 대씩 [시뮬 — fleet 등록 API 없음(R-14)]
    let n = 0;
    for (const r of TMS.routes) {
      for (const temp of ['AMBIENT', 'CHILLED', 'FROZEN'] as const) {
        n += 1;
        const no = String(n).padStart(2, '0');
        this.vehicles.push({
          vehicleId: `VH-${no}`,
          plateNo: `칠곡-5T-${no}${TEMP_CODE[temp]}`,
          vehicleClass: TMS.vehicle.vehicleClass,
          status: 'AVAILABLE',
          version: 0,
          depot: CENTER_ID,
          maxWeightKg: TMS.vehicle.maxWeightKg,
          compartments: [{ compartmentId: `${`VH-${no}`}-1`, tempClass: temp }],
          maxRt: TMS.vehicle.maxRt,
        });
        this.drivers.push({ driverId: `DR-${no}`, displayName: TMS.driverNames[(n - 1) % TMS.driverNames.length], status: 'AVAILABLE', homeDepot: CENTER_ID });
        void r;
      }
    }
  }

  onApi(l: ApiListener) {
    this.apiListeners.push(l);
  }
  onEvent(l: EventListener) {
    this.eventListeners.push(l);
  }

  private iso(sec = this.opt.now()): string {
    return new Date(Date.parse(`${this.opt.baseDate}T00:00:00+09:00`) + sec * 1000).toISOString();
  }
  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(5, '0')}`;
  }
  private emit(type: string, summary: string) {
    const rec: DomainEventRecord = { at: this.opt.now(), type, summary };
    for (const l of this.eventListeners) l(rec);
  }
  private run<T>(method: 'GET' | 'POST', path: string, ok: number, fn: () => T): T {
    const rec: ApiCallRecord = { at: this.opt.now(), method, path, status: ok, ms: 0 };
    try {
      const v = fn();
      for (const l of this.apiListeners) l(rec);
      return v;
    } catch (e) {
      if (e instanceof ApiProblem) {
        rec.status = e.problem.status;
        rec.code = e.problem.code;
      } else rec.status = 'ERR';
      for (const l of this.apiListeners) l(rec);
      throw e;
    }
  }
  private idempotent<T>(scope: string, key: string, body: unknown, fn: () => T): T {
    const k = `${scope}|${key}`;
    const b = JSON.stringify(body);
    const prev = this.idem.get(k);
    if (prev) {
      if (prev.body !== b) throw problem(409, 'IDEMPOTENCY_CONFLICT', '같은 키에 다른 본문');
      return structuredClone(prev.value) as T;
    }
    const v = fn();
    this.idem.set(k, { body: b, value: structuredClone(v) });
    return v;
  }
  private mustTrip(tripId: string): Trip {
    const t = this.trips.get(tripId);
    if (!t) throw problem(404, 'NOT_FOUND', tripId);
    return t;
  }
  private mustStop(t: Trip, stopId: string) {
    const s = t.stops.find((x) => x.stopId === stopId);
    if (!s) throw problem(404, 'NOT_FOUND', stopId);
    return s;
  }

  // ── fleet (조회) ──────────────────────────────────
  listVehicles(): Vehicle[] {
    return this.run('GET', '/vehicles', 200, () => structuredClone(this.vehicles));
  }
  listDrivers(): Driver[] {
    return this.run('GET', '/drivers', 200, () => structuredClone(this.drivers));
  }

  // ── planning 역할 (정규차 자동 운송지시서 → 운송사 확정 = 계획완료) [MOCK 전용] ──
  /**
   * 22:00~22:30 배차 — 고정 노선 × 온도대마다 운행 하나. 이관요청서(TRF) 1건 = 차 1대(나누지 않음, D-10).
   * 물량 0 인 노선·온도대는 결행. 실서버는 plan-candidates → assignments(CONFIRMED) 경로(설계 §12 ⑧).
   */
  /**
   * 하루 배차 — 고정 노선 × 온도대 정규차 한 대. 용차는 쓰지 않는다(사용자 2026-11-25 "용차는 안 해, 모두 정규차로 본다") — rtByTrf(22:00 R/T 카운팅)로 한 대 R/T 를 넘으면 알림만 남긴다.
   */
  /**
   * 오늘 운행 미리 보기(MOCK 내부, 부작용 없음) — 22:00 배차 전에도 운송 탭에 노선 × 온도대 정규차·기사·출차·정차 도착 예정을 보인다(사용자 2026-11-26 "운송 탭 오른쪽에 나오는 걸 보고 싶다").
   * 계획 시각은 planDay 와 같은 공식. 결행(그 날 물량 0)은 배차 때 정해진다.
   */
  previewDay(dayStartMin = 0): { routeId: string; region: string; temp: 'AMBIENT' | 'CHILLED' | 'FROZEN'; plateNo: string; driverName: string; departMin: number; stops: { mfcId: string; arriveMin: number }[]; returnMin: number }[] {
    const out = [];
    let vi = 0;
    for (const r of TMS.routes)
      for (const temp of ['AMBIENT', 'CHILLED', 'FROZEN'] as const) {
        const v = this.vehicles[vi];
        const d = this.drivers[vi];
        vi += 1;
        const legs = [`${CENTER_ID}>${r.stops[0]}`, ...r.stops.slice(1).map((s, i) => `${r.stops[i]}>${s}`)];
        const travel = legs.map((k) => TMS.travelMin[k] ?? 120);
        const depart = Math.max(dayStartMin + 23 * 60, dayStartMin + TMS.firstArrivalTarget - travel[0]);
        let t = depart;
        const stops = r.stops.map((mfcId, i) => {
          t += travel[i];
          const arriveMin = t;
          t += TMS.unloadMin;
          return { mfcId, arriveMin };
        });
        const back = TMS.travelMin[`${r.stops[r.stops.length - 1]}>${CENTER_ID}`] ?? travel[0];
        out.push({ routeId: r.routeId, region: r.region, temp, plateNo: v?.plateNo ?? '', driverName: d?.displayName ?? '', departMin: depart, stops, returnMin: t + back });
      }
    return out;
  }

  planDay(trfs: TransferIntake[], dayStartMin = 0, rtByTrf?: Map<string, number>): TripPlan[] {
    return this.run('POST', '/assignments', 202, () => {
      const out: TripPlan[] = [];
      let vi = 0;
      for (const r of TMS.routes) {
        for (const temp of ['AMBIENT', 'CHILLED', 'FROZEN'] as const) {
          const vehicle0 = this.vehicles[vi];
          const driver0 = this.drivers[vi];
          vi += 1;
          const allStops = r.stops.map((mfcId) => ({ mfcId, trfIds: trfs.filter((t) => t.mfcId === mfcId && trfTemp(t) === temp && t.state !== 'CANCELLED').map((t) => t.trfId) })).filter((s) => s.trfIds.length);
          if (!allStops.length) continue; // 결행
          const stops = allStops;
          const vehicle = vehicle0;
          const driver = driver0;
          const rt = stops.reduce((a, st) => a + st.trfIds.reduce((b, id) => b + (rtByTrf?.get(id) ?? 0), 0), 0);
          const legs = [`${CENTER_ID}>${stops[0].mfcId}`, ...stops.slice(1).map((s, i) => `${stops[i].mfcId}>${s.mfcId}`)];
          const travel = legs.map((k) => TMS.travelMin[k] ?? 120);
          const depart = Math.max(dayStartMin + 23 * 60, dayStartMin + TMS.firstArrivalTarget - travel[0]);
          const arrive: number[] = [];
          let t = depart;
          for (let i = 0; i < stops.length; i++) {
            t += travel[i];
            arrive.push(t);
            t += TMS.unloadMin;
          }
          const back = TMS.travelMin[`${stops[stops.length - 1].mfcId}>${CENTER_ID}`] ?? travel[0];
          const tripId = this.id('TRIP');
          const plan: TripPlan = { tripId, routeId: r.routeId, region: r.region, temp, vehicleId: vehicle.vehicleId, driverId: driver.driverId, plannedDepartMin: depart, plannedArriveMin: arrive, plannedReturnMin: t + back, stops };
          this.plans.set(tripId, plan);
          this.trips.set(tripId, {
            tripId,
            version: 0,
            state: 'CONFIRMED',
            assignmentId: this.id('ASG'),
            vehicleId: vehicle.vehicleId,
            driverId: driver.driverId,
            fromCdc: CENTER_ID,
            stops: stops.map((s, i) => ({
              stopId: `${tripId}-S${i + 1}`,
              sequence: i + 1,
              centerId: s.mfcId,
              state: 'PLANNED',
              trfIds: s.trfIds,
              plannedArriveAt: this.iso(arrive[i] * 60),
              arrivedAt: null,
              unloadingStartedAt: null,
              departedAt: null,
              handoverIds: [],
            })),
            openIncidentIds: [],
            obligations: stops.flatMap((s) => s.trfIds.map((trfId) => ({ trfId, departedQty: 0, receivedQty: null, state: 'PENDING' as const }))),
            physicallyEndedAt: null,
          });
          vehicle.status = 'RESERVED';
          driver.status = 'RESERVED';
          out.push(structuredClone(plan));
          this.emit('TripAssigned', `${tripId} ${r.region} ${temp} ${vehicle.plateNo} · ${driver.displayName} · 출차 ${fmt(depart)}${rt > TMS.vehicle.maxRt ? ` · R/T ${rt}/${TMS.vehicle.maxRt} 넘침(정규차로 봄)` : ''}`);
        }
      }
      return out;
    });
  }

  // ── execution ────────────────────────────────────
  getTrip(tripId: string): Trip {
    return this.run('GET', `/trips/${tripId}`, 200, () => structuredClone(this.mustTrip(tripId)));
  }

  /** (MOCK 내부) 상차 시작 — 입차·상차완료 전용 엔드포인트가 계약에 없다(TMS 문서 §9.1), Trip LOADING 만 표시 */
  markLoading(tripId: string) {
    const t = this.mustTrip(tripId);
    if (t.state === 'CONFIRMED') {
      t.state = 'LOADING';
      t.version += 1;
    }
  }

  recordPreDepartureCheck(tripId: string, body: PreDepartureCheckInput, key: string): { checkId: string; result: 'PASS' | 'FAIL' } {
    return this.run('POST', `/trips/${tripId}/pre-departure-checks`, 201, () =>
      this.idempotent(`check:${tripId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        if (t.departure) throw problem(409, 'INVALID_STATE', '이미 출발');
        const checkId = this.id('PDC');
        t.preDepartureCheck = { checkId, result: body.result, checkedAt: body.checkedAt };
        if (body.result === 'PASS') t.state = 'READY';
        t.version += 1;
        return { checkId, result: body.result };
      }),
    );
  }

  /**
   * 실제 출발 기록 → TruckActuallyDeparted. 운행당 1회(같은 키는 같은 departureId).
   * cdc-outbound 가 소비해 출발 검증 → 일치 TRF 만 TOUT. 사전 점검 FAIL 이면 409.
   */
  recordDeparture(tripId: string, body: DepartureInput, key: string): { departure: Departure; validation: DepartureValidation } {
    return this.run('POST', `/trips/${tripId}/departures`, 201, () =>
      this.idempotent(`depart:${tripId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        if (t.departure) throw problem(409, 'INVALID_STATE', `이미 출발 ${t.departure.departureId}`);
        if (t.preDepartureCheck?.result === 'FAIL') throw problem(409, 'PRE_DEPARTURE_CHECK_FAILED', tripId);
        const departureId = this.id('DEP');
        const departure: Departure = { ...structuredClone(body), departureId, tripId, fromCdc: CENTER_ID, recordedAt: this.iso() };
        t.departure = departure;
        t.state = 'IN_TRANSIT';
        t.version += 1;
        const v = this.vehicles.find((x) => x.vehicleId === body.vehicleId);
        if (v) v.status = 'IN_TRIP';
        const d = this.drivers.find((x) => x.driverId === body.driverId);
        if (d) d.status = 'ON_DUTY';
        this.emit('TruckActuallyDeparted', `${tripId} ${v?.plateNo ?? body.vehicleId} 출발 (${body.source})`);
        // TruckActuallyDeparted 소비 → cdc-outbound 출발 검증 (필드 대응 toMfc→mfcId, lines[].lpn→lpns — R-15)
        const validation = this.opt.outbound.validateDeparture(
          {
            departureId,
            tripId,
            vehicleId: body.vehicleId,
            departedAt: body.departedAt,
            source: body.source,
            trfCompositions: body.trfCompositions.map((c) => ({
              trfId: c.trfId,
              mfcId: t.stops.find((s) => s.trfIds.includes(c.trfId))?.centerId,
              lpns: [...new Set(c.lines.map((l) => l.lpn).filter((x): x is string => !!x))],
            })),
          },
          `tms:${departureId}`,
        );
        for (const tr of validation.transfers) {
          const o = t.obligations.find((x) => x.trfId === tr.trfId);
          if (o) o.departedQty = tr.departedQty;
        }
        return { departure: structuredClone(departure), validation };
      }),
    );
  }

  recordStopArrival(tripId: string, stopId: string, body: StopEventInput, key: string) {
    return this.run('POST', `/trips/${tripId}/stops/${stopId}/arrivals`, 201, () =>
      this.idempotent(`arrive:${stopId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        const s = this.mustStop(t, stopId);
        if (!t.departure) throw problem(409, 'INVALID_STATE', '출발 전');
        if (s.state !== 'PLANNED') throw problem(409, 'INVALID_STATE', `정차 ${s.state}`);
        s.state = 'ARRIVED';
        s.arrivedAt = body.occurredAt;
        t.version += 1;
        this.emit('StopArrived', `${tripId} ${s.centerId} 도착`);
        return structuredClone(s);
      }),
    );
  }

  recordUnloadingStart(tripId: string, stopId: string, body: StopEventInput, key: string) {
    return this.run('POST', `/trips/${tripId}/stops/${stopId}/unloading-starts`, 201, () =>
      this.idempotent(`unload:${stopId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        const s = this.mustStop(t, stopId);
        if (s.state !== 'ARRIVED' && s.state !== 'WAITING') throw problem(409, 'INVALID_STATE', `정차 ${s.state}`);
        s.state = 'UNLOADING';
        s.unloadingStartedAt = body.occurredAt;
        t.version += 1;
        return structuredClone(s);
      }),
    );
  }

  /** 인계 증빙 — TIN 이 아니다(TMS §10). 불일치여도 차 출발은 막지 않는다 */
  recordHandover(tripId: string, stopId: string, body: HandoverInput, key: string): Handover {
    return this.run('POST', `/trips/${tripId}/stops/${stopId}/handovers`, 201, () =>
      this.idempotent(`handover:${stopId}:${body.trfId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        const s = this.mustStop(t, stopId);
        if (s.state !== 'UNLOADING' && s.state !== 'HANDOVER_PENDING' && s.state !== 'HANDOVER_RECORDED') throw problem(409, 'INVALID_STATE', `정차 ${s.state}`);
        if (!s.trfIds.includes(body.trfId)) throw problem(409, 'INVALID_STATE', `이 정차의 TRF 아님 ${body.trfId}`);
        const h: Handover = { ...structuredClone(body), handoverId: this.id('HO'), tripId, stopId };
        this.handovers.set(h.handoverId, h);
        s.handoverIds.push(h.handoverId);
        s.state = s.trfIds.every((id) => [...this.handovers.values()].some((x) => x.stopId === stopId && x.trfId === id)) ? 'HANDOVER_RECORDED' : 'HANDOVER_PENDING';
        t.version += 1;
        this.emit('TransportHandoverEvidenceRecorded', `${tripId} ${s.centerId} ${body.trfId} 인계 ${body.lines.reduce((a, l) => a + l.qty, 0)}개${body.discrepancies?.length ? ` · 불일치 ${body.discrepancies.length}` : ''}`);
        return structuredClone(h);
      }),
    );
  }

  /** 정차 출발 — 인계 기록 뒤에만 */
  recordStopDeparture(tripId: string, stopId: string, body: StopEventInput, key: string) {
    return this.run('POST', `/trips/${tripId}/stops/${stopId}/departures`, 201, () =>
      this.idempotent(`stopdep:${stopId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        const s = this.mustStop(t, stopId);
        if (s.state !== 'HANDOVER_RECORDED') throw problem(409, 'HANDOVER_REQUIRED', `정차 ${s.state}`);
        s.state = 'DEPARTED';
        s.departedAt = body.occurredAt;
        t.version += 1;
        return structuredClone(s);
      }),
    );
  }

  recordPhysicalEnd(tripId: string, body: { endedAt: string; returnCenterId: string }, key: string): Trip {
    return this.run('POST', `/trips/${tripId}/physical-ends`, 200, () =>
      this.idempotent(`end:${tripId}`, key, body, () => {
        const t = this.mustTrip(tripId);
        if (t.stops.some((s) => s.state !== 'DEPARTED')) throw problem(409, 'INVALID_STATE', '끝나지 않은 정차');
        t.state = t.obligations.every((x) => x.state === 'RECONCILED') ? 'CLOSED' : 'PHYSICAL_ENDED';
        t.physicallyEndedAt = body.endedAt;
        t.version += 1;
        const v = this.vehicles.find((x) => x.vehicleId === t.vehicleId);
        if (v) v.status = 'AVAILABLE';
        const d = this.drivers.find((x) => x.driverId === t.driverId);
        if (d) d.status = 'RESTING';
        this.emit('TripPhysicallyEnded', `${tripId} DC 복귀`);
        return structuredClone(t);
      }),
    );
  }

  /** (MFC 수령 대사 반영) 의무 상태 — 출발 q = 수령 r 이면 RECONCILED */
  noteReceived(tripId: string, trfId: string, receivedQty: number) {
    const t = this.mustTrip(tripId);
    const o = t.obligations.find((x) => x.trfId === trfId);
    if (!o) return;
    o.receivedQty = (o.receivedQty ?? 0) + receivedQty;
    o.state = o.receivedQty === o.departedQty ? 'RECONCILED' : 'DISCREPANCY';
    if (t.state === 'PHYSICAL_ENDED' && t.obligations.every((x) => x.state === 'RECONCILED')) t.state = 'CLOSED';
  }

  recordIncident(tripId: string, kind: 'DELAY' | 'QTY', note: string) {
    const t = this.mustTrip(tripId);
    const id = this.id('INC');
    t.openIncidentIds.push(id);
    this.emit('TransportIncidentRaised', `${tripId} ${kind} ${note}`);
    return id;
  }

  allTrips(): Trip[] {
    return [...this.trips.values()].map((t) => structuredClone(t));
  }
}

export const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.floor(min) % 60).padStart(2, '0')}`;
