// 계약 타입 사본 — 이름·상태값은 pmart-backend/contracts/openapi 를 그대로 따른다(CLAUDE.md "계약이 정본").
// cdc-outbound-service.yaml 0.9.0(PR #484, 병합 전 — 묶음 피킹: pickMode·pickMethod·regionCode·trfIds·shares, 지역표) · cdc-inventory-service.yaml(할당·출발 전기·Transit·Commit) · _common.yaml.
// 계약이 바뀌면 여기를 먼저 고치고 MockBackend·HttpBackend 를 맞춘다.

// ── _common.yaml ─────────────────────────────────────
export type TemperatureZone = 'AMBIENT' | 'CHILLED' | 'FROZEN';
export type CommandStatus = 'ACCEPTED' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';

export interface CommandResponse {
  status: CommandStatus;
  requestId: string;
  resultId?: string;
  appliedQty?: number;
  version?: number;
  retryable?: boolean;
  nextAction?: string;
}

export interface AsOf {
  asOf?: string;
  sourceVersion?: number;
  freshness?: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
}

/** RFC 9457 + PMart 확장 (ErrorResponse) — 화면·시험에 필요한 부분만 */
export interface Problem {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  retryable?: boolean;
  details?: { field: string; reason: string }[];
}

export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(`${problem.status} ${problem.code}${problem.detail ? ` — ${problem.detail}` : ''}`);
  }
}

/** 응답을 받지 못함 — 실패로 단정하지 않는다(같은 키 재전송 또는 원결과 조회로 해소). */
export class ResultUnknown extends Error {}

/** Sku 패턴 ^[EB]-[0-9]{8}$ (E 낱개 · B 밀봉 묶음) */
export const SKU_PATTERN = /^[EB]-[0-9]{8}$/;

// ── cdc-outbound-service.yaml ─────────────────────────
export type WaveState = 'DRAFT' | 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'WORK_DONE' | 'CLOSED' | 'CANCELLED';
export type TaskState = 'CREATED' | 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS' | 'PARTIAL' | 'DONE' | 'EXCEPTION' | 'CANCELLED';
export type DeadlineMeaning = 'ARRIVAL' | 'HANDOVER' | 'READY';

export interface TransferIntakeInput {
  trfId: string;
  trfVersion: number;
  cdcId: string;
  mfcId: string;
  approvalRef: string;
  deadlineMeaning: DeadlineMeaning;
  dueAt: string;
  conditions?: { kind?: string; value?: string }[];
  lines: { sku: string; approvedQty: number }[];
}

export type TransferIntakeState =
  | 'RECEIVED'
  | 'ALLOCATING'
  | 'ALLOCATED'
  | 'PARTIALLY_ALLOCATED'
  | 'ALLOCATION_FAILED'
  | 'IN_WAVE'
  | 'PICKED'
  | 'SORTED'
  | 'INSPECTED'
  | 'LOADED'
  | 'DEPARTED'
  | 'CANCELLED';

/** 불변식 단계별 수량 — 상차 ≤ 검품합격 ≤ 분류 ≤ 실피킹 ≤ 유효할당 ≤ 승인 */
export interface TransferProgressLine {
  sku: string;
  approvedQty: number;
  allocatedQty: number;
  pickedQty: number;
  sortedQty: number;
  inspectedQty: number;
  loadedQty: number;
  departedQty: number;
}

export interface TransferIntake extends TransferIntakeInput {
  state: TransferIntakeState;
  version: number;
  allocationId?: string;
  waveId?: string;
  tripId?: string;
  departureId?: string;
  shipmentManifestId?: string;
  progress: TransferProgressLine[];
  inventoryAsOf?: AsOf;
}

export interface CreateWaveRequest {
  cdcId: string;
  trfIds: string[];
  plannedDepartureWindow?: { start?: string; end?: string };
  temperatureZone?: TemperatureZone;
}

export interface Wave {
  waveId: string;
  cdcId: string;
  state: WaveState;
  version: number;
  trfIds: string[];
  plannedDepartureWindow?: { start?: string; end?: string };
  taskSummary: { total: number; done: number; exception: number };
  createdAt: string;
  releasedAt?: string;
}

export type TaskKind = 'PICK' | 'SORT' | 'INSPECT' | 'LOAD';
export type ShortReason = 'NOT_FOUND' | 'DAMAGED' | 'EXPIRED' | 'LOCATION_BLOCKED' | 'OTHER';

