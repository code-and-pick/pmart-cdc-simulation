// 고른 작업자 따라가기 — 오른쪽 패널 맨 위(사용자 2026-11-26 "지게차 보충 직원을 클릭하면 작업 흐름을 전체로, 실시간으로 어디서 뭘 하는지",
// 이어서 "저게 최선이야?"). 한 화면에 ① 지금(무엇·어디·몇 초째) ② 단계 세로 흐름(단계마다 이번 회차 걸린 시간 / 평균) ③ 층 미니맵(지나온 길·지금·가는 곳)
// ④ 최근 30분 띠(단계별 색) ⑤ 오늘 숫자 ⑥ 기록(접기). [따라가기]를 켜면 3D 카메라가 그 사람을 따라간다.
// 단계 정의는 시뮬레이션 엔진(simulation.ts 의 역할별 *Once)이 쓰는 activity 글에 맞춘다. 기록은 Agent.history.
import { useApp, useTick, useView } from '../app/context';
import { FLOW, WORK } from '../config';
import type { FloorLayout } from '../domain/layout';
import { ROLE_KO, type ActivityRec, type Agent } from '../sim/agent';
import { placeOf } from './placeOf';

interface Step {
  label: string;
  /** 지금 하는 일(activity)이 이 단계인지 */
  m: RegExp;
}
interface Flow {
  title: string;
  steps: Step[];
  /** 일 없이 기다리는 글(단계 아님) */
  idle?: RegExp;
}

const REPL: Flow = {
  title: '지게차 보충 (MOV — 팔레트 → 피킹 자리)',
  steps: [
    { label: '보충 요청 받기', m: /보충 대기/ },
    { label: '팔레트 랙으로', m: /^팔레트로/ },
    { label: '팔레트 내리기', m: /지게차로 팔레트 내리기/ },
    { label: '선반 입구·입고 포트·1단으로', m: /선반 입구로|오토스토어 입고 포트로|1단 피킹면/ },
    { label: '걸어서 진열·통 채우기', m: /걸어서 선반으로|박스 뜯어 진열|통에 채우기/ },
    { label: '지게차로 복귀 → 이동 기록', m: /^지게차로$/ },
  ],
};
const FC: Flow = {
  title: 'FC 피킹 (지역 카트)',
  steps: [
    { label: '다음 작업 받기', m: /작업 대기|빈 박스 받기/ },
    { label: '지역 바코드 스캔', m: /지역 바코드/ },
    { label: '선반·랙·포트로', m: /선반으로|오토스토어 포트로|포트 대기|로봇이 통/ },
    { label: '스캔 → 담기', m: /상품 스캔 → 담기|무거운 상자|불 보고 집기|순환 실사/ },
    { label: '휠소터·라인·분배대에', m: /휠소터|라인 공급대|상품 박스 내려놓기|분배대|크레이트/ },
  ],
  idle: /작업 대기/,
};
const SPLIT: Flow = {
  title: '분배 (야채 레인 → MFC 크레이트)',
  steps: [
    { label: '분배 작업 받기', m: /분배 작업 대기|분배대로/ },
    { label: '야채 레인으로', m: /선반으로|지역 바코드/ },
    { label: '집기', m: /상품 스캔 → 담기/ },
    { label: 'MFC 크레이트에 담기', m: /분배대 크레이트|크레이트에 담기|다시 세기/ },
    { label: '박스 닫기 → 자키', m: /박스 닫/ },
  ],
  idle: /분배 작업 대기/,
};
const LINE: Flow = {
  title: 'DAS 라인 (상품 기준 — 칸마다 내 색 불)',
  steps: [
    { label: '상품 박스 기다림', m: /상품 박스 (더 )?대기|기다림|라인으로/ },
    { label: '상품 스캔', m: /^상품 스캔$/ },
    { label: '불·숫자대로 칸에 넣기', m: /불·숫자대로/ },
    { label: '칸 박스 닫기 → 롤테이너', m: /박스 닫고/ },
  ],
  idle: /상품 박스 대기/,
};
const DPS: Flow = {
  title: 'DPS 구역 (냉동 전실 — 내 불 색)',
  steps: [
    { label: '구역 작업 받기', m: /DPS 작업 대기|구역으로/ },
    { label: '박스 오기 기다림', m: /DPS 박스 기다림/ },
    { label: '불 보고 집기', m: /불 보고 집기/ },
    { label: '박스 밀어 다음 구역', m: /박스 밀어|박스 닫아 컨베이어/ },
  ],
  idle: /DPS 작업 대기/,
};
const JOCKEY: Flow = {
  title: '자키 (박스 → 출고대기 → 도크)',
  steps: [
    { label: '박스 가지러', m: /박스 가지러|롤테이너 대기/ },
    { label: '롤테이너 싣기', m: /롤테이너 싣기/ },
    { label: '출고대기로', m: /출고대기로/ },
    { label: '출고대기에 내려놓기', m: /출고대기에 내려놓기/ },
    { label: '도크 앞으로(21시~)', m: /도크 앞|승강기/ },
  ],
  idle: /롤테이너 대기/,
};
const INSPECT: Flow = {
  title: '검품 (출고대기)',
  steps: [
    { label: '박스 고르기', m: /검품 대기/ },
    { label: '수량·봉인·온도 확인', m: /검품 —/ },
    { label: '재포장 → 재검품', m: /재포장/ },
  ],
  idle: /검품 대기/,
};
const LOADER: Flow = {
  title: '상차 (도크 — 출발 때만 CDC −q · Transit +q)',
  steps: [
    { label: '상차 대기', m: /상차 대기/ },
    { label: '도크 앞 R/T 로', m: /도크 앞 R\/T/ },
    { label: '차로', m: / 차로$/ },
    { label: '박스 스캔 대조', m: /박스 스캔 대조/ },
    { label: '차에 싣기(방문 역순)', m: /차에 싣기/ },
  ],
  idle: /상차 대기/,
};
const INBOUND: Flow = {
  title: '입고 검수',
  steps: [
    { label: '입고 기다림', m: /입고 대기/ },
    { label: '검수할 팔레트로', m: /검수할 팔레트로|핸드자키로 팔레트/ },
    { label: '검수 대기 칸으로', m: /검수 대기 칸/ },
    { label: '수량·기한·온도 확인', m: /검수 —/ },
    { label: '검수 완료 칸에 내려놓기', m: /검수 끝난|검수 완료 칸|팔레트 내려놓기/ },
  ],
  idle: /입고 대기/,
};

