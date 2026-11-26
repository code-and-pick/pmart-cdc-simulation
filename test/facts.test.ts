// 사용자 고정값(CLAUDE.md "절대 바꾸지 않는다")과 층 면적 — 바뀌면 이 시험이 깨진다.
import { describe, expect, it } from 'vitest';
import { CDC_FACTS, FLOOR_PYEONG, MFCS, isEtc } from '../src/config';
import { CHILGOK_FLOORS } from '../src/domain/sites/chilgok';

describe('칠곡 DC 고정값 [고정]', () => {
  it('이름·주소·면적·층·용량', () => {
    expect(CDC_FACTS.name).toBe('칠곡 중앙물류센터');
    expect(CDC_FACTS.short).toBe('칠곡 DC');
    expect(CDC_FACTS.address).toBe('경상북도 칠곡군 지천면 산단터널로 240');
    expect(CDC_FACTS.areaPyeong).toBe(8600);
    expect([...CDC_FACTS.floors]).toEqual([5, 6, 7]);
    expect(CDC_FACTS.capacityUnits).toBe(5_200_000);
  });

  it('층 면적 합 = 8,600평, 층마다 약 2,867평', () => {
    const v = Object.values(FLOOR_PYEONG);
    expect(v.reduce((a, b) => a + b, 0)).toBe(CDC_FACTS.areaPyeong);
    for (const p of v) expect(Math.abs(p - CDC_FACTS.areaPyeong / 3)).toBeLessThan(1);
  });

  it('층별 문서 면적(보관 + 도크·분류)이 층 면적과 같다 — 보관 합은 물량 30만 층 재설계(사용자 2026-11-26, 개념도 CDC-2 에서 바뀜 → 백엔드 R-25)', () => {
    let dt = 0;
    const storage: Record<string, number> = {};
    for (const f of CHILGOK_FLOORS) {
      const s = Object.values(f.docPyeong.storage).reduce((a, b) => a + b, 0);
      expect(s + f.docPyeong.dt).toBe(FLOOR_PYEONG[f.floor]);
      dt += f.docPyeong.dt;
      for (const [k, n] of Object.entries(f.docPyeong.storage)) storage[k] = (storage[k] ?? 0) + n;
    }
    expect(dt).toBe(633 + 959 + 959); // 6F·7F 랙 묶음 10칸 → 앞쪽 띠가 깊음(건물은 그대로)
    expect(storage).toEqual({ 상온: 1908 * 2, 냉동: 1593, 냉장: 640 });
  });

  it('공급 대상 MFC 5곳(출고대기 01~05) [정본 CDC-6] + 권역별 기타 센터 4곳(06~09, 물량 30만 — 사용자 2026-11-26)', () => {
    expect(MFCS.filter((m) => !isEtc(m.id)).map((m) => m.id)).toEqual(['MFC-BJG-01', 'MFC-BNG-01', 'MFC-MOKPO-01', 'MFC-SEJ-01', 'MFC-CHC-01']);
    expect(MFCS.map((m) => m.staging)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(MFCS.filter((m) => isEtc(m.id)).map((m) => m.region)).toEqual(['부산권', '호남권', '충청권', '강원권']);
  });
});
