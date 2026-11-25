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
while (sim.time < 36 * 3600) {
  sim.step(5);
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
const s = sim.summary();
const bt = sim.boxTravel;
const by = (fl: number) => bt.filter((b) => b.floor === fl);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(JSON.stringify({ picked: s.picked, departed: s.departed, received: s.received, trips: `${s.tripsDone}/${s.trips}`, violations: backend.ledger.check().length }));
for (const fl of [5, 6, 7]) {
  const p = by(fl).filter((b) => b.by !== 'CONVEYOR');
  const c = by(fl).filter((b) => b.by === 'CONVEYOR');
  console.log(`${fl}F 박스 ${by(fl).length} · 롤테이너까지 평균 ${avg(by(fl).map((b) => b.dist)).toFixed(1)}m · ${avg(by(fl).map((b) => b.sec)).toFixed(0)}s · 사람 운반 ${p.length}개 평균 ${avg(p.map((b) => b.dist)).toFixed(1)}m · 컨베이어 ${c.length}개 평균 ${avg(c.map((b) => b.dist)).toFixed(1)}m`);
}
console.log(`전체 평균 ${avg(bt.map((b) => b.dist)).toFixed(1)}m · ${avg(bt.map((b) => b.sec)).toFixed(0)}s (박스 ${bt.length})`);
console.log(sim.events.filter((e) => /라인 DAS|오토스토어|Wave 배포/.test(e.text)).map((e) => e.text).join('\n'));
// §9 — 휠소터·DAS·DPS
for (const fl of [5, 6, 7] as const) {
  const lg = sim.sorterLog.filter((x) => x.floor === fl);
  console.log(`${fl}F 휠소터 투입 ${lg.filter((x) => x.kind === 'IN').length} · 슈트 도착 ${lg.filter((x) => x.kind === 'CHUTE').length} · DAS 로 ${lg.filter((x) => x.kind === 'DAS').length} · DAS R/T ${(sim.dasRt.get(fl) ?? 0).toFixed(1)}`);
}
console.log('DPS 구역 통과 평균(s)', sim.dps.pass.map((p) => (p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) : 0)).join(' / '), '· 구역별 처리', sim.dps.pass.map((p) => p.length).join('/'));
console.log('마지막 피킹', [5, 6, 7].map((f) => `${f}F ${((sim.lastPickAt.get(f as 5) ?? 0) / 3600).toFixed(2)}h`).join(' · '));
console.log('runs', [...sim.runs.values()].map((r) => `${r.plan.routeId}/${r.plan.temp}:${r.state}/${r.result} 계획 ${(r.plan.plannedDepartMin / 60).toFixed(2)} 실제 ${((r.departedAt ?? 0) / 3600).toFixed(2)} R/T ${Math.ceil(r.loaded.length / 10)}`).join(' '));
console.log('warns', sim.events.filter((e) => e.kind === 'warn' && !/결품|검품 불합격/.test(e.text)).map((e) => e.text).slice(-5).join(' | ') || '없음');