function flowOf(a: Agent): Flow {
  switch (a.role) {
    case 'REPL':
      return REPL;
    case 'FC':
      return FC;
    case 'SORT':
      return Number(a.id.slice(-2)) <= FLOW.lineWorkers[a.floor as 5 | 6 | 7] ? LINE : SPLIT;
    case 'DPS':
      return DPS;
    case 'JOCKEY':
      return JOCKEY;
    case 'INSPECT':
      return INSPECT;
    case 'LOADER':
      return LOADER;
    case 'INBOUND':
      return INBOUND;
  }
}

const STEP_COLORS = ['#7c5cff', '#2f80ed', '#00a3a3', '#27ae60', '#f2994a', '#eb5757'];
const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분` : s >= 60 ? `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`;
};
const hm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
const hms = (sec: number) => `${hm(sec)}:${String(Math.floor(sec) % 60).padStart(2, '0')}`;

interface Seg {
  step: number;
  start: number;
  end: number;
}

/** 기록 → 단계 구간(단계에 안 맞는 글은 앞 단계가 이어지는 것으로) */
function segmentsOf(hist: ActivityRec[], steps: Step[], now: number): Seg[] {
  const out: Seg[] = [];
  for (const r of hist) {
    const k = steps.findIndex((s) => s.m.test(r.text));
    if (k < 0) continue;
    const last = out[out.length - 1];
    if (last && last.step === k) continue;
    if (last) last.end = r.at;
    out.push({ step: k, start: r.at, end: now });
  }
  return out;
}

export function WorkerFlow() {
  const { sim, layout } = useApp();
  const view = useView();
  useTick();
  const a: Agent | undefined = sim.agents.find((x) => x.id === view.selectedWorker);
  if (!a) return null;
  const f = layout.floors.find((x) => x.floor === a.floor);
  const flow = flowOf(a);
  const steps = flow.steps;
  const now = sim.time;
  const segs = segmentsOf(a.history, steps, now);
  const curSeg = segs[segs.length - 1];
  const cur = curSeg && steps[curSeg.step].m.test(a.activity) ? curSeg.step : steps.findIndex((s) => s.m.test(a.activity));
  // 이번 회차 = 마지막으로 1단계(또는 그다음 첫 단계)가 시작된 뒤
  let cycleFrom = 0;
  for (let i = segs.length - 1; i >= 0; i--)
    if (i > 0 && segs[i].step < segs[i - 1].step) {
      cycleFrom = i;
      break;
    }
  const cycle = segs.slice(cycleFrom);
  const thisRound = new Map<number, number>();
  for (const s of cycle) thisRound.set(s.step, (thisRound.get(s.step) ?? 0) + (s.end - s.start));
  // 단계 평균(지난 구간들, 지금 구간 빼고)
  const sum = new Map<number, { t: number; n: number }>();
  for (const s of segs.slice(0, -1)) {
    const v = sum.get(s.step) ?? { t: 0, n: 0 };
    v.t += s.end - s.start;
    v.n += 1;
    sum.set(s.step, v);
  }
  // 한 바퀴 수·평균 — 1단계가 다시 시작된 횟수
  // 단계가 앞으로 되돌아가면 새 바퀴(지게차 보충처럼 일이 이어지면 1단계 대기를 건너뛰고 2단계부터 다시 — 그것도 한 바퀴, 사용자 2026-11-26)
  const starts = segs.filter((s, i) => i > 0 && s.step < segs[i - 1].step).map((s) => s.start);
  const cycles = starts.length;
  const avgCycle = cycles > 1 ? (starts[starts.length - 1] - starts[0]) / (cycles - 1) : null;
  const idleNow = flow.idle?.test(a.activity) || a.idle;
  const status = a.activity.startsWith('근무') || a.activity.includes('휴식') ? 'off' : idleNow ? 'idle' : 'busy';
  const elapsed = curSeg ? now - curSeg.start : 0;
  const recent = [...a.history].reverse().slice(0, 40);
  const following = view.followWorker === a.id;
  return (
    <section className="sec wflow">
      <div className="wf-head">
        <div>
          <b>{a.name}</b>
          <small>
            {ROLE_KO[a.role]} · {a.floor}F · {a.shift === 'DAY' ? '주간조 08~17' : a.shift === 'NIGHT' ? '야간' : '석간 13~22'}
          </small>
        </div>
        <span className={`wf-pill ${status}`}>{status === 'busy' ? '일하는 중' : status === 'idle' ? '기다리는 중' : '근무 밖'}</span>
        <button className={`wf-btn${following ? ' on' : ''}`} onClick={() => view.setFollow(following ? null : a.id, a.pos)} title="3D 카메라가 이 사람을 따라갑니다">
          {following ? '따라가는 중' : '따라가기'}
        </button>
        <button className="wf-btn x" onClick={() => view.selectWorker(null)} aria-label="닫기">
          ×
        </button>
      </div>

      {/* ① 지금 */}
      <div className="wf-nowcard">
        <div className="wf-now-what">
          {cur >= 0 && <span className="wf-dot" style={{ background: STEP_COLORS[cur % STEP_COLORS.length] }} />}
          <b>{a.activity}</b>
          {cur >= 0 && <em>{mmss(elapsed)}째</em>}
        </div>
        <div className="wf-now-where">
          <span>📍 {a.floor}F · {placeOf(f, a.pos.x, a.pos.z)}</span>
          {(a.at.x !== a.pos.x || a.at.z !== a.pos.z) && <span>→ {placeOf(f, a.at.x, a.at.z)}</span>}
        </div>
        {a.pda && a.pda.rows.length > 0 && (
          <div className="wf-rows">
            {a.pda.rows.slice(0, 6).map(([k, v]) => (
              <div key={k}>
                <small>{k}</small>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ② 단계 흐름(세로) */}
      <div className="wf-flow-h">
        <span>{flow.title}</span>
        <small>{cycles ? `오늘 ${cycles}바퀴${avgCycle ? ` · 한 바퀴 평균 ${mmss(avgCycle)}` : ''}` : '오늘 아직 한 바퀴 전'}</small>
      </div>
      <ol className="wf-stepper">
        {steps.map((s, i) => {
          const done = cur >= 0 ? i < cur && thisRound.has(i) : thisRound.has(i);
          const avg = sum.get(i);
          const state = i === cur ? 'now' : done ? 'done' : '';
          return (
            <li key={s.label} className={state} style={{ ['--c' as string]: STEP_COLORS[i % STEP_COLORS.length] }}>
              <i>{done ? '✓' : i + 1}</i>
              <span className="l">{s.label}</span>
              <span className="t">
                {i === cur ? mmss(elapsed) : done ? mmss(thisRound.get(i) ?? 0) : ''}
                {avg && avg.n > 0 && <small> 평균 {mmss(avg.t / avg.n)}</small>}
              </span>
            </li>
          );
        })}
      </ol>

      {/* ③ 미니맵 */}
      {f && <MiniMap f={f} a={a} cycleFrom={cycle[0]?.start ?? now - 600} />}

      {/* ④ 최근 30분 띠 */}
      <Ribbon segs={segs} now={now} steps={steps} />

      {/* ⑤ 오늘 숫자 */}
      <div className="wf-stats">
        <div>
          <b>{a.done.toLocaleString()}</b>
          <small>끝낸 일</small>
        </div>
        <div>
          <b>{Math.round(a.distance / WORK.stepLen).toLocaleString()}</b>
          <small>걸음</small>
        </div>
        <div>
          <b>{Math.round(a.utilization * 100)}%</b>
          <small>가동</small>
        </div>
        <div>
          <b>{a.units > 0 ? Math.round(a.uph).toLocaleString() : '—'}</b>
          <small>UPH</small>
        </div>
      </div>

      {/* ⑥ 기록 */}
      <details className="wf-log">
        <summary>기록 {a.history.length}줄 (최근 → 이전)</summary>
        <div>
          {recent.map((r, i) => {
            const k = steps.findIndex((s) => s.m.test(r.text));
            return (
              <div key={`${r.at}-${i}`}>
                <span className="t">{hms(r.at)}</span>
                <span className="d" style={{ background: k >= 0 ? STEP_COLORS[k % STEP_COLORS.length] : 'var(--line)' }} />
                <span className="x">{r.text}</span>
                <span className="p">{placeOf(f, r.x, r.z)}</span>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}

/** 층 미니맵 — 구역 윤곽 · 이번 회차 지나온 길(선) · 지금(깜빡) · 가는 곳(깃발) */
function MiniMap({ f, a, cycleFrom }: { f: FloorLayout; a: Agent; cycleFrom: number }) {
  const W = Math.max(...f.zones.map((z) => z.rect.x1));
  const D = Math.max(...f.zones.map((z) => z.rect.z1));
  const trail = a.history.filter((r) => r.at >= cycleFrom).map((r) => [r.x, r.z] as const);
  trail.push([a.pos.x, a.pos.z]);
  const moving = a.at.x !== a.pos.x || a.at.z !== a.pos.z;
  const fill = (k: string) => (k === 'RACK' ? 'var(--wf-rack, rgba(120,130,150,.22))' : k === 'SHELF' ? 'var(--wf-shelf, rgba(242,153,74,.22))' : k === 'BAND' ? 'transparent' : 'var(--wf-eq, rgba(124,92,255,.16))');
  return (
    <div className="wf-map">
      <svg viewBox={`-1 -1 ${W + 2} ${D + 2}`} preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={W} height={D} rx={1} className="wf-map-bg" />
        {f.zones
          .filter((z) => z.kind !== 'BAND')
          .map((z) => (
            <rect key={z.id} x={z.rect.x0} y={z.rect.z0} width={z.rect.x1 - z.rect.x0} height={z.rect.z1 - z.rect.z0} fill={fill(z.kind)} />
          ))}
        {f.docks.map((d) => (
          <rect key={d.code} x={d.pos.x - 1.6} y={0} width={3.2} height={1.2} className="wf-map-dock" />
        ))}
        {trail.length > 1 && <polyline points={trail.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(' ')} className="wf-map-trail" />}
        {moving && <line x1={a.pos.x} y1={a.pos.z} x2={a.at.x} y2={a.at.z} className="wf-map-next" />}
        {moving && <circle cx={a.at.x} cy={a.at.z} r={1.1} className="wf-map-dest" />}
        <circle cx={a.pos.x} cy={a.pos.z} r={2.6} className="wf-map-pulse" />
        <circle cx={a.pos.x} cy={a.pos.z} r={1.3} className="wf-map-me" />
      </svg>
      <div className="wf-map-legend">
        <span><i className="me" />지금</span>
        <span><i className="trail" />이번 회차 지나온 길</span>
        <span><i className="dest" />가는 곳</span>
      </div>
    </div>
  );
}

/** 최근 30분 — 단계별 색 띠(빈 곳 = 근무 밖·단계 밖) */
function Ribbon({ segs, now, steps }: { segs: Seg[]; now: number; steps: Step[] }) {
  const span = 1800;
  const from = now - span;
  const vis = segs.filter((s) => s.end > from);
  return (
    <div className="wf-ribbon">
      <div className="bar">
        {vis.map((s, i) => {
          const x0 = Math.max(from, s.start);
          return <span key={i} title={`${steps[s.step].label} ${hm(x0)}~${hm(s.end)}`} style={{ left: `${((x0 - from) / span) * 100}%`, width: `${Math.max(0.4, ((s.end - x0) / span) * 100)}%`, background: STEP_COLORS[s.step % STEP_COLORS.length] }} />;
        })}
      </div>
      <div className="ax">
        <small>{hm(from)}</small>
        <small>최근 30분</small>
        <small>{hm(now)}</small>
      </div>
    </div>
  );
}
