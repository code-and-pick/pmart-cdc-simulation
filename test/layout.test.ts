// 칠곡 DC 배치 — 통로·칸 수, 온도 방, 용량·SKU 자리 계산, 위치 코드 계약 패턴 (사용자 2026-11-25 지시문 §1~§5).
import { describe, expect, it } from 'vitest';
import { AUTOSTORE, BUILDING, CHILLED_RACK, PYEONG_M2, RACK, SKU_TARGET } from '../src/config';
import { buildLayout, LOCATION_CODE_PATTERN, skuQuota, type Rect } from '../src/domain/layout';

const L = buildLayout();
const all = L.floors.flatMap((f) => f.locations);
const F = (n: number) => L.floors.find((f) => f.floor === n)!;
const inRects = (x: number, z: number, rs: Rect[]) => rs.some((r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6);

describe('기준값 [사용자 §1]', () => {
  it('천장 8.5~9m — 상온 랙 6m 4단 그대로, 저온 짐 1.7m, 5단 없음', () => {
    expect(BUILDING.ceilingH).toBeGreaterThanOrEqual(8.5);
    expect(BUILDING.ceilingH).toBeLessThanOrEqual(9);
    expect(RACK.height + RACK.pallet.h).toBeLessThanOrEqual(BUILDING.ceilingH); // 맨 위 짐 꼭대기
    expect(RACK.height + BUILDING.coldPalletH).toBeLessThanOrEqual(BUILDING.ceilingH - BUILDING.coldCeilingLoss);
    expect(Math.max(...all.map((l) => l.level))).toBe(4);
  });

  it('SKU 18,000 = 냉동 4,000 · 냉장 5,500 · 상온 8,500 (MFC 칸 비율 22:31:47)', () => {
    expect(SKU_TARGET.FROZEN + SKU_TARGET.CHILLED + SKU_TARGET.AMBIENT).toBe(SKU_TARGET.total);
    expect([...skuQuota().values()].reduce((a, b) => a + b, 0)).toBe(18_000);
  });
});

describe('층 배치 [사용자 §3]', () => {
  it('5F·7F 보관 방(팔레트 랙) = 문서 보관 평수', () => {
    for (const f of [F(5), F(7)]) for (const r of f.rooms) expect(((r.rect.x1 - r.rect.x0) * (r.rect.z1 - r.rect.z0)) / PYEONG_M2).toBeCloseTo(f.spec.docPyeong.storage[r.key], 6);
  });

  it('5F: 냉동 피킹 선반·DPS 박스 컨베이어는 냉동 랙 앞(같은 x) 전실 — 냉동 방 안, 휠소터·상온 입고 검수는 상온 랙 앞, 냉동 입고 검수는 B1', () => {
    const f = F(5);
    const frz = f.coldRooms.find((r) => r.temp === 'FROZEN')!;
    const frzRack = f.rooms.find((r) => r.temp === 'FROZEN')!.rect;
    for (const l of f.shelves.filter((s) => s.zone === 'A')) {
      expect(inRects(l.pos.x, l.pos.z, frz.rects)).toBe(true);
      expect(l.pos.x > frzRack.x0 && l.pos.x < frzRack.x1).toBe(true);
    }
    const amb = f.rooms.find((r) => r.temp === 'AMBIENT')!.rect;
    const s = f.equipment.find((x) => x.kind === 'WHEEL_SORTER' && x.temp === 'AMBIENT')!;
    expect(s.rect.x0 >= amb.x0 && s.rect.x1 <= amb.x1).toBe(true);
    expect(f.equipment.some((e) => e.kind === 'INBOUND')).toBe(false); // 5F 띠가 모자라 입고 검수는 B1 도크 쪽
    expect(L.b1Equipment.some((e) => e.kind === 'INBOUND' && e.temp === 'FROZEN')).toBe(true);
    const dps = f.equipment.find((x) => x.kind === 'DPS')!;
    expect(inRects((dps.rect.x0 + dps.rect.x1) / 2, (dps.rect.z0 + dps.rect.z1) / 2, frz.rects)).toBe(true);
    expect(frz.doors.map((d) => d.kind).sort()).toEqual(['AIR_CURTAIN', 'ANTEROOM', 'FORKLIFT']);
  });

  it('6F: 승강기·출고대기 줄을 뺀 층 전체가 냉장 방, 동쪽 라인 → 분배 → 야채 레인, 랙 통로는 출발 10 에서 팔레트 하한으로 늘림', () => {
    const f = F(6);
    const ch = f.coldRooms.find((r) => r.temp === 'CHILLED')!;
    for (const l of [...f.locations, ...f.shelves]) expect(inRects(l.pos.x, l.pos.z, ch.rects)).toBe(true);
    for (const s of f.staging) expect(inRects(s.pos.x, s.pos.z, ch.rects)).toBe(false);
    for (const k of ['DAS', 'SPLIT', 'VEG_LANES', 'INBOUND'] as const) {
      const e = f.equipment.find((x) => x.kind === k)!;
      expect(inRects((e.rect.x0 + e.rect.x1) / 2, (e.rect.z0 + e.rect.z1) / 2, ch.rects)).toBe(true);
    }
    const split = f.equipment.find((x) => x.kind === 'SPLIT')!.rect;
    const lanes = f.equipment.find((x) => x.kind === 'VEG_LANES')!.rect;
    expect(split.z1 <= lanes.z0).toBe(true); // 분배 → 야채 레인(남)
    expect(f.aisles.length).toBeGreaterThanOrEqual(CHILLED_RACK.startAisles);
    expect(f.shelves.filter((l) => l.lane).length).toBeGreaterThanOrEqual(300);
  });

  it('7F: 오토스토어 = 그린 면적에 통이 다 들어가고, 바닥 하중 확인 값이 있다', () => {
    const a = L.autostore!;
    expect(a.binsFit).toBeGreaterThanOrEqual(a.bins);
    expect(a.compartments).toBe(F(7).shelves.filter((l) => l.bin).length);
    expect(a.capacity).toBe(a.compartments * AUTOSTORE.unitsPerCompartment);
    expect(a.floorLoadKgM2).toBeLessThanOrEqual(a.floorLoadAllowedKgM2);
    expect(F(5).equipment.some((e) => e.kind === 'AUTOSTORE')).toBe(false);
  });

  it('랙 묶음 = 12개 × 양면 24개, 묶음 사이 지게차 통로 3.0m', () => {
    for (const f of L.floors) {
      for (const r of f.rows) expect((r.z1 - r.z0) / RACK.bayW).toBeCloseTo(RACK.bundleBays, 6);
      for (const r of f.rows) expect(f.rows.filter((o) => o !== r && o.z0 === r.z0 && Math.abs(Math.abs(o.cx - r.cx) - RACK.depth) < 1e-6)).toHaveLength(1);
    }
  });
});

describe('출고 흐름 배치 [사용자 §9]', () => {
  it('층마다 휠소터 줄과 DAS 존이 출고대기 바로 앞 — DAS 존 x 가 출고대기 x 와 겹치고, 휠소터 줄은 출고대기와 DAS 존 사이', () => {
    for (const f of L.floors) {
      const das = f.equipment.filter((e) => e.kind === 'DAS');
      expect(das.length).toBeGreaterThan(0);
      for (const d of das) {
        const letter = d.temp === 'CHILLED' ? 'B' : f.floor === 7 ? 'G' : 'C';
        const xs = f.staging.filter((s) => s.zone === letter).map((s) => s.pos.x);
        expect(d.rect.x0 <= Math.min(...xs) && d.rect.x1 >= Math.max(...xs)).toBe(true);
        const sorter = f.equipment.find((e) => e.kind === 'WHEEL_SORTER' && e.temp === d.temp)!;
        expect(sorter.rect.z0 > Math.max(...f.staging.map((s) => s.pos.z)) && sorter.rect.z1 <= d.rect.z0).toBe(true);
      }
    }
  });
});

describe('용량·SKU 자리 계산 [사용자 §4]', () => {
  it('총 용량 = 팔레트 칸 × 평균 유닛 + 선반 × 80 + 레인 + 오토스토어 — 계산값, 520만 이상, 팔레트 18,000 이상', () => {
    const c = L.capacity;
    const sum = L.floors.reduce((s, f) => s + [...f.locations, ...f.shelves].reduce((a, l) => a + l.capacity, 0), 0);
    expect(c.total).toBe(sum);
    expect(c.total).toBeGreaterThanOrEqual(c.target);
    expect(c.shortfall).toBe(0);
    expect(c.pallets).toBeGreaterThanOrEqual(CHILLED_RACK.palletMin);
  });

  it('SKU 자리(선반 + 랙 1단 박스 피킹면 + 야채 레인 + 오토스토어) — 온도대별 목표·18,000 이상', () => {
    const c = L.capacity;
    for (const t of ['FROZEN', 'CHILLED', 'AMBIENT'] as const) expect(c.byTemp[t].skuSlots).toBeGreaterThanOrEqual(SKU_TARGET[t]);
    expect(c.skuSlots).toBeGreaterThanOrEqual(18_000);
  });
});

describe('위치 코드 [정본 CDC-3·5]', () => {
  it('모든 칸·출고대기·승강기 문·지하 접안 코드가 계약 패턴에 맞고 겹치지 않는다', () => {
    const codes = [...all, ...L.floors.flatMap((f) => f.shelves), ...L.floors.flatMap((f) => f.staging), ...L.docks].map((l) => l.code).concat(L.floors.flatMap((f) => f.lifts.map((x) => x.code)));
    for (const c of codes) expect(c).toMatch(LOCATION_CODE_PATTERN);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('랙 1단 박스 피킹면(5F C·D, 7F G·H)은 PICK_FACE, 그 밖 팔레트는 RESERVE', () => {
    for (const l of all) expect(l.type).toBe(['C', 'D', 'G', 'H'].includes(l.zone) && l.level === 1 ? 'PICK_FACE' : 'RESERVE');
  });
});
