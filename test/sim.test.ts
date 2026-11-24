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
    for (const t of backend.listTransfers()) expect(t.state).toBe('SORTED');
    // 자키가 분류한 박스를 모두 출고대기로
    const staged = [...sim.staged.values()].reduce((a, b) => a + b.units, 0);
    expect(staged).toBe(s.sorted);
    // 피킹·분류는 총현물을 바꾸지 않는다(WMS 0.3)
    expect(backend.ledger.totals().onHand).toBe(initial.onHand);
    expect(backend.ledger.check()).toEqual([]);
    // 석간 FC 는 걸었다 — 걸음 수 표시용 거리
    expect(sim.agents.filter((a) => a.role === 'FC').every((a) => a.distance > 0)).toBe(true);
    expect(sim.events.filter((e) => e.kind === 'warn' && !e.text.includes('결품'))).toEqual([]);
  }, 60_000);
});
