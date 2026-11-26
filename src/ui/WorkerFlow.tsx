// 고른 작업자의 작업 흐름 — 오른쪽 패널 맨 위(사용자 2026-11-26 "지게차 보충 직원을 클릭하면 오른쪽 탭에 그 직원의 작업 흐름이
// *-*-*-*-* 이런 식으로 전체 흐름을, 또 실시간으로 어디어디 뭐 하고 있는지").
// 단계 정의는 시뮬레이션 엔진(simulation.ts 의 역할별 *Once)이 쓰는 activity 글을 그대로 맞춘다. 기록은 Agent.history(하는 일이 바뀐 때마다).
import { useApp, useTick, useView } from '../app/context';
import type { FloorLayout } from '../domain/layout';
import { WORK } from '../config';
import { ROLE_KO, type Agent, type Role } from '../sim/agent';

interface Step {
  label: string;
  /** 지금 하는 일(activity)이 이 단계인지 */
  m: RegExp;
}

/** 역할별 흐름 — 지게차 보충은 엔진 replenishOnce 순서. 다른 역할도 엔진 글에 맞춘 큰 단계 */
const FLOWS: Partial<Record<Role, Step[]>> = {
  REPL: [
    { label: '보충 요청 받기(MOV)', m: /보충 대기/ },
    { label: '팔레트 랙으로', m: /^팔레트로/ },
    { label: '팔레트 내리기', m: /지게차로 팔레트 내리기/ },
    { label: '선반 입구·입고 포트·1단으로', m: /선반 입구로|오토스토어 입고 포트로|1단 피킹면/ },
    { label: '걸어서 진열·통 채우기', m: /걸어서 선반으로|박스 뜯어 진열|통에 채우기/ },
    { label: '지게차로 복귀 → 이동 기록', m: /^지게차로$/ },
  ],
  FC: [
    { label: '다음 작업 받기', m: /작업 대기|다음 작업/ },
    { label: '선반·랙으로', m: /선반으로|랙으로|통로|포트로|이동/ },
    { label: '스캔·피킹', m: /스캔|피킹|담기|집기|포트/ },
    { label: '휠소터·라인·분배에 내려놓기', m: /휠소터|라인|분배|내려놓/ },
  ],
  JOCKEY: [
    { label: '닫힌 박스 모으기', m: /박스|슈트|라인/ },
    { label: '출고대기(91)로', m: /출고대기/ },
    { label: '도크 앞으로 R\/T', m: /도크/ },
  ],
};

type R4 = { x0: number; z0: number; x1: number; z1: number };
const shortLabel = (label: string) => label.replace(/\s*\(.*\)$/, '');

/**
 * 자리 → 사람이 읽는 이름. 통로도 이름으로(사용자 2026-11-26 "통로로만 나오는 것 해결해"):
 * 승강기 앞 · 도크 앞 · 출고대기 칸 · 선반 통로(통로 번호) · 설비 안 · 랙 통로(번호판) · 랙 앞 가로 통로 · 묶음 사이 가로 통로 · 북쪽/남쪽 가로 통로(가까운 설비 옆)
 */
