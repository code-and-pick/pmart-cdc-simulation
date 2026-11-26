// 운송 탭 — 운행(노선 × 온도대)마다 흐름: 배차 → 상차(도크) → 출발 → MFC 도착·인계 … → 복귀 (사용자 2026-11-26 "운송탭도 *-*-*-* 이런 식으로 흐름").
// 지금 단계는 강조(깜빡), 지난 단계는 체크와 실제 시각, 남은 단계는 계획 시각. 맨 위는 전체 운행이 어느 단계에 몇 대인지.
import { fmt } from '../backend/mock/MockTms';
import { MFCS, OUTBOUND } from '../config';
import type { TripRun } from '../sim/simulation';
import { TEMP_KO } from '../sim/simulation';

const hmSec = (sec?: number) => (sec === undefined ? '' : fmt(sec / 60));
const mfcName = (id: string) => MFCS.find((m) => m.id === id)?.name.replace(/^\d호점 /, '') ?? id;

interface Node {
  label: string;
  sub: string;
  state: 'done' | 'now' | '';
}

function nodesOf(r: TripRun): Node[] {
  const departed = r.departedAt !== undefined;
  const out: Node[] = [];
  out.push({ label: '배차', sub: '22:00', state: r.state === 'PLANNED' ? 'now' : 'done' });
  const rt = Math.ceil(r.loaded.length / OUTBOUND.boxesPerRt);
  out.push({ label: `상차 · 도크 ${r.dock.short}`, sub: r.state === 'LOADING' ? `R/T ${rt} 실음` : departed ? `R/T ${rt}` : '', state: r.state === 'LOADING' ? 'now' : departed ? 'done' : '' });
  out.push({ label: '출발', sub: departed ? `${hmSec(r.departedAt)} (계획 ${fmt(r.plan.plannedDepartMin)})` : `계획 ${fmt(r.plan.plannedDepartMin)}`, state: departed ? 'done' : '' });
  // 정차 — 운송 중이면 아직 떠나지 않은 첫 정차가 지금(가는 중 또는 인계 중)
  const curStop = r.state === 'IN_TRANSIT' ? r.stops.findIndex((s) => s.leftAt === undefined) : -1;
  r.stops.forEach((s, i) => {
    const done = s.leftAt !== undefined || (r.state !== 'IN_TRANSIT' && s.handedAt !== undefined);
    const at = s.arrivedAt !== undefined;
    const sub = done
      ? `${hmSec(s.arrivedAt)} 도착 · 인계 ${(s.received ?? 0).toLocaleString()}개`
      : i === curStop
        ? at
          ? `${hmSec(s.arrivedAt)} 도착 · 인계 중`
          : `가는 중 · 도착 예정 ${fmt(r.plan.plannedArriveMin[i])}`
        : `도착 예정 ${fmt(r.plan.plannedArriveMin[i])}`;
    out.push({ label: mfcName(s.mfcId), sub, state: done ? 'done' : i === curStop ? 'now' : '' });
  });
  out.push({ label: '복귀', sub: r.returnedAt !== undefined ? `${hmSec(r.returnedAt)}${r.rtUnloaded ? ` · 빈 R/T ${r.rtUnloaded}` : ''}` : '', state: r.state === 'RETURNED' ? 'done' : r.state === 'RETURNING' ? 'now' : '' });
  return out;
}

const RUN_KO = { PLANNED: '배차', LOADING: '상차 중', IN_TRANSIT: '운송 중', RETURNING: '복귀 중', RETURNED: '복귀', CANCELLED: '결행' } as const;

/** 운행 카드 하나 */
export function TripCard({ r }: { r: TripRun }) {
  const nodes = r.state === 'CANCELLED' ? [] : nodesOf(r);
  return (
    <div className={`trip ${r.state.toLowerCase()}`} title={`${r.plan.tripId}${r.result ? ` · ${r.result}` : ''}`}>
      <div className="trip-h">
        <b>
          {r.plan.region} {TEMP_KO[r.plan.temp]}
        </b>
        <small>
          {r.plateNo} · {r.driverName}
        </small>
        <span className={`trip-pill ${r.state.toLowerCase()}`}>{RUN_KO[r.state]}</span>
      </div>
      {r.state === 'CANCELLED' ? (
        <div className="note">물량이 없어 결행</div>
      ) : (
        <div className="trip-flow">
          {nodes.map((n, i) => (
            <span key={i} className="trip-wrap">
              <span className={`trip-node ${n.state}`}>
                <i>{n.state === 'done' ? '✓' : i + 1}</i>
                <span>
                  <b>{n.label}</b>
                  {n.sub && <small>{n.sub}</small>}
                </span>
              </span>
              {i < nodes.length - 1 && <span className="trip-arrow">→</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 22:00 배차 전 — 예정 운행 카드(모든 단계 남음) */
export function PlanCard({ p }: { p: { routeId: string; region: string; temp: TripRun['plan']['temp']; plateNo: string; driverName: string; departMin: number; returnMin: number; stops: { mfcId: string; arriveMin: number }[] } }) {
  const nodes: Node[] = [
    { label: '배차', sub: '22:00', state: '' },
    { label: '상차', sub: '22:00~', state: '' },
    { label: '출발', sub: `계획 ${fmt(p.departMin)}`, state: '' },
    ...p.stops.map((s) => ({ label: mfcName(s.mfcId), sub: `도착 예정 ${fmt(s.arriveMin)}`, state: '' as const })),
    { label: '복귀', sub: `예정 ${fmt(p.returnMin)}`, state: '' },
  ];
  return (
    <div className="trip planned">
      <div className="trip-h">
        <b>
          {p.region} {TEMP_KO[p.temp]}
        </b>
        <small>
          {p.plateNo} · {p.driverName}
        </small>
        <span className="trip-pill planned">배차 전</span>
      </div>
      <div className="trip-flow">
        {nodes.map((n, i) => (
          <span key={i} className="trip-wrap">
            <span className="trip-node">
              <i>{i + 1}</i>
              <span>
                <b>{n.label}</b>
                <small>{n.sub}</small>
              </span>
            </span>
            {i < nodes.length - 1 && <span className="trip-arrow">→</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 맨 위 — 전체 운행이 단계마다 몇 대 */
export function TripSummary({ runs }: { runs: TripRun[] }) {
  const k = (s: TripRun['state']) => runs.filter((r) => r.state === s).length;
  const cells: [string, number][] = [
    ['배차', k('PLANNED')],
    ['상차 중', k('LOADING')],
    ['운송 중', k('IN_TRANSIT')],
    ['복귀 중', k('RETURNING')],
    ['복귀', k('RETURNED')],
  ];
  const cancelled = k('CANCELLED');
  return (
    <div className="trip-sum">
      {cells.map(([label, n], i) => (
        <span key={label} className="trip-wrap">
          <span className={`trip-sum-cell${n ? ' on' : ''}`}>
            <b>{n}</b>
            <small>{label}</small>
          </span>
          {i < cells.length - 1 && <span className="trip-arrow">→</span>}
        </span>
      ))}
      {cancelled > 0 && <small className="muted"> · 결행 {cancelled}</small>}
    </div>
  );
}