/** (0.9.0) DISCRETE = TRF 하나(DPS·방식 없는 위치), REGION_BATCH = 지역 묶음(박스 피킹·FC·분배), SKU_BATCH = SKU 묶음(라인 DAS — Wave 안 모든 MFC) */
export type PickMode = 'DISCRETE' | 'REGION_BATCH' | 'SKU_BATCH';
/** (0.9.0) 위치 통로의 피킹 방식(cdc-location 0.5.0 aisle-pick-methods) */
export type PickMethod = 'DPS' | 'BOX_PICK' | 'FC' | 'DISTRIBUTION' | 'LINE';

/** (0.9.0) 줄의 TRF 별 몫(trfId 순) — 실피킹·부족은 줄 실적을 기한 이른 TRF 부터 나눈 값 */
export interface TaskLineShare {
  trfId: string;
  mfcId: string;
  dueAt: string;
  plannedQty: number;
  pickedQty: number;
  shortQty: number;
}

export interface TaskLine {
  sku: string;
  lot: string;
  locationCode: string;
  plannedQty: number;
  pickedQty: number;
  shortQty: number;
  shortReason?: string;
  shares: TaskLineShare[];
}

/** (0.9.0) 지역 ↔ MFC 대응표 — 지역 코드 = PDA 지역 바코드 값 */
export interface Region {
  regionCode: string;
  regionName: string;
  mfcIds: string[];
}

export interface Task {
  taskId: string;
  waveId: string;
  /** TRF 하나짜리 작업의 TRF. (0.9.0) 묶음 작업(REGION_BATCH·SKU_BATCH)이면 null — trfIds·shares 를 본다 */
  trfId: string | null;
  /** (0.9.0) 이 작업에 몫이 든 TRF(trfId 순) */
  trfIds: string[];
  pickMode: PickMode;
  /** (0.9.0) 방식 없는 위치(팔레트 랙·설정 없음)면 비움 */
  pickMethod?: PickMethod;
  /** (0.9.0) REGION_BATCH 의 지역. 그 밖은 null */
  regionCode: string | null;
  kind: TaskKind;
  state: TaskState;
  version: number;
  assigneeId?: string;
  lines: TaskLine[];
  createdAt: string;
  completedAt?: string;
}

/** (0.2.0) 다음 작업 받기 본문 — 생략하면 전체 */
export interface NextTaskRequest {
  kind?: TaskKind;
  zone?: string;
  floor?: string;
  /** (0.9.0) */
  pickMode?: PickMode;
}

export interface PickResultRequest {
  workerId: string;
  lines: { sku: string; lot: string; locationCode: string; pickedQty: number; shortQty?: number; shortReason?: ShortReason }[];
}

export interface LpnComposition {
  lpn: string;
  unitType: 'BOX' | 'PLT';
  state: 'SEALED' | 'READY';
  parentLpn?: string | null;
  sealNo?: string;
  temperatureZone?: TemperatureZone;
  weightG?: number;
  contents: { sku: string; lot: string; qty: number }[];
}

export interface SortingResultRequest {
  waveId: string;
  trfId: string;
  workerId: string;
  lpns: LpnComposition[];
}

export type InspectionFailReason = 'QTY_MISMATCH' | 'SEAL_BROKEN' | 'TEMPERATURE' | 'DAMAGE' | 'WRONG_TRF' | 'OTHER';

export interface InspectionResultRequest {
  trfId: string;
  inspectorId: string;
  items: { lpn: string; result: 'PASSED' | 'FAILED'; failReason?: InspectionFailReason; temperatureC?: number; evidenceRef?: string }[];
}

export interface LoadingResultRequest {
  trfId: string;
  tripId: string;
  vehicleId: string;
  dockCode?: string;
  workerId: string;
  action: 'LOADED' | 'UNLOADED';
  lpns: { lpn: string; compartment?: string; sealNo?: string }[];
}

export interface WorkResult {
  workResultId: string;
  kind: 'SORTING' | 'INSPECTION' | 'LOADING';
  trfId: string;
  status: CommandStatus;
  rejectReason?: string;
  recordedAt: string;
}

export interface DepartureValidationRequest {
  departureId: string;
  tripId: string;
  vehicleId: string;
  departedAt: string;
  source: 'REAL' | 'SIMULATED';
  evidenceRef?: string;
  trfCompositions: { trfId: string; mfcId?: string; lpns: string[]; sealNos?: string[] }[];
}

export type MismatchKind = 'LPN_NOT_LOADED' | 'LPN_NOT_IN_DEPARTURE' | 'WRONG_TRF' | 'WRONG_MFC' | 'SEAL_MISMATCH' | 'COMPARTMENT_MISMATCH';

