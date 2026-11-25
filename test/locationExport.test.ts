// 위치 목록 내보내기 — cdc-location 0.2.0 LocationInput 규칙(CDC-7)
import { describe, expect, it } from 'vitest';
import { buildLayout, LOCATION_CODE_PATTERN } from '../src/domain/layout';
import { buildLocationExport } from '../src/domain/locationExport';

const ex = buildLocationExport(buildLayout());

describe('위치 목록 내보내기 [CDC-7, cdc-location 0.2.0]', () => {
  it('랙·선반·출고대기·승강기 문·지하 접안이 다 있고 코드가 겹치지 않는다', () => {
    expect(ex.counts.RESERVE + ex.counts.PICK_FACE).toBeGreaterThanOrEqual(18_048 + 18_000);
    expect(ex.counts.RESERVE).toBe(18_048 - 1_440); // 팔레트 18,048 − 랙 1단 박스 피킹면 1,440(5F C·D 528 + 7F G 912 — H 는 오토스토어라 피킹면 없음)
    expect(ex.counts.STAGING).toBe(30 * 3 + 4 * 3);
    expect(ex.counts.DOCK).toBe(14);
    expect(new Set(ex.items.map((i) => i.locationCode)).size).toBe(ex.items.length);
    for (const i of ex.items) {
      expect(i.locationCode).toMatch(LOCATION_CODE_PATTERN);
      expect(ex.geometry[i.locationCode]).toBeDefined();
    }
  });

  it('통로 01~60 팔레트(단 1~4·슬롯 1~2, C·D·G 1단은 PICK_FACE), 61~89 PICK_FACE(선반 단 1~5·칸 1~3 · 오토스토어 단 1~16·칸 1~2), 90 DOCK, 91·92 STAGING, 93 야채 레인 PICK_FACE', () => {
    for (const i of ex.items) {
      const [, zone, , aisle, bay, level, slot] = i.locationCode.split('-').map((x, k) => (k >= 3 ? Number(x) : x)) as [string, string, string, number, number, number, number];
      if (aisle <= 60) {
        expect(i.locationType).toBe(['C', 'D', 'G'].includes(zone) && level === 1 ? 'PICK_FACE' : 'RESERVE');
        expect(level >= 1 && level <= 4 && slot >= 1 && slot <= 2).toBe(true);
      } else if (aisle === 93) {
        expect(i.locationType).toBe('PICK_FACE');
      } else if (aisle <= 89) {
        expect(i.locationType).toBe('PICK_FACE');
        expect(bay >= 1 && level >= 1 && level <= (zone === 'H' ? 16 : 5) && slot >= 1 && slot <= 3).toBe(true);
        expect(i.pickFaceMinQty).toBeNull();
        expect(i.pickFaceTargetQty).toBeNull();
      } else if (aisle === 90) expect(i.locationType).toBe('DOCK');
      else expect(i.locationType).toBe('STAGING');
    }
  });
});
