// TMS 실호출 어댑터 — fleet-service 0.1.0(조회)·transport-execution-service 0.1.0 경로 그대로.
// 2026-11-25: 백엔드에 transport-* 서비스가 아직 없다 — 어댑터만, 실서버 검증 전. 배차(planning)는 plan-candidates → assignments 가
// 운영자 결정이라 시뮬레이터가 대신 고르지 않는다(실서버 모드에서는 배차 결과 Trip 을 읽기만 한다).

import type { Departure, DepartureInput, Driver, Handover, HandoverInput, PreDepartureCheckInput, Stop, StopEventInput, Trip, Vehicle } from '../../domain/contract';
import type { ApiListener } from '../port';
import { HttpClient, type HttpClientOptions } from './client';

const enc = encodeURIComponent;

export class HttpTms {
  readonly client: HttpClient;
  constructor(opt: HttpClientOptions) {
    this.client = new HttpClient(opt);
  }
  onApi(l: ApiListener) {
    this.client.onApi(l);
  }

  // fleet (조회)
  async listVehicles(): Promise<Vehicle[]> {
    const r = await this.client.call<{ items?: Vehicle[] } | Vehicle[]>('GET', '/vehicles');
    return Array.isArray(r.body) ? r.body : (r.body.items ?? []);
  }
  async listDrivers(): Promise<Driver[]> {
    const r = await this.client.call<{ items?: Driver[] } | Driver[]>('GET', '/drivers');
    return Array.isArray(r.body) ? r.body : (r.body.items ?? []);
  }

  // execution
  async getTrip(tripId: string): Promise<Trip> {
    return (await this.client.call<Trip>('GET', `/trips/${enc(tripId)}`)).body;
  }
  async recordPreDepartureCheck(tripId: string, body: PreDepartureCheckInput, key: string, expectedVersion?: number) {
    return (await this.client.call<{ checkId: string; result: 'PASS' | 'FAIL' }>('POST', `/trips/${enc(tripId)}/pre-departure-checks`, { body, idempotencyKey: key, expectedVersion })).body;
  }
  async recordDeparture(tripId: string, body: DepartureInput, key: string, expectedVersion?: number): Promise<Departure> {
    return (await this.client.call<Departure>('POST', `/trips/${enc(tripId)}/departures`, { body, idempotencyKey: key, expectedVersion })).body;
  }
  async recordStopArrival(tripId: string, stopId: string, body: StopEventInput, key: string): Promise<Stop> {
    return (await this.client.call<Stop>('POST', `/trips/${enc(tripId)}/stops/${enc(stopId)}/arrivals`, { body, idempotencyKey: key })).body;
  }
  async recordUnloadingStart(tripId: string, stopId: string, body: StopEventInput, key: string): Promise<Stop> {
    return (await this.client.call<Stop>('POST', `/trips/${enc(tripId)}/stops/${enc(stopId)}/unloading-starts`, { body, idempotencyKey: key })).body;
  }
  async recordHandover(tripId: string, stopId: string, body: HandoverInput, key: string): Promise<Handover> {
    return (await this.client.call<Handover>('POST', `/trips/${enc(tripId)}/stops/${enc(stopId)}/handovers`, { body, idempotencyKey: key })).body;
  }
  async recordStopDeparture(tripId: string, stopId: string, body: StopEventInput, key: string): Promise<Stop> {
    return (await this.client.call<Stop>('POST', `/trips/${enc(tripId)}/stops/${enc(stopId)}/departures`, { body, idempotencyKey: key })).body;
  }
  async recordPhysicalEnd(tripId: string, body: { endedAt: string; returnCenterId: string }, key: string): Promise<Trip> {
    return (await this.client.call<Trip>('POST', `/trips/${enc(tripId)}/physical-ends`, { body, idempotencyKey: key })).body;
  }
}
