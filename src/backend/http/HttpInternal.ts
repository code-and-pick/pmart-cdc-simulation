// 내부 경로(/internal/*) 직접 호출 — 백엔드 CDC-9(사용자 2026-11-25 "LAN 서비스 직접 호출"):
// 아직 없는 서비스(보충 승인·TMS) 역할을 시뮬레이터가 대신할 때만 쓴다. 게이트웨이를 거치지 않고 Vite 개발 서버 프록시
// /svc/cdc-outbound(→ :8603) · /svc/cdc-inventory(→ :8601) 로 LAN 서비스에 바로 간다(vite.config.ts).
// 토큰 없음 — 신원은 X-Source-System: pmart-cdc-simulation(ADR-0026, 권한 증명 아님). 명령에는 멱등 키를 늘 붙인다.
// 그 서비스가 생기면(replenishment·transport) 그쪽 사건·공개 API 로 바꾼다.

import type { Allocation, Availability, Commit, DepartureValidation, DepartureValidationRequest, OutboundReadiness, ShipmentManifest, Transit, TransferIntake, TransferIntakeInput, CommandResponse } from '../../domain/contract';
import type { ApiListener } from '../port';
import { HttpClient, type HttpClientOptions } from './client';

const enc = encodeURIComponent;

/** /internal/snapshots 응답(0.4.0) — 칸마다 SKU·LOT·수량·예약. 취급 OFF·안전량 미설정이면 handlingActive=false·safety NOT_SET·available=null */
export interface InventorySnapshot {
  cdcId?: string;
  items: (Omit<Availability, 'available' | 'lots'> & {
    available: number | null;
    lots: (Availability['lots'][number] & { locations: { locationCode: string; qualityState: string; onHand: number; reserved: number }[] })[];
  })[];
}

export interface MoveLine {
  sku: string;
  lot: string;
  fromLocationCode: string;
  toLocationCode: string;
  qty: number;
  /** 주면 그 할당이 원위치에 잡은 예약을 함께 옮긴다(cdc-inventory 0.3.0, PR #450) */
  allocationId?: string;
  qualityState?: string;
}

export class HttpInternal {
  readonly outbound: HttpClient;
  readonly inventory: HttpClient;

  constructor(opt: Omit<HttpClientOptions, 'baseUrl' | 'token'> & { outboundBase?: string; inventoryBase?: string }) {
    const base = { ...opt, token: () => null };
    this.outbound = new HttpClient({ ...base, baseUrl: opt.outboundBase ?? '/svc/cdc-outbound' });
    this.inventory = new HttpClient({ ...base, baseUrl: opt.inventoryBase ?? '/svc/cdc-inventory' });
  }

  onApi(l: ApiListener) {
    this.outbound.onApi(l);
    this.inventory.onApi(l);
  }

  private static key(k: string | undefined, what: string): string {
    if (!k) throw new Error(`${what}: 내부 명령에는 멱등 키가 필요하다(CDC-9)`);
    return k;
  }

  // ── cdc-outbound (보충 승인·TMS 역할) ─────────────────
  async intakeTransfer(body: TransferIntakeInput, idempotencyKey: string): Promise<CommandResponse> {
    return (await this.outbound.call<CommandResponse>('POST', '/internal/transfer-intakes', { body, idempotencyKey: HttpInternal.key(idempotencyKey, 'TRF 인수') })).body;
  }
  async getTransferIntake(trfId: string): Promise<TransferIntake> {
    return (await this.outbound.call<TransferIntake>('GET', `/internal/transfer-intakes/${enc(trfId)}`)).body;
  }
  /** TMS 실제 출발(SIMULATED) — R-15 회신: SIMULATED 도 TOUT, 일치하면 TOUT → 잔량 해제 → 매니페스트를 cdc-outbound 가 한다 */
  async validateDeparture(body: DepartureValidationRequest, idempotencyKey: string): Promise<DepartureValidation> {
    return (await this.outbound.call<DepartureValidation>('POST', '/internal/departure-validations', { body, idempotencyKey: HttpInternal.key(idempotencyKey, '출발 검증') })).body;
  }
  async getDepartureValidation(departureId: string): Promise<DepartureValidation> {
    return (await this.outbound.call<DepartureValidation>('GET', `/internal/departure-validations/${enc(departureId)}`)).body;
  }
  async getShipmentManifest(trfId: string): Promise<ShipmentManifest> {
    return (await this.outbound.call<ShipmentManifest>('GET', `/internal/shipment-manifests/${enc(trfId)}`)).body;
  }
  async getOutboundReadiness(trfId: string): Promise<OutboundReadiness> {
    return (await this.outbound.call<OutboundReadiness>('GET', '/internal/outbound-readiness', { query: { trfId } })).body;
  }

  // ── cdc-inventory (센터 현황·보충 MOV) ─────────────────
  async getAvailability(cdcId: string, sku: string): Promise<Availability> {
    return (await this.inventory.call<Availability>('GET', '/internal/availability', { query: { cdcId, sku } })).body;
  }
  /**
   * 칸별 재고 — GET /internal/snapshots?cdcId=&sku= (cdc-inventory 0.4.0, PR #458). items 는 가용 조회 모양 + lots[].locations[](locationCode·qualityState·onHand·reserved).
   * sku 를 비우면 현물 있는 SKU 전부 — 시작·재동기화 때만. 주기 조회는 작업에 나온 SKU 만 sku= 로(백엔드 안내).
   */
  async getSnapshot(cdcId: string, sku?: string): Promise<InventorySnapshot> {
    return (await this.inventory.call<InventorySnapshot>('GET', '/internal/snapshots', { query: { cdcId, sku } })).body;
  }
  async getAllocation(allocationId: string): Promise<Allocation> {
    return (await this.inventory.call<Allocation>('GET', `/internal/allocations/${enc(allocationId)}`)).body;
  }
  async listTransits(q: { trfId?: string; departureId?: string } = {}): Promise<Transit[]> {
    const r = await this.inventory.call<{ items?: Transit[] } | Transit[]>('GET', '/internal/transits', { query: q });
    return Array.isArray(r.body) ? r.body : (r.body.items ?? []);
  }
  async getCommit(commitId: string): Promise<Commit> {
    return (await this.inventory.call<Commit>('GET', `/internal/commits/${enc(commitId)}`)).body;
  }
  /** 선반 보충 MOV — moveKind REPLENISHMENT_MOVE, sourceRef = MOV 번호 (백엔드 PR #450 안내) */
  async postReplenishmentMove(cdcId: string, sourceRef: string, lines: MoveLine[], idempotencyKey: string): Promise<CommandResponse> {
    return (await this.inventory.call<CommandResponse>('POST', '/internal/move-postings', { body: { cdcId, moveKind: 'REPLENISHMENT_MOVE', sourceRef, lines }, idempotencyKey: HttpInternal.key(idempotencyKey, '보충 MOV') })).body;
  }
}