export interface DepartureValidation {
  departureId: string;
  tripId: string;
  vehicleId: string;
  source: 'REAL' | 'SIMULATED';
  validatedAt: string;
  overallResult: 'MATCHED' | 'PARTIALLY_MATCHED' | 'MISMATCHED';
  transfers: { trfId: string; result: 'MATCHED' | 'MISMATCHED'; departedQty: number; postingStatus: CommandStatus; commitId?: string; shipmentManifestId?: string }[];
  mismatches: { kind: MismatchKind; lpn?: string; trfId?: string; detail?: string }[];
}

export interface ShipmentManifest {
  shipmentManifestId: string;
  trfId: string;
  trfVersion: number;
  departureId: string;
  tripId: string;
  vehicleId: string;
  cdcId: string;
  mfcId: string;
  departedAt: string;
  lpns: LpnComposition[];
  lines: { sku: string; lot: string; expiresAt?: string; qty: number }[];
  issuedAt: string;
}

export type CancelReason = 'TRANSFER_CANCELLED' | 'TRANSFER_CHANGED' | 'PICK_SHORTAGE' | 'TRANSPORT_UNAVAILABLE' | 'QUALITY_BLOCKED' | 'OTHER';

export interface PreDepartureCancelRequest {
  reason: CancelReason;
  scope: 'FULL' | 'PARTIAL';
  sourceRef?: string;
  lines?: { sku: string; reduceQty: number }[];
}

export interface PreDepartureCancellation {
  requestId: string;
  state: 'PENDING' | 'APPLIED' | 'REJECTED' | 'UNKNOWN';
  releasedQty: number;
  unloadedLpns: string[];
  releaseCommitId?: string;
  reason?: string;
}

export type Readiness = 'NOT_STARTED' | 'PICKING' | 'SORTED' | 'INSPECTED' | 'LOADED' | 'DEPARTED' | 'CANCELLED';

export interface OutboundReadiness {
  trfId: string;
  asOf: AsOf;
  readiness: Readiness;
  readyLpnCount: number;
  readyQty: number;
  totalWeightG: number;
  temperatureZones: TemperatureZone[];
  earliestReadyAt: string | null;
  blockers: string[];
}

// ── cdc-inventory-service.yaml (MockBackend 원장이 흉내 내는 부분) ──
export interface Availability {
  cdcId: string;
  sku: string;
  asOf: AsOf;
  onHand: number;
  eligible: number;
  reserved: number;
  held: number;
  safety: { state: 'VALUE' | 'NOT_SET' | 'UNAVAILABLE'; value?: number };
  available: number;
  transit: number;
  handlingActive: boolean;
  lots: { lot: string; expiresAt: string; remainingDays: number; identification: 'UNVERIFIED' | 'VERIFIED' | 'INVALID'; eligible: number; reserved: number; held: number }[];
}

export interface AllocationLot {
  lot: string;
  locationCode: string;
  qty: number;
  expiresAt: string;
}

export interface Allocation {
  allocationId: string;
  trfId: string;
  trfVersion: number;
  state: 'ALLOCATED' | 'PARTIAL' | 'RELEASED' | 'DEPARTED' | 'FAILED';
  version: number;
  commitId?: string;
  allocatedAt: string;
  lines: { sku: string; requestedQty: number; allocatedQty: number; shortQty: number; releasedQty: number; departedQty: number; lots: AllocationLot[] }[];
}

export type TransitState = 'TRANSIT_OPEN' | 'RECEIPT_POSTED_AWAITING_ACK' | 'TRANSIT_RECONCILED';

export interface Transit {
  trfId: string;
  departureId: string;
  mfcId: string;
  state: TransitState;
  departedAt: string;
  reconciledAt: string | null;
  receiptIds: string[];
  lines: { sku: string; lot: string; q: number; r: number; normalQty: number; quarantinedQty: number; l: number; t: number }[];
}

export type PostingKind = 'ALLOCATION' | 'RELEASE' | 'TOUT' | 'RECEIPT_ACK' | 'MOVE' | 'QUALITY' | 'LOSS' | 'ADJ' | 'CNT' | 'INITIAL_BALANCE';
export type Bucket = 'ON_HAND' | 'RESERVED' | 'HELD' | 'TRANSIT';

export interface Commit {
  commitId: string;
  requestId: string;
  postingKind: PostingKind;
  status: CommandStatus;
  sourceSystem?: string;
  sourceRef?: string;
  appliedAt: string;
  deltas: { sku: string; lot: string; locationCode: string; bucket: Bucket; delta: number }[];
  rejectReason?: string;
}

