// 위치 → 통로 피킹 방식(cdc-location 0.5.0 aisle-pick-methods 를 칠곡 배치로 정한 값 [시뮬]) → 작업 모양(cdc-outbound 0.9.0).
import { AISLE_PICK_METHOD, SHELF, SKU_PLACE } from '../config';
import type { PickMethod, PickMode } from './contract';

/** 위치 코드의 통로 피킹 방식 — 팔레트 보관 칸·출고대기·접안은 방식 없음 */
export function pickMethodOf(locationCode: string): PickMethod | undefined {
  const [, zone, , aisleS, , levelS] = locationCode.split('-');
  const aisle = Number(aisleS);
  const level = Number(levelS);
  if (aisle < SHELF.aisleBase) return level === 1 && SKU_PLACE.faceZones.includes(zone) ? 'BOX_PICK' : undefined;
  if (aisle === AISLE_PICK_METHOD.vegLaneAisle) return 'DISTRIBUTION';
  if (aisle >= 90) return undefined;
  if (zone === AISLE_PICK_METHOD.frozenShelfZone) return 'DPS';
  if (zone === AISLE_PICK_METHOD.lineShelfZone) return 'LINE';
  return 'FC';
}

/** 방식 → 작업 모양 (cdc-outbound 0.9.0 releaseWave) */
export function pickModeOf(m: PickMethod | undefined): PickMode {
  return m === 'LINE' ? 'SKU_BATCH' : m === 'BOX_PICK' || m === 'FC' || m === 'DISTRIBUTION' ? 'REGION_BATCH' : 'DISCRETE';
}
