// 칠곡 DC 배치 — 통로·칸 수, 위치 코드 계약 패턴, 용량 합 520만.
import { describe, expect, it } from 'vitest';
import { CDC_FACTS } from '../src/config';
import { buildLayout, LOCATION_CODE_PATTERN, skuQuota } from '../src/domain/layout';

const L = buildLayout();
const all = L.floors.flatMap((f) => f.locations);

describe('층·구역 배치 [정본 CDC-2, R-10]', () => {
  it('층별 구역과 통로', () => {
    const aisles = (fl: number) => L.floors.find((f) => f.floor === fl)!.aisles.map((a) => a.plate);
    expect(aisles(5)).toEqual([
      'C01', 'C02', 'C03', 'D01', 'D02', 'D03', 'E01', 'E02', 'E03', 'F01', 'F02', 'F03',
      ...Array.from({ length: 12 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`),
    ]);
    expect(aisles(6)).toEqual(Array.from({ length: 18 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`));
    expect(aisles(7)).toEqual([...Array.from({ length: 10 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 10 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`)]);
  });

  it('팔레트 위치 19,840 (상온 32×40×4×2 · 냉장 18×40×4×2 · 냉동 12×40×4×2) — 모두 4단 [사용자 랙 규격]', () => {
    expect(all.filter((l) => l.temp === 'AMBIENT')).toHaveLength(10_240);
    expect(all.filter((l) => l.temp === 'CHILLED')).toHaveLength(5_760);
    expect(all.filter((l) => l.temp === 'FROZEN')).toHaveLength(3_840);
    expect(all).toHaveLength(19_840);
  });

  it('팔레트 랙은 모두 보관(RESERVE), 피킹은 MFC 같은 선반(PICK_FACE, 통로 61~) [사용자 2026-11-25]', () => {
    expect(all.every((l) => l.type === 'RESERVE')).toBe(true);
    const shelves = L.floors.flatMap((f) => f.shelves);
    expect(shelves.every((l) => l.type === 'PICK_FACE' && l.aisle >= 61 && l.aisle < 90 && l.level <= 5 && l.slot <= 3)).toBe(true);
    for (const [z, n] of skuQuota()) expect(shelves.filter((l) => l.zone === z).length).toBeGreaterThanOrEqual(n);
    expect([...skuQuota().values()].reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it('선반은 북쪽 띠 안, 승강기·출고대기 줄 남쪽, 설비와 겹치지 않는다', () => {
    for (const f of L.floors) {
      for (const r of f.shelfRows) {
        expect(r.z0).toBeGreaterThan(f.walk.northZ);
        expect(r.z1).toBeLessThan(L.bandDepth);
        for (const e of f.equipment.filter((x) => x.rect.z0 < L.bandDepth)) expect(r.cx < e.rect.x0 || r.cx > e.rect.x1).toBe(true);
      }
    }
  });

  it('랙이 층 바닥 안에 있다', () => {
    for (const f of L.floors) for (const r of f.rows) expect(r.cx).toBeLessThan(L.width);
    expect(L.bandDepth).toBeGreaterThan(10);
  });
});

describe('위치 코드 [정본 CDC-3·5]', () => {
  it('모든 칸·출고대기·승강기 문·지하 접안 코드가 계약 패턴에 맞고 겹치지 않는다', () => {
    const codes = [...all, ...L.floors.flatMap((f) => f.shelves), ...L.floors.flatMap((f) => f.staging), ...L.docks].map((l) => l.code).concat(L.floors.flatMap((f) => f.lifts.map((x) => x.code)));
    for (const c of codes) expect(c).toMatch(LOCATION_CODE_PATTERN);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('예시 코드가 있다', () => {
    const set = new Set(all.map((l) => l.code));
    expect(set.has('CDC01-C-5-02-24-3-1')).toBe(true);
    expect(set.has('CDC01-B-6-03-10-1-2')).toBe(true);
    expect(set.has('CDC01-A-5-05-10-2-2')).toBe(true);
    expect(set.has('CDC01-G-7-07-24-3-1')).toBe(true);
    expect(L.floors.find((f) => f.floor === 7)!.lifts[0].code).toBe('CDC01-G-7-92-01-0-1');
    expect(L.floors.find((f) => f.floor === 6)!.staging[1].code).toBe('CDC01-B-6-91-02-0-1');
    expect(L.docks.some((d) => d.code.startsWith('CDC01-B-B1-90-'))).toBe(true);
  });

  it('모든 랙은 4단 — 5단 칸이 없다 [사용자 랙 규격]', () => {
    expect(Math.max(...all.map((l) => l.level))).toBe(4);
  });
});

describe('보관 용량 520만 유닛 [고정]', () => {
  it('팔레트 칸 + 선반 칸 용량 합 + 오토스토어 = 5,200,000', () => {
    expect(L.totalCapacity).toBe(CDC_FACTS.capacityUnits);
    expect(all.every((l) => l.capacity > 0)).toBe(true);
  });
});
