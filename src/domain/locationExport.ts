// 칠곡 DC 배치 → cdc-location 0.2.0 LocationInput 목록 (백엔드 칠곡 시드 스크립트용, 백엔드 부탁 2026-11-25).
// 계약: cdc-location-service.yaml 0.2.0(PR #445, 병합 전) LocationInput·POST /internal/location-batches(2,000행씩).
// 팔레트 랙 01~60 RESERVE(5F C·D·7F G·H 1단은 박스 피킹면 PICK_FACE) · 피킹 선반·오토스토어 칸 61~89 PICK_FACE · 야채 바닥 레인 93 PICK_FACE · 출고대기 91·승강기 문 92 STAGING · 지하 접안 90 DOCK (CDC-5·7, 사용자 2026-11-25 지시문).
// 피킹면 최소·목표량은 설정값이라 비운다(null — 0 으로 대신하지 않음). 오토스토어 빈은 코드가 정해지지 않아 넣지 않는다(R-05).

import { CENTER_ID, RACK } from '../config';
import type { TemperatureZone } from './contract';
import type { Layout, Location } from './layout';

export interface LocationInput {
  locationCode: string;
  centerId: string;
  temperatureZone: TemperatureZone;
  locationType: 'RESERVE' | 'PICK_FACE' | 'STAGING' | 'DOCK' | 'QUARANTINE';
  capacity: { unit?: 'EACH' | 'BOX' | 'PLT'; maxQty?: number; maxWeightG?: number };
  restrictions?: string[];
  pickFaceMinQty?: number | null;
  pickFaceTargetQty?: number | null;
}

export interface LocationExport {
  centerId: string;
  /** 무엇으로 만들었는지 — 계약·배치 근거 */
  source: string;
  counts: Record<string, number>;
  items: LocationInput[];
  /** 화면 좌표(m, x 동 · z 남 · y 높이) — 계약 밖, 도면 확인용 */
  geometry: Record<string, { floor: string; x: number; y: number; z: number }>;
}

/** 팔레트 칸 하나 하중(g) — 단당 2톤을 팔레트 2개가 나눔 [사용자 랙 규격] */
const PALLET_SLOT_WEIGHT_G = (RACK.levelLoadKg / RACK.slots) * 1000;

export function buildLocationExport(layout: Layout): LocationExport {
  const items: LocationInput[] = [];
  const geometry: LocationExport['geometry'] = {};
  const put = (l: Location, input: Omit<LocationInput, 'locationCode' | 'centerId' | 'temperatureZone'>) => {
    items.push({ locationCode: l.code, centerId: CENTER_ID, temperatureZone: l.temp, ...input });
    geometry[l.code] = { floor: String(l.floor), x: round(l.pos.x), y: round(l.pos.y), z: round(l.pos.z) };
  };
  for (const f of layout.floors) {
    for (const l of f.locations) put(l, { locationType: l.type === 'PICK_FACE' ? 'PICK_FACE' : 'RESERVE', capacity: { unit: 'EACH', maxQty: l.capacity, maxWeightG: PALLET_SLOT_WEIGHT_G } });
    for (const l of f.shelves) put(l, { locationType: 'PICK_FACE', capacity: { unit: 'EACH', maxQty: l.capacity }, pickFaceMinQty: null, pickFaceTargetQty: null });
    for (const l of f.staging) put(l, { locationType: 'STAGING', capacity: { unit: 'BOX' } });
    for (const lift of f.lifts) {
      const letter = lift.code.split('-')[1];
      const temp: TemperatureZone = letter === 'A' ? 'FROZEN' : letter === 'B' ? 'CHILLED' : 'AMBIENT';
      items.push({ locationCode: lift.code, centerId: CENTER_ID, temperatureZone: temp, locationType: 'STAGING', capacity: { unit: 'BOX' } });
      geometry[lift.code] = { floor: String(f.floor), x: round((lift.rect.x0 + lift.rect.x1) / 2), y: 0, z: round((lift.rect.z0 + lift.rect.z1) / 2) };
    }
  }
  for (const d of layout.docks) put(d, { locationType: 'DOCK', capacity: { unit: 'PLT' } });
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.locationType] = (counts[it.locationType] ?? 0) + 1;
  counts.TOTAL = items.length;
  return {
    centerId: CENTER_ID,
    source: 'pmart-cdc-simulation buildLayout() — chilgok-dc.md CDC-2·5·7, cdc-location 0.2.0 LocationInput',
    counts,
    items,
    geometry,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
