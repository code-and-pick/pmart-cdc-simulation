// 칠곡 DC 배치 — 통로·칸 수, 위치 코드 계약 패턴, 용량 합 520만.
import { describe, expect, it } from 'vitest';
import { CDC_FACTS, PYEONG_M2, RACK } from '../src/config';
import { buildLayout, LOCATION_CODE_PATTERN, shelfTargets, skuQuota } from '../src/domain/layout';

const L = buildLayout();
const all = L.floors.flatMap((f) => f.locations);

describe('층·구역 배치 [정본 CDC-2, R-10]', () => {
  it('층별 구역과 통로 — 통로 수는 방 면적에서 [사용자 2026-11-25]', () => {
    const aisles = (fl: number) => L.floors.find((f) => f.floor === fl)!.aisles.map((a) => a.plate);
    expect(aisles(5)).toEqual([...Array.from({ length: 3 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 3 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 3 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 2 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 9 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`)]);
    expect(aisles(6)).toEqual([...Array.from({ length: 16 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`)]);
    expect(aisles(7)).toEqual([...Array.from({ length: 10 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 9 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`)]);
  });

  it('보관 방 = 문서 보관 평수, 나머지 = 문서 DT [정본 CDC-2, 사용자 2026-11-25 문서 면적 고정]', () => {
    for (const f of L.floors) {
      for (const r of f.rooms) expect(((r.rect.x1 - r.rect.x0) * (r.rect.z1 - r.rect.z0)) / PYEONG_M2).toBeCloseTo(f.spec.docPyeong.storage[r.key], 6);
      expect(Math.abs(f.layoutPyeong.band - f.spec.docPyeong.dt)).toBeLessThan(1.5);
      // 팔레트 랙은 그 온도대 방 안
      for (const l of f.locations) {
        const room = f.rooms.find((r) => r.temp === l.temp)!;
        expect(l.pos.x > room.rect.x0 && l.pos.x < room.rect.x1 && l.pos.z > room.rect.z0 && l.pos.z < room.rect.z1).toBe(true);
      }
      // 피킹 선반·설비(오토스토어 포함)는 DT — 보관 방 밖 [사용자 2026-11-25 2안]
      const inRoom = (x: number, z: number) => f.rooms.some((r) => x > r.rect.x0 && x < r.rect.x1 && z > r.rect.z0 && z < r.rect.z1);
      for (const l of f.shelves) expect(inRoom(l.pos.x, l.pos.z)).toBe(false);
      for (const e of f.equipment) expect(inRoom((e.rect.x0 + e.rect.x1) / 2, (e.rect.z0 + e.rect.z1) / 2)).toBe(false);
    }
  });

  it('랙 묶음 = 12개 × 양면 24개, 묶음 사이 지게차 통로 [사용자 2026-11-25]', () => {
    for (const f of L.floors) {
      for (const r of f.rows) expect((r.z1 - r.z0) / RACK.bayW).toBeCloseTo(RACK.bundleBays, 6);
      // 등 맞댄 두 줄(간격 = 랙 깊이)이 짝을 이룬다 — 짝 없는 줄 없음
      for (const r of f.rows) expect(f.rows.filter((o) => o !== r && o.z0 === r.z0 && Math.abs(Math.abs(o.cx - r.cx) - RACK.depth) < 1e-6)).toHaveLength(1);
      // 묶음 사이 통로 폭 = 지게차 통로 3.0 m
      const xs = [...new Set(f.rows.map((r) => r.cx.toFixed(3)))].map(Number).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i += 2) if (xs[i + 1] !== undefined) expect(xs[i + 1] - xs[i] - RACK.depth).toBeGreaterThanOrEqual(3.0 - 1e-6);
    }
    expect(RACK.aisleW).toBeGreaterThanOrEqual(3.0);
  });

  it('팔레트 위치 19,584 = 묶음 102 × 192 (상온 56 · 냉장 30 · 냉동 16 묶음) ≥ 18,000 [CDC-2 목표, R-17 회신] — 모두 4단', () => {
    expect(all.filter((l) => l.temp === 'AMBIENT')).toHaveLength(10_752);
    expect(all.filter((l) => l.temp === 'CHILLED')).toHaveLength(5_760);
    expect(all.filter((l) => l.temp === 'FROZEN')).toHaveLength(3_072);
    expect(all).toHaveLength(19_584);
    expect(all.length).toBeGreaterThanOrEqual(18_000);
    expect(Math.max(...all.map((l) => l.bay))).toBe(48);
  });

  it('팔레트 랙은 모두 보관(RESERVE), 피킹은 MFC 같은 선반(PICK_FACE, 통로 61~) [사용자 2026-11-25]', () => {
    expect(all.every((l) => l.type === 'RESERVE')).toBe(true);
    const shelves = L.floors.flatMap((f) => f.shelves);
    expect(shelves.every((l) => l.type === 'PICK_FACE' && l.aisle >= 61 && l.aisle < 90 && l.level <= 5 && l.slot <= 3)).toBe(true);
    for (const [z, n] of skuQuota()) expect(shelves.filter((l) => l.zone === z).length).toBeGreaterThanOrEqual(n);
    expect([...skuQuota().values()].reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it('피킹 선반 칸 — MFC 10,900 SKU 설계에 맞춤: 냉동 ≥ 2,180 · 냉장 ≥ 3,270 · 상온 ≥ 5,450, 통로 61~89 [사용자 2026-11-25, 백엔드 B-1]', () => {
    const shelves = L.floors.flatMap((f) => f.shelves);
    const by = (t: string) => shelves.filter((l) => l.temp === t).length;
    expect(by('FROZEN')).toBeGreaterThanOrEqual(2180);
    expect(by('CHILLED')).toBeGreaterThanOrEqual(3270);
    expect(by('AMBIENT')).toBeGreaterThanOrEqual(5450);
    expect(shelves.length).toBeGreaterThanOrEqual(10_900);
    expect(Math.max(...shelves.map((l) => l.aisle))).toBeLessThanOrEqual(89);
    for (const [z, n] of shelfTargets()) expect(shelves.filter((l) => l.zone === z).length).toBeGreaterThanOrEqual(n);
  });

  it('선반은 DT 북쪽 띠(북쪽 통로와 보관 방 사이), 설비와 겹치지 않는다', () => {
    for (const f of L.floors) {
      for (const r of f.shelfRows) {
        expect(r.z0).toBeGreaterThan(f.walk.northZ);
        expect(r.z1).toBeLessThan(f.walk.roomZ);
        for (const e of f.equipment) expect(r.cx < e.rect.x0 || r.cx > e.rect.x1 || r.z1 < e.rect.z0 || r.z0 > e.rect.z1).toBe(true);
      }
    }
  });

  it('랙이 층 바닥 안, 랙 앞 가로 통로 남쪽에 있다', () => {
    for (const f of L.floors) for (const r of f.rows) {
      expect(r.cx).toBeLessThan(L.width);
      expect(r.z0).toBeGreaterThan(f.walk.rackZ);
      expect(r.z1).toBeLessThan(L.depth);
    }
    expect(L.bandDepth).toBeGreaterThan(15);
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