// ── fleet-service 0.1.0 (조회만 — 등록 API 없음, R-14) ─────────
export type TempClass = TemperatureZone;
export interface Vehicle {
  vehicleId: string;
  plateNo: string;
  vehicleClass: 'VAN_1T' | 'TRUCK_2_5T' | 'TRUCK_3_5T' | 'TRUCK_5T' | 'TRUCK_11T';
  status: 'AVAILABLE' | 'RESERVED' | 'IN_TRIP' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  version: number;
  depot: string;
  maxWeightKg: number;
  compartments: { compartmentId: string; tempClass: TempClass; maxWeightKg?: number; precoolRequiredMin?: number }[];
  /** 계약에 없음 — TMS 문서 최대 R/T(20) [가정], R-14 */
  maxRt?: number;
}

export interface Driver {
  driverId: string;
  displayName: string;
  status: 'AVAILABLE' | 'RESERVED' | 'ON_DUTY' | 'RESTING' | 'OFF_DUTY' | 'SUSPENDED';
  homeDepot?: string;
}

// ── transport-execution-service 0.1.0 ───────────────────
export type TripState = 'DRAFT' | 'VALIDATING' | 'CONFIRMED' | 'LOADING' | 'READY' | 'IN_TRANSIT' | 'PHYSICAL_ENDED' | 'CLOSED';
export type StopState = 'PLANNED' | 'ARRIVED' | 'WAITING' | 'UNLOADING' | 'HANDOVER_PENDING' | 'HANDOVER_RECORDED' | 'DEPARTED';

export interface Stop {
  stopId: string;
  sequence: number;
  centerId: string;
  state: StopState;
  trfIds: string[];
  plannedArriveAt: string;
  arrivedAt: string | null;
  unloadingStartedAt: string | null;
  departedAt: string | null;
  handoverIds: string[];
}

export interface TrfComposition {
  trfId: string;
  trfVersion?: number;
  lines: { lpn?: string; sku: string; lot?: string; qty: number; compartmentId?: string }[];
}

export interface DepartureInput {
  departedAt: string;
  source: 'REAL' | 'SIMULATED';
  vehicleId: string;
  driverId: string;
  evidenceRef: string;
  preDepartureCheckId?: string;
  trfCompositions: TrfComposition[];
  recordedBy?: string;
}

export interface Departure extends DepartureInput {
  departureId: string;
  tripId: string;
  fromCdc: string;
  recordedAt: string;
}

export interface PreDepartureCheckInput {
  result: 'PASS' | 'FAIL';
  checkedAt: string;
  checkedBy: string;
  manifestRef?: string;
  findings?: { kind: 'WRONG_MFC_MIXED' | 'MISSING_LPN' | 'SEAL_MISMATCH' | 'COMPARTMENT_MISMATCH' | 'EXTRA_LPN'; lpn?: string; trfId?: string; detail?: string }[];
}

export interface StopEventInput {
  occurredAt: string;
  recordedBy?: string;
  unloadingBayId?: string;
  evidenceRef?: string;
  note?: string;
}

export interface HandoverInput {
  trfId: string;
  handedAt: string;
  handedBy: string;
  receivedBy: string;
  lines: { lpn?: string; sku: string; lot?: string; qty: number }[];
  evidenceRef: string;
  discrepancies?: { kind: 'SHORT' | 'OVER' | 'DAMAGED' | 'WRONG_LPN' | 'SEAL_BROKEN'; lpn?: string; sku?: string; expectedQty?: number; actualQty?: number }[];
}

export interface Handover extends HandoverInput {
  handoverId: string;
  tripId: string;
  stopId: string;
}

export interface Trip {
  tripId: string;
  version: number;
  state: TripState;
  assignmentId?: string;
  vehicleId?: string;
  driverId?: string;
  fromCdc: string;
  preDepartureCheck?: { checkId: string; result: 'PASS' | 'FAIL'; checkedAt: string };
  departure?: Departure;
  stops: Stop[];
  openIncidentIds: string[];
  obligations: { trfId: string; departedQty: number; receivedQty: number | null; state: 'PENDING' | 'RECONCILED' | 'DISCREPANCY' }[];
  physicallyEndedAt: string | null;
}

export interface IncidentInput {
  kind: 'DELAY' | 'BREAKDOWN' | 'GPS_LOST' | 'TEMP' | 'QTY';
  occurredAt: string;
  note?: string;
}
