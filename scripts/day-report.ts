// 실규모 하루를 화면 없이 돌려 지표를 찍는다(npx vite-node scripts/day-report.ts) — 구조 비교용 [시뮬]
import { MockBackend } from '../src/backend/mock/MockBackend';
import { buildCatalog } from '../src/domain/catalog';
import { buildLayout } from '../src/domain/layout';
import { Simulation } from '../src/sim/simulation';
const BASE = '2026-11-25';
const layout = buildLayout();
const catalog = buildCatalog(layout, BASE);
let sim!: Simulation;
const backend = new MockBackend({ now: () => sim?.time ?? 0, baseDate: BASE, catalog });
sim = new Simulation(layout, catalog, backend, { baseDate: BASE, seed: 11 });
while (sim.time < 34 * 3600) {
  sim.step(5);
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
const s = sim.summary();
const bt = sim.boxTravel;
const by = (fl: number) => bt.filter((b) => b.floor === fl);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(JSON.stringify({ picked: s.picked, departed: s.departed, received: s.received, trips: `${s.tripsDone}/${s.trips}`, violations: backend.ledger.check().length }));
for (const fl of [5, 6, 7]) console.log(`${fl}F 박스 ${by(fl).length} · 롤테이너까지 평균 ${avg(by(fl).map((b) => b.dist)).toFixed(1)}m · ${avg(by(fl).map((b) => b.sec)).toFixed(0)}s`);
console.log(`전체 평균 ${avg(bt.map((b) => b.dist)).toFixed(1)}m · ${avg(bt.map((b) => b.sec)).toFixed(0)}s (박스 ${bt.length})`);
console.log(sim.events.filter((e) => /라인 DAS|오토스토어|Wave 배포/.test(e.text)).map((e) => e.text).join('\n'));
