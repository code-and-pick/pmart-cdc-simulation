// 피킹면 최소·목표 설정 목록 — cdc-location `POST /internal/pick-face-settings`(0.7.0, 한 번에 2,000칸) 요청 본문 그대로 [시뮬 값, PICK_FACE_RULE].
// PICK_FACE 칸만, 목표 ≥ 최소, 단위 낱개. 오토스토어 통은 뺀다(보충은 입고 포트).
import { CENTER_ID, PICK_FACE_RULE } from '../config';
import type { Layout } from './layout';

export interface PickFaceSetting {
  locationCode: string;
  pickFaceMinQty: number;
  pickFaceTargetQty: number;
}

export function buildPickFaceSettings(layout: Layout): { centerId: string; rule: typeof PICK_FACE_RULE; items: PickFaceSetting[] } {
  const items: PickFaceSetting[] = [];
  const faces = layout.floors.flatMap((f) => [...f.shelves.filter((l) => !l.bin), ...f.locations.filter((l) => l.type === 'PICK_FACE')]);
  for (const l of faces) {
    const target = Math.max(1, Math.floor(l.capacity * PICK_FACE_RULE.targetPct));
    const min = Math.min(target, Math.max(0, Math.floor(l.capacity * PICK_FACE_RULE.minPct)));
    items.push({ locationCode: l.code, pickFaceMinQty: min, pickFaceTargetQty: target });
  }
  items.sort((a, b) => (a.locationCode < b.locationCode ? -1 : 1));
  return { centerId: CENTER_ID, rule: PICK_FACE_RULE, items };
}

/** 2,000칸씩 나눈 요청 본문들 */
export function pickFaceSettingBatches(layout: Layout, size = 2000) {
  const all = buildPickFaceSettings(layout);
  const out: { centerId: string; items: PickFaceSetting[] }[] = [];
  for (let i = 0; i < all.items.length; i += size) out.push({ centerId: all.centerId, items: all.items.slice(i, i + size) });
  return out;
}
