// cdc-outbound 실호출 어댑터 — 계약 cdc-outbound-service.yaml 0.3.0(PR #452 — Task 경로가 /cdcs/{cdcId}/tasks… 로 옮김) 경로·이름 그대로. 계약에 없는 경로는 부르지 않는다(CLAUDE.md).
// 2026-11-25: cdc-outbound 첫 판(PR #452, 병합 전) — TRF 인수·Wave·다음 작업 받기·착수·피킹 실적만 구현, 분류·검품·상차·출발 검증은 501. 실서버 검증 전. 연결 점검은 readiness.ts.

import type {
  CommandResponse,
  CreateWaveRequest,
  InspectionResultRequest,
  LoadingResultRequest,
  NextTaskRequest,
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
} from '../../domain/contract';
import { CENTER_ID } from '../../config';
import type { ApiListener, CdcOutboundPort } from '../port';
import { HttpClient, type HttpClientOptions } from './client';

const enc = encodeURIComponent;
/** Task 경로 앞부분 — 게이트웨이 /api/v1/tasks/** 는 MFC 쪽이라 CDC 는 센터 아래로(0.3.0) */
const TASKS = `/cdcs/${CENTER_ID}/tasks`;

export class HttpBackend implements CdcOutboundPort {
  readonly mode = 'http' as const;
  readonly client: HttpClient;

  constructor(opt: HttpClientOptions) {
    this.client = new HttpClient(opt);
  }

  onApi(l: ApiListener) {
    this.client.onApi(l);
  }

  // waves
  async createWave(body: CreateWaveRequest, idempotencyKey: string): Promise<Wave> {
    return (await this.client.call<Wave>('POST', '/waves', { body, idempotencyKey })).body;
  }
  async getWave(waveId: string): Promise<Wave> {
    return (await this.client.call<Wave>('GET', `/waves/${enc(waveId)}`)).body;
  }
  async releaseWave(waveId: string, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse> {
    return (await this.client.call<CommandResponse>('POST', `/waves/${enc(waveId)}/releases`, { idempotencyKey, expectedVersion })).body;
  }

  // tasks
  async pullNextTask(cdcId: string, workerId: string, body: NextTaskRequest, idempotencyKey: string): Promise<{ status: 200 | 201; task: Task }> {
    const r = await this.client.call<Task>('POST', `/cdcs/${enc(cdcId)}/workers/${enc(workerId)}/next-tasks`, { body, idempotencyKey });
    return { status: r.status === 201 ? 201 : 200, task: r.body };
  }
  async startTask(taskId: string, _workerId: string, idempotencyKey: string, expectedVersion?: number): Promise<Task> {
    // workerId 는 토큰 주체 — 본문에 넣지 않는다(계약 startTask 에 본문 없음)
    return (await this.client.call<Task>('POST', `${TASKS}/${enc(taskId)}/starts`, { idempotencyKey, expectedVersion })).body;
  }
  /** GET /cdcs/{cdcId}/tasks — 페이지(cursor)를 끝까지 따라간다 */
  async listTasks(waveId: string, filter: { state?: TaskState; assigneeId?: string } = {}): Promise<Task[]> {
    const out: Task[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const r = await this.client.call<{ items: Task[]; page?: { nextCursor?: string | null } }>('GET', TASKS, { query: { waveId, state: filter.state, assigneeId: filter.assigneeId, cursor } });
      out.push(...(r.body.items ?? []));
      cursor = r.body.page?.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return out;
  }
  async getTask(taskId: string): Promise<Task> {
    return (await this.client.call<Task>('GET', `${TASKS}/${enc(taskId)}`)).body;
  }
  async reportPickResult(taskId: string, body: PickResultRequest, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse> {
    return (await this.client.call<CommandResponse>('POST', `${TASKS}/${enc(taskId)}/pick-results`, { body, idempotencyKey, expectedVersion })).body;
  }

  // results
  async reportSortingResult(body: SortingResultRequest, idempotencyKey: string): Promise<CommandResponse> {
    return (await this.client.call<CommandResponse>('POST', '/sorting-results', { body, idempotencyKey })).body;
  }
  async reportInspectionResult(body: InspectionResultRequest, idempotencyKey: string): Promise<CommandResponse> {
    return (await this.client.call<CommandResponse>('POST', '/inspection-results', { body, idempotencyKey })).body;
  }
  async reportLoadingResult(body: LoadingResultRequest, idempotencyKey: string): Promise<CommandResponse> {
    return (await this.client.call<CommandResponse>('POST', '/loading-results', { body, idempotencyKey })).body;
  }
  async getWorkResult(workResultId: string): Promise<WorkResult> {
    return (await this.client.call<WorkResult>('GET', `/work-results/${enc(workResultId)}`)).body;
  }

  // transfers
  async cancelBeforeDeparture(trfId: string, body: PreDepartureCancelRequest, idempotencyKey: string, expectedVersion?: number): Promise<CommandResponse> {
    return (await this.client.call<CommandResponse>('POST', `/transfers/${enc(trfId)}/pre-departure-cancellations`, { body, idempotencyKey, expectedVersion })).body;
  }
  async getPreDepartureCancellation(trfId: string, requestId: string): Promise<PreDepartureCancellation> {
    return (await this.client.call<PreDepartureCancellation>('GET', `/transfers/${enc(trfId)}/pre-departure-cancellations/${enc(requestId)}`)).body;
  }

  // 조회 (internal — 게이트웨이가 열어 줘야 화면이 읽는다, R-16)
  async getTransferIntake(trfId: string): Promise<TransferIntake> {
    return (await this.client.call<TransferIntake>('GET', `/internal/transfer-intakes/${enc(trfId)}`)).body;
  }
  async getOutboundReadiness(trfId: string): Promise<OutboundReadiness> {
    return (await this.client.call<OutboundReadiness>('GET', '/internal/outbound-readiness', { query: { trfId } })).body;
  }
  async getShipmentManifest(trfId: string): Promise<ShipmentManifest> {
    return (await this.client.call<ShipmentManifest>('GET', `/internal/shipment-manifests/${enc(trfId)}`)).body;
  }
}
