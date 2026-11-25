// 하루 돌리기 — 화면 없이 08:00 ~ 22:30. 보충 → Wave 배포 → FC 피킹 → 분배·라인 → 자키 출고대기.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock/MockBackend';
import { buildCatalog } from '../src/domain/catalog';
import { buildLayout } from '../src/domain/layout';
import { Simulation } from '../src/sim/simulation';
import { FloorSite } from '../src/sim/site';

const BASE = '2026-11-25';
const layout = buildLayout();
const catalog = buildCatalog(layout, BASE);

async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

async function runUntil(sim: Simulation, hour: number, step = 5) {
  while (sim.time < hour * 3600) {
    sim.step(step);
    await flush();
  }
}

describe('걷는 길 [시뮬]', () => {
  it('길은 가로·세로로만 꺾이고 목적지에서 끝난다', () => {
    for (const f of layout.floors) {
      const site = new FloorSite(f, layout);
      const from = site.home();
      for (const to of [site.front(f.shelves[0]), site.front(f.locations[f.locations.length - 1]), site.station()]) {
        const pts = site.route(from, to);
        expect(pts[pts.length - 1]).toEqual({ x: to.x, z: to.z });
        let a = { x: from.x, z: from.z };
        for (const b of pts) {
          expect(a.x === b.x || a.z === b.z).toBe(true);
          a = b;
        }
      }
    }
  });
});

describe('하루 돌리기', () => {
  it('보충 → 배포 → FC 피킹 → 분배·라인 → 자키: 22:30 까지 모든 작업이 끝나고 분류 = 실피킹, 원장 정상', async () => {
    let sim!: Simulation;
    const backend = new MockBackend({ now: () => sim?.time ?? 0, baseDate: BASE, catalog });
    sim = new Simulation(layout, catalog, backend, { baseDate: BASE, seed: 11, linesPerMfc: 30 });
    const initial = backend.ledger.totals();

    await runUntil(sim, 12.9);
    expect(backend.listTransfers()).toHaveLength(15); // MFC 5곳 × 온도대 3 (TMS D-10)
    expect(backend.replenishmentNeeds()).toEqual([]); // 주간조가 13시 전에 보충을 끝냄
    expect(sim.agents.filter((a) => a.role === 'REPL' && a.shift === 'DAY').some((a) => a.done > 0)).toBe(true);

    await runUntil(sim, 22.5);
    const s = sim.summary();
    expect(s.released).toBe(true);
    expect(s.tasks).toBeGreaterThan(0);
    expect(s.tasksDone).toBe(s.tasks);
    expect(s.picked).toBeGreaterThan(0);
    expect(s.sorted).toBe(s.picked);
    const wave = await backend.getWave(s.waveId);
    expect(wave.state).toBe('WORK_DONE');
    for (const t of backend.listTransfers()) expect(['SORTED', 'INSPECTED', 'LOADED']).toContain(t.state);
    // 피킹·분류·검품·상차는 총현물을 바꾸지 않는다(WMS 0.3) — 22:30 은 아직 출차 전
    expect(backend.ledger.totals().onHand).toBe(initial.onHand);
    expect(backend.ledger.totals().transit).toBe(0);
    expect(backend.ledger.check()).toEqual([]);
    // 설계 §5.4 1단계: DPS(냉동)·박스/FC 바로 출고대기·라인(DAS)·분배(야채)가 다 돌았고, 표시등이 켜졌다
    expect(sim.sealedBy.DPS).toBeGreaterThan(0);
    expect(sim.sealedBy.DIRECT).toBeGreaterThan(0);
    expect(sim.sealedBy.LINE).toBeGreaterThan(0);
    expect(sim.sealedBy.SPLIT).toBeGreaterThan(0);
    expect(sim.sealedBy.SORTER).toBeGreaterThan(0); // C·D 박스는 휠소터
    expect(sim.sealedBy.PORT).toBeGreaterThan(0); // 7F H 는 오토스토어 포트
    expect(sim.lineLitMax).toBeGreaterThanOrEqual(2); // 라인: 스캔 한 번에 여러 MFC 칸 불(시험은 MFC 당 30줄이라 겹침이 적다)
    expect(sim.litCount).toBeGreaterThan(0);
    expect(sim.lights).toEqual([]);
    // 석간 FC 는 걸었다 — 걸음 수 표시용 거리
    expect(sim.agents.filter((a) => a.role === 'FC').every((a) => a.distance > 0)).toBe(true);
    expect(sim.events.filter((e) => e.kind === 'warn' && !e.text.includes('결품') && !e.text.includes('검품 불합격'))).toEqual([]);

    // 22:00 R/T 카운팅·배차 → 출차 30분 전 상차(방문 역순) → 노선별 출차(TOUT) → 도착·하차·인계 → MFC 수령 → 복귀
    await runUntil(sim, 24 + 10.5);
    expect(sim.events.some((e) => e.text.startsWith('22:00 R/T 카운팅'))).toBe(true);
    const runs = [...sim.runs.values()];
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.state).toBe('RETURNED');
      expect(r.result).toBe('MATCHED');
      expect(r.departedAt! / 60).toBeGreaterThanOrEqual(23 * 60); // 첫 출차 23:00 이후
      expect(Math.ceil(r.loaded.length / 10)).toBeLessThanOrEqual(20); // 5톤 20 R/T
      expect(new Set(r.loaded.map((b) => b.temp)).size).toBe(1); // 차 한 대 = 온도대 하나
      for (const st of r.stops) expect(st.handedAt! / 60).toBeLessThanOrEqual(24 * 60 + 8 * 60); // 인계 08:00 까지
      const trip = sim.tms.getTrip(r.plan.tripId);
      expect(trip.state).toBe('CLOSED'); // 출발 q = 수령 r
    }
    // 부산권 멀티드롭: 진구 → 남구 순서로 도착, 상차는 방문 역순(남구 R/T 먼저)
    const busan = runs.find((r) => r.plan.routeId === 'RT-BUSAN' && r.plan.temp === 'AMBIENT')!;
    expect(busan.stops.map((s) => s.mfcId)).toEqual(['MFC-BJG-01', 'MFC-BNG-01']);
    expect(busan.stops[0].arrivedAt!).toBeLessThan(busan.stops[1].arrivedAt!);
    expect(busan.loaded[0].mfcId).toBe('MFC-BNG-01');
    const after = sim.summary();
    expect(after.departed).toBe(after.sorted);
    for (const t of backend.listTransfers()) expect(t.state).toBe('DEPARTED');
    const tot = backend.ledger.totals();
    expect(tot.onHand).toBe(initial.onHand - after.departed);
    expect(tot.acked).toBe(after.departed); // MFC 가 다 받음
    expect(tot.transit).toBe(0);
    expect(tot.reserved).toBe(0);
    expect(backend.ledger.check()).toEqual([]);
    expect(sim.events.filter((e) => e.kind === 'warn' && !e.text.includes('결품') && !e.text.includes('검품 불합격'))).toEqual([]);
  }, 120_000);
});
