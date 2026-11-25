// 실규모 하루의 역할·층별 가동률·UPH·유휴 이유(npx vite-node scripts/utilization-report.ts) — 사용자 2026-11-25 "병목인지 인원 과다인지" [시뮬]
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
const snaps: string[] = [];
const acts = new Map<string, Map<string, number>>();
while (sim.time < 34 * 3600) {
  sim.step(5);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  const h = sim.time / 3600;
  if (h >= 13 && h < 23) for (const a of sim.agents) { if (a.idle) { const k = `${a.floor}-${a.role}`; const m = acts.get(k) ?? acts.set(k, new Map()).get(k)!; m.set(a.activity, (m.get(a.activity) ?? 0) + 5); } }
  for (const t of [14.28, 14.73, 16, 18, 20]) if (Math.abs(h - t) < 5 / 3600 / 2) snaps.push(`${t}h busy ${sim.agents.filter((a) => !a.idle).length}/${sim.agents.length}`);
}
console.log(snaps.join(' | '));
const s = sim.summary();
console.log(JSON.stringify({ picked: s.picked, departed: s.departed, trips: `${s.tripsDone}/${s.trips}` }));
const groups = new Map<string, typeof sim.agents>();
for (const a of sim.agents) (groups.get(`${a.floor}-${a.role}`) ?? groups.set(`${a.floor}-${a.role}`, []).get(`${a.floor}-${a.role}`)!).push(a);
for (const [k, as] of [...groups].sort()) {
  const on = as.reduce((x, a) => x + a.onDutySeconds, 0), idle = as.reduce((x, a) => x + a.idleSeconds, 0), u = as.reduce((x, a) => x + a.units, 0);
  const top = [...(acts.get(k) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, sec]) => `${t} ${Math.round(sec / 60)}분`).join(', ');
  console.log(`${k} n=${as.length} 근무 ${(on / 3600).toFixed(1)}h 가동 ${on ? Math.round(100 * (on - idle) / on) : 0}% UPH ${on ? Math.round(u / (on / 3600)) : 0} units ${u} | 13~23시 유휴 상위: ${top}`);
}
console.log('last pick', [5, 6, 7].map((f) => `${f}F ${((sim.lastPickAt.get(f as 5) ?? 0) / 3600).toFixed(2)}`).join(' '));