export function placeOf(f: FloorLayout | undefined, x: number, z: number): string {
  if (!f) return '';
  const inR = (r: R4, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
  const area = (r: R4) => (r.x1 - r.x0) * (r.z1 - r.z0);
  const dist = (r: R4) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  const lift = f.lifts.find((l) => inR(l.rect, 0.8));
  if (lift) return `승강기 ${lift.no}호기 앞`;
  // 북쪽 벽 쪽 — 도크·출고대기
  if (z < f.walk.northZ + 0.6) {
    const dock = f.docks.filter((d) => Math.abs(d.pos.x - x) < 2.4).sort((p, q) => Math.abs(p.pos.x - x) - Math.abs(q.pos.x - x))[0];
    if (dock && z < 4) return `도크 ${dock.short} 앞`;
    const st = f.staging.find((c) => Math.abs(c.pos.x - x) < 1.2 && Math.abs(c.pos.z - z) < 1.6);
    if (st) return `출고대기 ${st.short}`;
  }
  // 설비·선반 구역 안(작은 것 먼저)
  const hit = f.zones.filter((q) => q.kind !== 'BAND' && q.kind !== 'RACK' && inR(q.rect)).sort((p, q) => area(p.rect) - area(q.rect))[0];
  const sa = f.shelfAisles
    .filter((q) => Math.abs(q.cx - x) < 1.4 && (q.z0 === undefined || (z >= q.z0 - 0.6 && z <= (q.z1 ?? q.z0) + 0.6)))
    .sort((p, q) => Math.abs(p.cx - x) - Math.abs(q.cx - x))[0];
  if (sa) return `${shortLabel(hit?.label ?? '피킹 선반')} · 통로 ${sa.plate}`;
  if (hit) return shortLabel(hit.label);
  // 랙 구역(남쪽)
  if (z >= f.walk.rackZ - 1.2) {
    const ra = [...f.aisles].sort((p, q) => Math.abs(p.cx - x) - Math.abs(q.cx - x))[0];
    const rackZone = f.zones.find((q) => q.kind === 'RACK' && inR(q.rect, 0.5));
    const zn = rackZone ? `${shortLabel(rackZone.label)} ` : '';
    if (Math.abs(z - f.walk.rackZ) < 1.6) return `랙 앞 가로 통로${ra ? ` (${ra.plate} 앞)` : ''}`;
    const inRow = f.rows.some((r) => z >= r.z0 && z <= r.z1);
    if (!inRow) return `${zn}랙 묶음 사이 가로 통로${ra ? ` (${ra.plate} 근처)` : ''}`;
    if (ra && Math.abs(ra.cx - x) < 1.8) return `${zn}랙 통로 ${ra.plate}`;
    return `${zn}랙 사이`;
  }
  // 띠 안 통로 — 가까운 설비·구역 옆
  const near = f.zones.filter((q) => q.kind !== 'BAND' && q.kind !== 'RACK').sort((p, q) => dist(p.rect) - dist(q.rect))[0];
  const where = z < f.walk.northZ + 1.2 ? '북쪽 통로' : Math.abs(z - f.walk.roomZ) < 1.2 ? '랙 앞쪽 남쪽 가로 통로' : '띠 안 통로';
  return near && dist(near.rect) < 6 ? `${where} · ${shortLabel(near.label)} 옆` : where;
}

const hms = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(Math.floor(sec) % 60).padStart(2, '0')}`;

function stepIndex(steps: Step[], text: string): number {
  return steps.findIndex((s) => s.m.test(text));
}

export function WorkerFlow() {
  const { sim, layout } = useApp();
  const view = useView();
  useTick();
  const a: Agent | undefined = sim.agents.find((x) => x.id === view.selectedWorker);
  if (!a) return null;
  const f = layout.floors.find((x) => x.floor === a.floor);
  const steps = FLOWS[a.role];
  const cur = steps ? stepIndex(steps, a.activity) : -1;
  // 지난 단계(이번 회차) — 마지막으로 첫 단계에 들어간 뒤 거친 단계들
  const passed = new Set<number>();
  if (steps) {
    for (let i = a.history.length - 1; i >= 0; i--) {
      const k = stepIndex(steps, a.history[i].text);
      if (k < 0) continue;
      passed.add(k);
      if (k === 0) break;
    }
  }
  const recent = [...a.history].reverse().slice(0, 25);
  return (
    <section className="sec wflow">
      <h4>
        {a.name} <span>{ROLE_KO[a.role]} · {a.floor}F · {a.shift === 'DAY' ? '주간조' : a.shift === 'NIGHT' ? '야간' : '석간'}</span>
      </h4>
      {steps ? (
        <div className="wf-steps">
          {steps.map((s, i) => (
            <span key={s.label} className="wf-step-wrap">
              <span className={`wf-step${i === cur ? ' now' : passed.has(i) && (cur < 0 || i < cur) ? ' done' : ''}`}>
                <i>{i + 1}</i>
                {s.label}
              </span>
              {i < steps.length - 1 && <span className="wf-arrow">→</span>}
            </span>
          ))}
        </div>
      ) : (
        <div className="note">이 역할은 아래 기록으로 흐름을 봅니다.</div>
      )}
      <div className="wf-now">
        <div>
          <small>지금</small>
          <b>{a.activity}</b>
        </div>
        <div>
          <small>어디</small>
          <b>
            {a.floor}F · {placeOf(f, a.pos.x, a.pos.z)}
          </b>
        </div>
        {a.pda && (
          <div>
            <small>PDA</small>
            <b>{a.pda.step}</b>
          </div>
        )}
      </div>
      {a.pda && a.pda.rows.length > 0 && (
        <div className="wf-rows">
          {a.pda.rows.map(([k, v]) => (
            <div key={k}>
              <small>{k}</small> {v}
            </div>
          ))}
        </div>
      )}
      <div className="wf-hist">
        <div className="wf-hist-h">기록 (최근 → 이전)</div>
        {recent.length === 0 && <div className="note">아직 기록 없음</div>}
        {recent.map((r, i) => (
          <div key={`${r.at}-${i}`} className={i === 0 ? 'now' : ''}>
            <span className="t">{hms(r.at)}</span>
            <span className="x">{r.text}</span>
            <span className="p">{placeOf(f, r.x, r.z)}</span>
          </div>
        ))}
      </div>
      <div className="note">
        걸음 {Math.round(a.distance / WORK.stepLen).toLocaleString()}보 · 끝낸 일 {a.done} · 가동 {Math.round(a.utilization * 100)}%
      </div>
    </section>
  );
}
