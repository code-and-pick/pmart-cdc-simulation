// 계약 타입 사본 — 이름·상태값은 pmart-backend/contracts/openapi 를 그대로 따른다(CLAUDE.md "계약이 정본").
// cdc-outbound-service.yaml 0.2.0(PR #443, 병합 전) · cdc-inventory-service.yaml(할당·출발 전기·Transit·Commit) · _common.yaml.
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

export interface TaskLine {
  sku: string;
  lot: string;
  locationCode: string;
  plannedQty: number;
  pickedQty: number;
  shortQty: number;
  shortReason?: string;
}

export interface Task {
  taskId: string;
  waveId: string;
  trfId: string;
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
