// 이상 알림(MFC IssueBar 의 sim/issues 와 같은 틀) — 지금 확인할 일. 값은 시뮬레이션·MOCK 계약 응답에서만 [사용자 2026-11-25 §6-2].
// 대상: Wave 배포 지연 · 보충 밀림 · 결품 · 검품 불합격 · 출차 지연. 누르면 그 화면으로(go).
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
  go?: { right?: RightView; left?: LeftView; floor?: FloorKey };
}

/** 알림 띠 기준 [시뮬] */
export const ISSUES = { shown: 3, waveLateMin: 10, recentMin: 30, replLateHour: 12 } as const;

const hm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

export function collectIssues(sim: Simulation, backend: MockBackend): Issue[] {
  const out: Issue[] = [];
  const m = sim.time / 60;
  // 출차 지연 — 계획 출차가 지났는데 아직 안 떠남
  for (const r of sim.runs.values()) {
    if (r.departedAt === undefined && r.state !== 'CANCELLED' && sim.time > r.plan.plannedDepartMin * 60 + 10 * 60)
      out.push({ key: `dep-${r.plan.tripId}`, level: 'bad', icon: '⛟', title: `출차 지연 ${r.plateNo}`, what: `${r.plan.region} ${TEMP_KO[r.plan.temp]} · 계획 ${hm(r.plan.plannedDepartMin * 60)} · ${Math.round((sim.time - r.plan.plannedDepartMin * 60) / 60)}분 늦음`, go: { right: 'transport' } });
  }
  // Wave 배포 지연 — 13:00 + 10분이 지났는데 배포 안 됨
  for (const w of sim.waveStatus())
    if (!w.released && m > 13 * 60 + ISSUES.waveLateMin)
      out.push({ key: `wave-${w.waveId}`, level: 'warn', icon: '⏱', title: `${TEMP_KO[w.temp]} Wave 배포 지연`, what: `${w.waveId} — 선반 보충이 끝나야 배포(석간조 대기 중)`, go: { right: 'logs' } });
  // 보충 밀림 — 12시 넘었는데 보충할 칸이 남음(Wave 전)
  const needs = sim.live('needs', 700, () => backend.replenishmentNeeds(5));
  if (needs.length && m > ISSUES.replLateHour * 60 && m < OUTBOUND.lowerFrom)
    out.push({ key: 'repl', level: 'warn', icon: '⇡', title: `보충 밀림 ${needs.length}칸`, what: `팔레트 → 피킹 칸 보충이 남았습니다 — 지게차 인원 확인`, go: { left: 'zone' } });
  // 최근 결품·검품 불합격
  const recent = sim.events.filter((e) => e.at > sim.time - ISSUES.recentMin * 60);
  const shorts = recent.filter((e) => e.text.includes('결품'));
  if (shorts.length) out.push({ key: 'short', level: 'warn', icon: '✕', title: `결품 ${shorts.length}건 (최근 ${ISSUES.recentMin}분)`, what: shorts[shorts.length - 1].text, go: { right: 'logs' } });
  const fails = recent.filter((e) => e.text.includes('검품 불합격'));
  if (fails.length) out.push({ key: 'insp', level: 'warn', icon: '⚠', title: `검품 불합격 ${fails.length}건 (최근 ${ISSUES.recentMin}분)`, what: fails[fails.length - 1].text, go: { right: 'trf' } });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}
