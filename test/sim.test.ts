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
    expect(backend.listTransfers()).toHaveLength(5);
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
    // 석간 FC 는 걸었다 — 걸음 수 표시용 거리
    expect(sim.agents.filter((a) => a.role === 'FC').every((a) => a.distance > 0)).toBe(true);
    expect(sim.events.filter((e) => e.kind === 'warn' && !e.text.includes('결품') && !e.text.includes('검품 불합격'))).toEqual([]);

    // 22:00 R/T 카운팅 → 22:30 상차 → 23:00~ 출차(이때만 TOUT: CDC −q · Transit +q)
    await runUntil(sim, 24.5);
    expect(sim.events.some((e) => e.text.startsWith('22:00 R/T 카운팅'))).toBe(true);
    for (const t of sim.trucks.values()) {
      expect(t.state).toBe('DEPARTED');
      expect(t.result).toBe('MATCHED');
    }
    const after = sim.summary();
    expect(after.departed).toBe(after.sorted); // 분류한 것은 모두 검품·하강·상차되어 출발
    for (const t of backend.listTransfers()) {
      expect(t.state).toBe('DEPARTED');
      const m = await backend.getShipmentManifest(t.trfId);
      expect(m.lines.reduce((a, l) => a + l.qty, 0)).toBe(t.progress.reduce((a, p) => a + p.departedQty, 0));
    }
    const tot = backend.ledger.totals();
    expect(tot.onHand).toBe(initial.onHand - after.departed);
    expect(tot.transit).toBe(after.departed);
    expect(tot.reserved).toBe(0); // 결품 잔량 등은 잔량 정리로 해제
    expect(backend.ledger.check()).toEqual([]);
    expect(sim.events.filter((e) => e.kind === 'warn' && !e.text.includes('결품') && !e.text.includes('검품 불합격'))).toEqual([]);
  }, 120_000);
});
