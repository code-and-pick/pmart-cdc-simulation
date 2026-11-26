// 이상 알림(MFC IssueBar 의 sim/issues 와 같은 틀) — 지금 확인할 일. 값은 시뮬레이션·MOCK 계약 응답에서만 [사용자 2026-11-25 §6-2].
// 대상: Wave 배포 지연 · 보충 밀림 · 출차 지연(결품·검품 불합격은 스스로 풀리는 예외라 뺌, 2026-11-26). 누르면 펼쳐서 왜·어디를 볼지 + 그 화면으로(go).
import type { MockBackend } from '../backend/mock/MockBackend';
import { OUTBOUND } from '../config';
import type { LeftView, RightView } from '../render/controller';
import type { FloorKey } from '../domain/sites/chilgok';
import { TEMP_KO, type Simulation } from './simulation';

export interface Issue {
  key: string;
  level: 'bad' | 'warn';
  icon: string;
  title: string;
  what: string;
  /** 왜 떴는지·무엇을 보면 되는지(눌러서 펼치면) */
  why?: string;
  go?: { right?: RightView; left?: LeftView; floor?: FloorKey };
}

/** 알림 띠 기준 [시뮬] */
export const ISSUES = { shown: 3, waveLateMin: 10, replLateHour: 12 } as const;

const hm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

export function collectIssues(sim: Simulation, backend: MockBackend): Issue[] {
  const out: Issue[] = [];
  const m = sim.time / 60;
  // 출차 지연 — 계획 출차가 지났는데 아직 안 떠남
  for (const r of sim.runs.values()) {
    if (r.departedAt === undefined && r.state !== 'CANCELLED' && sim.time > r.plan.plannedDepartMin * 60 + 10 * 60)
      out.push({ key: `dep-${r.plan.tripId}`, level: 'bad', icon: '⛟', title: `출차 지연 ${r.plateNo}`, what: `${r.plan.region} ${TEMP_KO[r.plan.temp]} · 계획 ${hm(r.plan.plannedDepartMin * 60)} · ${Math.round((sim.time - r.plan.plannedDepartMin * 60) / 60)}분 늦음`, go: { right: 'transport' }, why: '계획 출차 시각이 10분 넘게 지났는데 아직 출발하지 않았습니다. 운송 탭에서 그 운행이 상차 중인지(R/T 가 도크에 다 왔는지)·검품이 남았는지 보세요.' });
  }
  // Wave 배포 지연 — 13:00 + 10분이 지났는데 배포 안 됨
  for (const w of sim.waveStatus())
    if (!w.released && m > 13 * 60 + ISSUES.waveLateMin)
      out.push({ key: `wave-${w.waveId}`, level: 'warn', icon: '⏱', title: `${TEMP_KO[w.temp]} Wave 배포 지연`, what: `${w.waveId} — 선반 보충이 끝나야 배포(석간조 대기 중)`, go: { right: 'logs' }, why: '석간 13:00 에 Wave 를 배포하려면 그 온도대 피킹 선반 보충이 먼저 끝나야 합니다(팔레트에 잡힌 몫을 선반으로). 주간 지게차가 아직 옮기는 중입니다 — 구역 탭에서 보충 남은 칸, 현장 흐름에서 배포 시각을 보세요.' });
  // 보충 밀림 — 12시 넘었는데 보충할 칸이 남음(Wave 전)
  const needs = sim.live('needs', 700, () => backend.replenishmentNeeds(5));
  if (needs.length && m > ISSUES.replLateHour * 60 && m < OUTBOUND.lowerFrom)
    out.push({ key: 'repl', level: 'warn', icon: '⇡', title: `보충 밀림 ${needs.length}칸`, what: `팔레트 → 피킹 칸 보충이 남았습니다 — 지게차 인원 확인`, go: { left: 'zone' }, why: '12시가 넘었는데 팔레트 → 피킹 선반 보충이 남아 있습니다. 13:00 Wave 배포 전에 끝나야 합니다. 구역 탭에서 어느 구역에 남았는지, 작업자 탭에서 지게차가 무엇을 하는지 보세요.' });
  // 결품·검품 불합격은 알림에 올리지 않는다 — 시뮬레이터가 일부러 넣은 현장 예외(WORK.shortRate·검품 불합격률)라 재할당·재포장으로 스스로 풀린다(사용자 2026-11-26 "왜 자꾸 뜨냐"). 기록은 현장 흐름 탭 사건 기록
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}
