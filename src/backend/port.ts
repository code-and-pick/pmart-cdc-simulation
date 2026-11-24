import type {
  CommandResponse,
  CreateWaveRequest,
  InspectionResultRequest,
  LoadingResultRequest,
  OutboundReadiness,
  PickResultRequest,
  PreDepartureCancellation,
  PreDepartureCancelRequest,
  ShipmentManifest,
  SortingResultRequest,
  Task,
  TaskState,
  TransferIntake,
  Wave,
  WorkResult,
} from '../domain/contract';

/**
 * 가상 CDC 현장(시뮬레이터)이 cdc-outbound 에 대해 하는 일 — 메서드 하나가 계약(cdc-outbound-service.yaml) API 하나다.
 * 구현은 MockBackend(브라우저 안에서 계약 의미를 흉내)와 HttpBackend(게이트웨이 실호출, 설계 §12 ⑧).
 * 다른 서비스가 부르는 internal API(TRF 인수·출발 검증)는 여기 두지 않는다 — MOCK 에서는 시뮬레이터가
 * replenishment·TMS 역할로 MockBackend 의 별도 메서드를 부른다(MFC 시뮬레이터 orchestrationConfirmOrder 와 같은 방식).
 */
export interface CdcOutboundPort {
  readonly mode: 'mock' | 'http';

  // waves (OPERATOR)
  createWave(body: CreateWaveRequest, idempotencyKey: string): Promise<Wave>;
  getWave(waveId: string): Promise<Wave>;
  releaseWave(waveId: string, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse>;

  // tasks — FC 작업자 PDA
  listTasks(waveId: string, filter?: { state?: TaskState; assigneeId?: string }): Promise<Task[]>;
  getTask(taskId: string): Promise<Task>;
  reportPickResult(taskId: string, body: PickResultRequest, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse>;

  // results — 시뮬레이터 = 가상 수행 모듈(분배·라인·DPS·분류기·검품·상차, 설계 §5.3)
  reportSortingResult(body: SortingResultRequest, idempotencyKey: string): Promise<CommandResponse>;
  reportInspectionResult(body: InspectionResultRequest, idempotencyKey: string): Promise<CommandResponse>;
  reportLoadingResult(body: LoadingResultRequest, idempotencyKey: string): Promise<CommandResponse>;
  getWorkResult(workResultId: string): Promise<WorkResult>;

  // transfers
  cancelBeforeDeparture(trfId: string, body: PreDepartureCancelRequest, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse>;
  getPreDepartureCancellation(trfId: string, requestId: string): Promise<PreDepartureCancellation>;

  // 조회 (internal 이지만 화면이 진행을 읽는다)
  getTransferIntake(trfId: string): Promise<TransferIntake>;
  getOutboundReadiness(trfId: string): Promise<OutboundReadiness>;
  getShipmentManifest(trfId: string): Promise<ShipmentManifest>;
}

/** API 호출 기록 — 화면의 "API 로그"와 연동 점검에 쓴다. */
export interface ApiCallRecord {
  at: number; // 시뮬레이션 시각(초)
  method: 'GET' | 'POST';
  path: string;
  status: number | 'ERR';
  code?: string;
  ms: number;
  /** 계약 공백 등 표시 */
  note?: string;
}

/** 계약 이벤트 이름 그대로의 사건 기록 (contracts/events/*.v1.json). */
export interface DomainEventRecord {
  at: number;
  type: string;
  summary: string;
}

export type ApiListener = (rec: ApiCallRecord) => void;
export type EventListener = (rec: DomainEventRecord) => void;
