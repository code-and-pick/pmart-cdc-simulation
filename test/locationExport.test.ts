// 위치 목록 내보내기 — cdc-location 0.2.0 LocationInput 규칙(CDC-7)
import { describe, expect, it } from 'vitest';
import { buildLayout, LOCATION_CODE_PATTERN } from '../src/domain/layout';
import { buildLocationExport } from '../src/domain/locationExport';

const ex = buildLocationExport(buildLayout());

describe('위치 목록 내보내기 [CDC-7, cdc-location 0.2.0]', () => {
  it('랙·선반·출고대기·승강기 문·층 도크가 다 있고 코드가 겹치지 않는다', () => {
    // 18,000 = SKU 자리(사용자 2026-11-26 — 팔레트 칸 수가 아님). 피킹 자리(PICK_FACE)가 SKU 18,000 을 넘고, 보관(RESERVE)은 냉장 랙을 며칠치로
    expect(ex.counts.PICK_FACE).toBeGreaterThanOrEqual(18_000);
    expect(ex.counts.RESERVE).toBe(14_768); // 층 재설계(5F 냉장 3일치 · 냉동, 6F·7F 상온) — 사용자 2026-11-26
    expect(ex.counts.STAGING).toBe(36 + 45 * 2 + 2 * 3); // 출고대기 5F 목적지 9곳 × 2칸 × 2글자 · 6F·7F 3줄 × 15칸 + 승강기 문 2 × 3층
    expect(ex.counts.DOCK).toBe(2 + 2 + 4 + 4); // 5F 냉장 2 · 냉동 2 · 6F 상온 4 · 7F 상온 4
    expect(new Set(ex.items.map((i) => i.locationCode)).size).toBe(ex.items.length);
    for (const i of ex.items) {
      expect(i.locationCode).toMatch(LOCATION_CODE_PATTERN);
      expect(ex.geometry[i.locationCode]).toBeDefined();
    }
  });

  it('통로 01~60 팔레트(단 1~4·슬롯 1~2, A·B·E·H 1단은 PICK_FACE), 61~89 PICK_FACE(선반 단 1~5·칸 1~3 · 오토스토어 단 1~16·칸 1~2), 90 DOCK, 91·92 STAGING, 93 야채 레인 PICK_FACE', () => {
    for (const i of ex.items) {
      const [, zone, , aisle, bay, level, slot] = i.locationCode.split('-').map((x, k) => (k >= 3 ? Number(x) : x)) as [string, string, string, number, number, number, number];
      if (aisle <= 60) {
        expect(i.locationType).toBe(['A', 'B', 'E', 'H'].includes(zone) && level === 1 ? 'PICK_FACE' : 'RESERVE');
        expect(level >= 1 && level <= 4 && slot >= 1 && slot <= 2).toBe(true);
      } else if (aisle === 93) {
        expect(i.locationType).toBe('PICK_FACE');
      } else if (aisle <= 89) {
        expect(i.locationType).toBe('PICK_FACE');
        expect(bay >= 1 && level >= 1 && level <= (zone === 'F' || zone === 'C' ? 16 : 5) && slot >= 1 && slot <= 3).toBe(true);
        expect(i.pickFaceMinQty).toBeNull();
        expect(i.pickFaceTargetQty).toBeNull();
      } else if (aisle === 90) expect(i.locationType).toBe('DOCK');
      else expect(i.locationType).toBe('STAGING');
    }
  });
});
