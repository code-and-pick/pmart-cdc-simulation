// 칠곡 DC 하루 — 시계, 근무(주간조·석간·지하 상차), TRF 유입, Wave 배포, 작업자,
// 검품 → 승강기 하강 → 지하 상차 → 23:00 출발 검증(TOUT: CDC −q · Transit +q).
// 근거: 설계 §5·§6·§12, 알바몬 후기(석간 13~22시·휴식·FC 지역 바코드·분배·라인·21시~ 하강·보냉 커버),
//       우아한청년들 하루 일정(08:00 입고·13:00 선별·23:00 출발), WMS CDC-F-019~022(1요청·1이관·1출발).
// 백엔드와는 계약 API 로만 주고받는다 — 지금은 MockBackend(설계 §12 ⑧ 실서버 모드 전).
// 운송(§12 ⑦): 22:00 배차(고정 노선 × 온도대, MockTms) → 출차 30분 전 상차(방문 역순) → 노선별 출차 → 주행 → MFC 도착·하차(동시 3대)·인계 → 복귀.
// React·three 에 의존하지 않는다(시험이 화면 없이 하루를 돌린다).

import { CENTER_ID, MFCS, OUTBOUND, SHIFT, SIM_START, SUPPLY, TMS, WORK, WORKFORCE } from '../config';
// 시간표 근거: 정본 CDC-8(PR #447) — 21:30 WMS 완료 · 22:00 R/T 카운팅 · 22:30 상차 · 23:00~ 출차
import type { MockBackend } from '../backend/mock/MockBackend';
import type { ApiCallRecord, DomainEventRecord } from '../backend/port';
import { fmt, MockTms, type TripPlan } from '../backend/mock/MockTms';
import type { Catalog, Handling } from '../domain/catalog';
import { ApiProblem, type Task, type TemperatureZone } from '../domain/contract';
import { stagingCodeFor, type FloorLayout, type Layout, type Location } from '../domain/layout';
import type { FloorKey, FloorNo } from '../domain/sites/chilgok';
import { newId, Rng } from '../util/rng';
import { Agent, ROLE_KO, type DutyClock, type Role, type Shift } from './agent';
import { B1Site, FloorSite, liftDoor, type P, type WalkPoint } from './site';
import { makeTransfers } from './supply';

export interface SimEvent {
  at: number;
  kind: 'flow' | 'api' | 'warn';
  text: string;
}

type Contents = { sku: string; lot: string; qty: number }[];

/** 피킹한 MFC 몫 하나(작업 하나) — 카트·라인·분배로 간다 */
interface Drop {
  taskId: string;
  trfId: string;
  waveId: string;
  mfcId: string;
  contents: Contents;
  temp: TemperatureZone;
  stagingCode: string;
}
/** 작업자 손의 지역 카트(또는 DPS 박스·핸드자키) */
interface Cart {
  region: string;
  handling: Handling;
  drops: Drop[];
}
/** 켜진 표시등 — DPS 선반 칸·라인 칸, 작업자 색과 숫자 [현장] */
export interface WorkLight {
  floor: FloorNo;
  kind: 'DPS' | 'LINE';
  x: number;
  y: number;
  z: number;
  color: string;
  qty: number;
  who: string;
}
/** 작업자 스캐너 색 [시뮬] */
const WORKER_COLORS = [
  { hex: '#ff3b30', name: '빨강' },
  { hex: '#34c759', name: '초록' },
  { hex: '#0a84ff', name: '파랑' },
  { hex: '#ffcc00', name: '노랑' },
  { hex: '#bf5af2', name: '보라' },
  { hex: '#ff9f0a', name: '주황' },
  { hex: '#64d2ff', name: '하늘' },
  { hex: '#ff375f', name: '분홍' },
];
const HANDLING_TITLE: Record<Handling, string> = { DPS: 'DPS 피킹 (냉동)', BOX: '박스 피킹 (→ 휠소터)', FC: 'FC 피킹', SPLIT: 'FC 피킹 (야채 → 분배)', LINE: 'FC 피킹 (라인 상품 → 공급대)', PORT: '오토스토어 포트 피킹' };

interface JockeyJob {
  trfId: string;
  mfcId: string;
  lpn: string;
  units: number;
  temp: TemperatureZone;
  stagingCode: string;
  contents: Contents;
  /** 박스를 집으러 가는 곳(DPS 컨베이어 끝·휠소터 갈래·라인·분배 칸) */
  from: WalkPoint;
  /** 이 시각부터 집을 수 있다(휠소터 이동 중) */
  readyAt?: number;
}

/** 출고대기·하강·상차를 따라가는 박스(LPN) — 수량은 서버 분류 결과 그대로 */
export interface StagedBox {
  lpn: string;
  trfId: string;
  mfcId: string;
  units: number;
  temp: TemperatureZone;
  state: 'WAIT' | 'CHECK' | 'PASSED' | 'FAILED' | 'MOVING';
  contents: Contents;
}

/** 지하 상차 마당에 내려온 롤테이너 */
interface RollAtB1 {
  boxes: StagedBox[];
  mfcId: string;
  trfId: string;
  lift: number;
}

/** 한 운행(차 한 대 · 온도대 하나 · 정차 ≤3) — 계획은 MockTms, 진행은 시뮬레이터가 시각대로 기록 */
export interface TripRun {
  plan: TripPlan;
  plateNo: string;
  driverName: string;
  dock: Location;
  loaded: StagedBox[];
  state: 'PLANNED' | 'LOADING' | 'IN_TRANSIT' | 'RETURNING' | 'RETURNED' | 'CANCELLED';
  departedAt?: number;
  result?: string;
  stops: { mfcId: string; trfIds: string[]; arrivedAt?: number; handedAt?: number; leftAt?: number; received?: number }[];
  returnedAt?: number;
}

export interface SimOptions {
  baseDate: string;
  seed?: number;
  /** MFC 한 곳 TRF 품목 수 (시험은 작게) */
  linesPerMfc?: number;
}

const FLOORS: FloorNo[] = [5, 6, 7];
const hm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
const LUNCH_DAY = { start: 12 * 60, end: 13 * 60 }; // 주간조 점심 [가정]
const TERMINAL = ['DONE', 'PARTIAL', 'EXCEPTION', 'CANCELLED'];
export const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };
/** MFC 마지막 도착(초, 다음 날 07:30) [정본 TMS 2.2] */
const TMS_LAST_ARRIVAL = (24 * 60 + OUTBOUND.mfcLastArrival) * 60;

interface RouteSite {
  route(from: WalkPoint, to: WalkPoint): P[];
}

export class Simulation implements DutyClock {
  time = SIM_START;
  speed = 15;
  readonly agents: Agent[] = [];
  readonly sites = new Map<FloorNo, FloorSite>();
  readonly b1: B1Site;
  readonly events: SimEvent[] = [];
  /** 오른쪽 API·이벤트 탭 — 계약 호출과 도메인 사건(최근 500) */
  readonly apiLog: ApiCallRecord[] = [];
  readonly domainEvents: DomainEventRecord[] = [];
  /** 피킹 기록(시각·개수) — 최근 1시간 피킹 */
  readonly pickLog: { at: number; qty: number }[] = [];
  /** 결품 보고 개수 */
  shortUnits = 0;
  /** 라인(DAS)에 들어온 상품 박스 · 분배대에 들어온 지역 카트 */
  readonly lineQueue = new Map<FloorNo, Drop[]>(FLOORS.map((f) => [f, []]));
  /** 라인 공급대(FC 가 내려놓은 라인 상품 박스 — 자키가 라인 줄로) · 줄마다 라인 큐 */
  readonly lineBuffer = new Map<FloorNo, { at: number; drop: Drop }[]>(FLOORS.map((f) => [f, []]));
  /** 라인 칸에 열려 있는 MFC 박스((층-줄-TRF) →) */
  private readonly openBoxes = new Map<string, { trfId: string; waveId: string; mfcId: string; temp: TemperatureZone; stagingCode: string; contents: Contents; row: number; floor: FloorNo; from: WalkPoint }>();
  private lineRowNext = 0;
  /** 휠소터 투입 시각들 — 화면 박스 흐름 */
  readonly sorterIn: number[] = [];
  readonly splitQueue = new Map<FloorNo, { region: string; drops: Drop[] }[]>(FLOORS.map((f) => [f, []]));
  /** 작업자 손의 카트(agentId →) */
  private readonly carts = new Map<string, Cart>();
  /** 나눠 담는 중인 TRF 수 */
  private readonly busy = new Map<string, number>();
  /** 켜진 표시등(DPS·라인) — 화면이 그린다 */
  readonly lights: WorkLight[] = [];
  private lpnSeq = 0;
  /** 방식별 닫은 박스 수(DPS·박스·FC 바로 출고대기·라인·분배) — 시험·지표용 */
  readonly sealedBy: Record<'DPS' | 'DIRECT' | 'LINE' | 'SPLIT' | 'SORTER' | 'PORT', number> = { DPS: 0, DIRECT: 0, LINE: 0, SPLIT: 0, SORTER: 0, PORT: 0 };
  /** 분배 수량 실수(다시 셈) 횟수 · 통로 막힘 기다림 횟수 */
  splitMistakes = 0;
  /** 라인에서 스캔 한 번에 켜진 칸 불 최대 수(한 상품이 여러 MFC 칸으로) */
  lineLitMax = 0;
  aisleWaits = 0;
  /** 켜진 적 있는 표시등 수 */
  litCount = 0;
  readonly jockeyQueue = new Map<FloorNo, JockeyJob[]>(FLOORS.map((f) => [f, []]));
  /** 출고대기 자리(91 코드) → 그 자리에 놓인 박스 */
  readonly staged = new Map<string, StagedBox[]>();
  /** 지하 상차 마당에 내려와 실을 차례를 기다리는 롤테이너 */
  readonly atB1: RollAtB1[] = [];
  /** TMS — MOCK 운송(fleet·planning·execution) */
  readonly tms: MockTms;
  /** 운행 진행 (tripId →) */
  readonly runs = new Map<string, TripRun>();
  private readonly runByTrf = new Map<string, TripRun>();
  /** 시각 예약된 운송 사건 */
  private readonly timers: { at: number; fn: () => void }[] = [];
  /** MFC 하차면(동시 3대) — 비는 시각들 */
  private readonly bays = new Map<string, number[]>();
  private readonly claimed = new Set<string>();
  /** 지금 싣고 있는 R/T 수(운행 별) — 다 싣기 전에 출차하지 않게 */
  private readonly loading = new Map<string, number>();
  private readonly locs = new Map<string, Location>();
  private readonly rng: Rng;
  private day = { intake: false, creating: false, waveId: '', released: false, lastTry: 0, warned: false, rtCounted: false, planned: false, lastDepartCheck: 0 };

  constructor(
    readonly layout: Layout,
    readonly catalog: Catalog,
    readonly backend: MockBackend,
    private readonly opt: SimOptions,
  ) {
    this.rng = new Rng(opt.seed ?? 20261125);
    this.b1 = new B1Site(layout);
    this.tms = new MockTms({ now: () => this.time, baseDate: opt.baseDate, outbound: backend });
    const keep = <T,>(arr: T[], x: T) => {
      arr.push(x);
      if (arr.length > 500) arr.splice(0, arr.length - 500);
    };
    this.tms.onEvent((e) => {
      keep(this.domainEvents, e);
      this.log('flow', `${e.type} · ${e.summary}`);
    });
    this.tms.onApi((r) => keep(this.apiLog, r));
    backend.onApi((r) => keep(this.apiLog, r));
    for (const f of layout.floors) {
      this.sites.set(f.floor, new FloorSite(f, layout));
      for (const l of [...f.locations, ...f.shelves, ...f.staging]) this.locs.set(l.code, l);
    }
    backend.onEvent((e) => {
      keep(this.domainEvents, e);
      this.log('flow', `${e.type} · ${e.summary}`);
    });
    for (const fl of FLOORS) this.hire(fl);
    for (let i = 1; i <= OUTBOUND.loaders; i++) {
      const no = String(i).padStart(2, '0');
      const home = this.b1.home();
      this.agents.push(new Agent(`loader-b1-${no}`, `${ROLE_KO.LOADER} B1-${no}`, 'LOADER', 'B1', 'NIGHT', { ...home, x: home.x + i * 0.6 }, this));
    }
    for (const a of this.agents) void this.run(a);
  }

  // ── 근무 ───────────────────────────────────────────
  private window(a: Agent) {
    return a.shift === 'DAY' ? SHIFT.day : a.shift === 'NIGHT' ? OUTBOUND.loaderShift : SHIFT.evening;
  }
  onDuty(a: Agent): boolean {
    const m = this.time / 60;
    const w = this.window(a);
    if (m < w.start || m >= w.end) return false;
    const breaks = a.shift === 'DAY' ? [LUNCH_DAY] : a.shift === 'NIGHT' ? [] : SHIFT.breaks;
    return !breaks.some((b) => m >= b.start && m < b.end);
  }
  dutyLabel(a: Agent): string {
    const m = this.time / 60;
    const w = this.window(a);
    if (m < w.start) return `근무 전 (${hm(w.start * 60)} 시작)`;
    if (m >= w.end) return '퇴근';
    return a.shift === 'DAY' ? '점심' : '휴식';
  }

  private hire(fl: FloorNo) {
    const w = WORKFORCE[fl];
    const home = this.sites.get(fl)!.home();
    const add = (role: Role, shift: Shift, n: number, from = 1) => {
      for (let i = 0; i < n; i++) {
        const no = String(from + i).padStart(2, '0');
        const id = `${role.toLowerCase()}-${fl}-${no}`;
        this.agents.push(new Agent(id, `${ROLE_KO[role]} ${fl}F-${no}`, role, fl, shift, { ...home, x: home.x + this.agents.length * 0.3 }, this));
      }
    };
    add('REPL', 'DAY', w.replDay);
    add('REPL', 'EVENING', w.replEve, w.replDay + 1);
    add('FC', 'EVENING', w.fc);
    add('SORT', 'EVENING', w.sort);
    add('JOCKEY', 'EVENING', w.jockey);
    add('INSPECT', 'EVENING', OUTBOUND.inspectorsPerFloor);
  }

  // ── 시계 ───────────────────────────────────────────
  /** 화면 프레임마다 — 실제 경과 초 × 배속 */
  advance(realDt: number) {
    if (this.speed <= 0) return;
    let left = realDt * this.speed;
    while (left > 0) {
      const d = Math.min(1, left);
      this.step(d);
      left -= d;
    }
  }

  step(dt: number) {
    this.time += dt;
    this.coordinate();
    this.fireTimers();
    for (const a of this.agents) a.tick(dt);
  }

  clockText(): string {
    return hm(this.time);
  }

  log(kind: SimEvent['kind'], text: string) {
    this.events.push({ at: this.time, kind, text });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  // ── 하루 흐름 (replenishment·운영자·TMS 역할) ─────────────────
  private coordinate() {
    const m = this.time / 60;
    if (!this.day.intake && m >= SHIFT.day.start) {
      // 08:00 — 승인 TRF 인수(MFC 다섯 곳, 1요청·1이관·1출발) → 할당 [현장 하루 일정 08:00]
      this.day.intake = true;
      const trfs = makeTransfers(this.catalog, this.opt.baseDate, this.opt.seed ?? 20261125, this.opt.linesPerMfc ?? SUPPLY.linesPerMfc);
      for (const t of trfs) {
        try {
          this.backend.intakeTransfer(t, newId('intake'));
        } catch (e) {
          this.log('warn', `TRF 인수 실패 ${t.trfId}: ${e instanceof Error ? e.message : e}`);
        }
      }
      const needs = this.backend.replenishmentNeeds();
      this.log('flow', `08:00 주간조 — TRF ${trfs.length}건 인수·할당, 선반 보충 할 칸 ${needs.length}`);
    }
    if (this.day.intake && !this.day.waveId && !this.day.creating && m >= SHIFT.evening.start) {
      // 13:00 석간 — 선별 시작: Wave 편성 [현장 "01:00 PM 선별"]
      this.day.creating = true;
      const ids = this.backend
        .listTransfers()
        .filter((t) => t.state === 'ALLOCATED' || t.state === 'PARTIALLY_ALLOCATED')
        .map((t) => t.trfId);
      if (!ids.length) {
        this.log('warn', '편성할 TRF 없음');
        return;
      }
      this.backend
        .createWave({ cdcId: CENTER_ID, trfIds: ids }, newId('wave'))
        .then((w) => {
          this.day.waveId = w.waveId;
          this.log('flow', `13:00 석간 — Wave ${w.waveId} 편성 (TRF ${ids.length}건)`);
        })
        .catch((e) => this.log('warn', `Wave 편성 실패: ${e instanceof Error ? e.message : e}`));
    }
    if (this.day.waveId && !this.day.released && this.time - this.day.lastTry >= 60) {
      this.day.lastTry = this.time;
      const needs = this.backend.replenishmentNeeds();
      if (needs.length) {
        if (!this.day.warned) this.log('warn', `선반 보충이 끝나지 않아 Wave 배포를 기다림 (${needs.length}칸)`);
        this.day.warned = true;
        return;
      }
      this.day.released = true;
      this.backend
        .releaseWave(this.day.waveId, newId('release'))
        .then(() => this.log('flow', `${hm(this.time)} Wave 배포 — FC 가 PDA 로 다음 작업을 받는다`))
        .catch((e) => {
          this.day.released = false;
          this.log('warn', `Wave 배포 실패: ${e instanceof Error ? e.message : e}`);
        });
    }
    if (!this.day.rtCounted && m >= OUTBOUND.rtCountAt) {
      // 22:00 PDA R/T 카운팅 — 박스 스캔 → R/T, 온도대별 [CDC-8]
      this.day.rtCounted = true;
      for (const mf of MFCS) {
        const boxes = [...[...this.staged.values()].flat(), ...this.atB1.flatMap((r) => r.boxes)].filter((b) => b.mfcId === mf.id);
        const byTemp = new Map<TemperatureZone, number>();
        for (const b of boxes) byTemp.set(b.temp, (byTemp.get(b.temp) ?? 0) + 1);
        const rt = [...byTemp.entries()].map(([k, n]) => `${TEMP_KO[k]} ${Math.ceil(n / OUTBOUND.boxesPerRt)}`).join(' · ');
        this.log('flow', `22:00 R/T 카운팅 ${mf.name}: 박스 ${boxes.length} → R/T ${rt || '없음'}`);
      }
    }
    if (!this.day.planned && m >= OUTBOUND.rtCountAt) {
      // 22:00~22:30 TMS 배차 — 고정 노선 × 온도대 운송지시서, 계획완료 [TMS §4.3·§7]
      this.day.planned = true;
      this.planTrips();
    }
    if (this.day.planned && this.time - this.day.lastDepartCheck >= 30) {
      this.day.lastDepartCheck = this.time;
      for (const r of this.runs.values()) {
        if (r.state !== 'PLANNED' && r.state !== 'LOADING') continue;
        const due = r.plan.plannedDepartMin;
        if (m < due) continue;
        if (this.tripLoaded(r)) this.depart(r);
        else if (m >= due + TMS.maxDepartDelayMin) this.depart(r, true);
      }
    }
  }

  private planTrips() {
    const plans = this.tms.planDay(this.backend.listTransfers());
    const docksByTemp: Record<TemperatureZone, Location[]> = {
      FROZEN: this.layout.docks.filter((d) => d.zone === 'A'),
      CHILLED: this.layout.docks.filter((d) => d.zone === 'B'),
      AMBIENT: this.layout.docks.filter((d) => d.zone === 'C'),
    };
    const used: Record<TemperatureZone, number> = { FROZEN: 0, CHILLED: 0, AMBIENT: 0 };
    for (const plan of plans) {
      const v = this.tms.vehicles.find((x) => x.vehicleId === plan.vehicleId)!;
      const d = this.tms.drivers.find((x) => x.driverId === plan.driverId)!;
      const docks = docksByTemp[plan.temp];
      const run: TripRun = {
        plan,
        plateNo: v.plateNo,
        driverName: d.displayName,
        dock: docks[used[plan.temp]++ % docks.length],
        loaded: [],
        state: 'PLANNED',
        stops: plan.stops.map((st) => ({ mfcId: st.mfcId, trfIds: st.trfIds })),
      };
      this.runs.set(plan.tripId, run);
      for (const st of plan.stops) for (const id of st.trfIds) this.runByTrf.set(id, run);
    }
    this.log('flow', `22:00 배차 — 운행 ${plans.length}대 계획완료 (노선 × 온도대, 첫 출차 ${plans.length ? fmt(Math.min(...plans.map((x) => x.plannedDepartMin))) : '-'})`);
  }

  private fireTimers() {
    if (!this.timers.length) return;
    this.timers.sort((a, b) => a.at - b.at);
    while (this.timers.length && this.timers[0].at <= this.time) {
      const t = this.timers.shift()!;
      try {
        t.fn();
      } catch (e) {
        this.log('warn', `운송 기록 실패: ${e instanceof ApiProblem ? `${e.problem.code} ${e.problem.detail ?? ''}` : e instanceof Error ? e.message : e}`);
      }
    }
  }
  private at(sec: number, fn: () => void) {
    this.timers.push({ at: sec, fn });
  }
  private iso(sec = this.time) {
    return new Date(Date.parse(`${this.opt.baseDate}T00:00:00+09:00`) + sec * 1000).toISOString();
  }

  /** 그 운행 몫이 모두 실렸는지 — 피킹·분류·출고대기·하강·지하 마당·싣는 중에 남은 것 없음 */
  private tripLoaded(r: TripRun): boolean {
    if (!this.day.released || !r.loaded.length || this.loading.has(r.plan.tripId)) return false;
    const ids = new Set(r.plan.stops.flatMap((s) => s.trfIds));
    if (this.backend.allTasks().some((t) => ids.has(t.trfId) && !TERMINAL.includes(t.state))) return false;
    for (const id of ids) if (this.pendingTrf(id)) return false;
    if ([...this.staged.values()].flat().some((b) => ids.has(b.trfId))) return false;
    return !this.atB1.some((x) => ids.has(x.trfId));
  }

  /**
   * 출차 — 상차완료 + 차·기사 확정 + 계획 출차 시각 도달(TMS §9.2). 사전 점검 PASS → 실제 출발 기록(transport-execution)
   * → TruckActuallyDeparted → cdc-outbound 출발 검증 → 일치 TRF 만 TOUT(CDC −q · Transit +q).
   * 늦으면 maxDepartDelayMin 까지 기다리고 실은 것만으로 출차(지연 사고). 하나도 못 실었으면 결행. 두 번째 차는 없다(1요청·1이관·1출발).
   */
  private depart(r: TripRun, late = false) {
    const p = r.plan;
    if (!r.loaded.length) {
      r.state = 'CANCELLED';
      this.log('warn', `${hm(this.time)} ${r.plateNo} ${p.region} ${TEMP_KO[p.temp]} 결행 — 실은 R/T 없음`);
      return;
    }
    if (late) this.tms.recordIncident(p.tripId, 'DELAY', `상차 미완료로 ${TMS.maxDepartDelayMin}분 늦게 실은 것만 출차`);
    const check = this.tms.recordPreDepartureCheck(p.tripId, { result: 'PASS', checkedAt: this.iso(), checkedBy: 'loader-b1-01', manifestRef: p.tripId }, newId('check'));
    const comps = p.stops.flatMap((st) =>
      st.trfIds
        .map((trfId) => ({
          trfId,
          lines: r.loaded.filter((b) => b.trfId === trfId).flatMap((b) => b.contents.map((c) => ({ lpn: b.lpn, sku: c.sku, lot: c.lot, qty: c.qty, compartmentId: `${p.vehicleId}-1` }))),
        }))
        .filter((c) => c.lines.length),
    );
    const { validation } = this.tms.recordDeparture(
      p.tripId,
      { departedAt: this.iso(), source: 'SIMULATED', vehicleId: p.vehicleId, driverId: p.driverId, evidenceRef: `SIM-GATE-${p.tripId}`, preDepartureCheckId: check.checkId, trfCompositions: comps },
      newId('departure'),
    );
    r.state = 'IN_TRANSIT';
    r.departedAt = this.time;
    r.result = validation.overallResult;
    const q = validation.transfers.reduce((a, x) => a + x.departedQty, 0);
    const rts = Math.ceil(r.loaded.length / OUTBOUND.boxesPerRt);
    this.log(validation.overallResult === 'MATCHED' ? 'flow' : 'warn', `${hm(this.time)} ${r.plateNo} 출차 → ${p.region} ${TEMP_KO[p.temp]} R/T ${rts} · ${validation.overallResult} · ${q.toLocaleString()}개 (CDC −${q} · Transit +${q})`);
    // 주행 — 계획 주행 시간 ± 몇 분 [시뮬]
    let t = this.time;
    let from = CENTER_ID;
    const legs = p.stops.map((st) => {
      const min = TMS.travelMin[`${from}>${st.mfcId}`] ?? 120;
      from = st.mfcId;
      return min;
    });
    const go = (i: number, leaveAt: number) => {
      if (i >= p.stops.length) {
        const back = (TMS.travelMin[`${from}>${CENTER_ID}`] ?? legs[0]) * 60;
        r.state = 'RETURNING';
        this.at(leaveAt + back, () => {
          this.tms.recordPhysicalEnd(p.tripId, { endedAt: this.iso(), returnCenterId: CENTER_ID }, newId('end'));
          r.state = 'RETURNED';
          r.returnedAt = this.time;
        });
        return;
      }
      const arrive = leaveAt + (legs[i] + Math.round((this.rng.next() - 0.5) * 16)) * 60;
      this.at(arrive, () => this.arriveStop(r, i, (leftAt) => go(i + 1, leftAt)));
    };
    void t;
    go(0, this.time);
  }

  /** MFC 도착 → 하차면(동시 3대, 대당 30분) → 하차 → 인계 증빙 → MFC 수령 → 정차 출발 [TMS §10] */
  private arriveStop(r: TripRun, i: number, next: (leftAt: number) => void) {
    const p = r.plan;
    const trip = this.tms.getTrip(p.tripId);
    const stop = trip.stops[i];
    const st = r.stops[i];
    this.tms.recordStopArrival(p.tripId, stop.stopId, { occurredAt: this.iso(), recordedBy: p.driverId }, newId('arrive'));
    st.arrivedAt = this.time;
    const planned = p.plannedArriveMin[i] * 60;
    const lateMin = Math.round((this.time - planned) / 60);
    if (lateMin >= 30 || this.time > TMS_LAST_ARRIVAL) this.tms.recordIncident(p.tripId, 'DELAY', `${st.mfcId} 도착 ${lateMin}분 늦음`);
    const free = this.bays.get(st.mfcId) ?? Array(TMS.unloadBaysPerMfc).fill(0);
    free.sort((a, b) => a - b);
    const startAt = Math.max(this.time, free[0]);
    free[0] = startAt + TMS.unloadMin * 60;
    this.bays.set(st.mfcId, free);
    this.at(startAt, () => {
      this.tms.recordUnloadingStart(p.tripId, stop.stopId, { occurredAt: this.iso(), recordedBy: p.driverId, unloadingBayId: `${st.mfcId}-BAY` }, newId('unload'));
      this.at(this.time + TMS.unloadMin * 60, () => {
        for (const trfId of st.trfIds) {
          const boxes = r.loaded.filter((b) => b.trfId === trfId);
          if (!boxes.length) continue;
          const lines = boxes.flatMap((b) => b.contents.map((c) => ({ lpn: b.lpn, sku: c.sku, lot: c.lot, qty: c.qty })));
          this.tms.recordHandover(p.tripId, stop.stopId, { trfId, handedAt: this.iso(), handedBy: p.driverId, receivedBy: `${st.mfcId}-담당`, lines, evidenceRef: `SIM-SIGN-${trfId}` }, newId('handover'));
          // MFC 실제 수령(TIN, MFC 역할) → CDC 가 결과를 받아 Transit −r [WMS 0.3, CDC-F-024] — MOCK 은 인계 수량 그대로 정상 수령
          const agg = new Map<string, { sku: string; lot: string; normalQty: number; quarantinedQty: number }>();
          for (const l of lines) {
            const k = `${l.sku}|${l.lot}`;
            const cur = agg.get(k) ?? { sku: l.sku, lot: l.lot, normalQty: 0, quarantinedQty: 0 };
            cur.normalQty += l.qty;
            agg.set(k, cur);
          }
          this.backend.ledger.acknowledgeReceipt(trfId, `RCP-${trfId}`, [...agg.values()]);
          const q = lines.reduce((a, l) => a + l.qty, 0);
          st.received = (st.received ?? 0) + q;
          this.tms.noteReceived(p.tripId, trfId, q);
        }
        st.handedAt = this.time;
        if (!trip.stops[i].trfIds.some((id) => r.loaded.some((b) => b.trfId === id))) {
          // 실린 게 없는 정차(결품 등) — 빈 인계 기록 없이는 정차 출발이 안 되므로 0 개 인계로 남긴다
          for (const trfId of st.trfIds) this.tms.recordHandover(p.tripId, stop.stopId, { trfId, handedAt: this.iso(), handedBy: p.driverId, receivedBy: `${st.mfcId}-담당`, lines: [{ sku: 'E-00000000', qty: 0 }], evidenceRef: 'SIM-EMPTY' }, newId('handover'));
        }
        this.tms.recordStopDeparture(p.tripId, stop.stopId, { occurredAt: this.iso(), recordedBy: p.driverId }, newId('stopdep'));
        st.leftAt = this.time;
        this.log('flow', `${hm(this.time)} ${r.plateNo} ${MFCS.find((x) => x.id === st.mfcId)?.name} 인계완료 ${(st.received ?? 0).toLocaleString()}개`);
        next(this.time);
      });
    });
  }

  // ── 사람 ───────────────────────────────────────────
  private async run(a: Agent) {
    for (;;) {
      try {
        await a.untilDuty();
        if (a.role === 'REPL') await this.replenishOnce(a);
        else if (a.role === 'FC') await this.pickOnce(a);
        else if (a.role === 'SORT') await this.sortOnce(a);
        else if (a.role === 'JOCKEY') await this.jockeyOnce(a);
        else if (a.role === 'INSPECT') await this.inspectOnce(a);
        else await this.loadOnce(a);
      } catch (e) {
        const msg = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code} ${e.problem.detail ?? ''}` : e instanceof Error ? e.message : String(e);
        this.log('warn', `${a.name}: ${msg}`);
        a.carrying = null;
        await a.wait(10, '오류 — 잠시 대기');
      }
    }
  }

  private siteOf(a: Agent): RouteSite {
    return a.floor === 'B1' ? this.b1 : this.sites.get(a.floor)!;
  }
  private floorSite(a: Agent): FloorSite {
    return this.sites.get(a.floor as FloorNo)!;
  }
  private floorOf(a: Agent): FloorLayout {
    return this.floorSite(a).f;
  }

  private async go(a: Agent, to: WalkPoint, speed: number, activity: string) {
    await a.walk(to, this.siteOf(a).route(a.at, to), speed * this.pace(a), activity);
  }

  /** 작업자 속도 배수 [가정] — 이름으로 정해 날마다 같다 */
  pace(a: Agent): number {
    let h = 0;
    for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [lo, hi] = WORK.pace;
    return lo + ((h % 1000) / 1000) * (hi - lo);
  }

  /** 좁은 선반 통로에 다른 사람이 있으면 잠깐 기다린다 [가정] */
  private async aisleClear(a: Agent, to: WalkPoint) {
    if (to.lane !== 'S') return;
    const other = this.agents.some((x) => x !== a && x.floor === a.floor && Math.abs(x.pos.x - to.x) < 0.7 && Math.abs(x.pos.z - to.z) < 3);
    if (other) {
      this.aisleWaits++;
      await a.wait(WORK.aisleBlockWait, '좁은 통로 — 앞사람 기다림');
    }
  }

  private loc(code: string): Location {
    const l = this.locs.get(code);
    if (!l) throw new Error(`위치 없음 ${code}`);
    return l;
  }

  /** 지게차 보충 — 팔레트 랙에 잡힌 Wave 수요를 선반으로(CDC-F-013) */
  private async replenishOnce(a: Agent) {
    const site = this.floorSite(a);
    const need = this.backend
      .replenishmentNeeds()
      .find((n) => Number(n.from.split('-')[2]) === a.floor && !this.claimed.has(`${n.sku}|${n.lot}|${n.from}`));
    if (!need) {
      a.pda = null;
      await a.wait(WORK.idlePoll, '보충 대기');
      return;
    }
    const k = `${need.sku}|${need.lot}|${need.from}`;
    this.claimed.add(k);
    try {
      const name = this.catalog.bySku.get(need.sku)?.name ?? need.sku;
      const from = this.loc(need.from);
      const to = this.loc(need.to);
      a.pda = { title: '선반 보충 (MOV)', step: '팔레트로 이동', rows: [['상품', name], ['LOT', need.lot], ['출발 팔레트', from.short], ['도착 선반', to.short], ['수량', `${need.qty}`]] };
      await this.go(a, site.front(from), WORK.forklift, `팔레트로 (${from.short})`);
      a.pda.step = '지게차로 팔레트 내리기';
      await a.wait(WORK.replPallet, '지게차로 팔레트 내리기');
      a.carrying = 'PALLET';
      a.pda.step = '선반으로 이동';
      const now = this.backend.replenishmentNeeds().find((n) => `${n.sku}|${n.lot}|${n.from}` === k);
      const qty = now?.qty ?? 0;
      if (to.bin) {
        // 오토스토어 빈 채우기 — 포트까지 지게차
        await this.go(a, site.front(to), WORK.forklift, '오토스토어 포트로');
        a.pda.step = '빈(통)에 채우기';
        await a.wait(WORK.portBin + WORK.replShelf + qty * WORK.replPerUnit, '오토스토어 빈에 채우기');
      } else {
        // 지게차는 선반 통로 입구까지 — 세워 두고 걸어서 진열 [사용자 2026-11-25]
        const gate = site.shelfEntrance(to);
        await this.go(a, gate, WORK.forklift, `선반 입구로 (${to.short})`);
        a.parked = { x: a.pos.x, z: a.pos.z, heading: a.heading };
        a.carrying = null;
        a.pda.step = '지게차 세우고 걸어서 진열';
        await this.go(a, site.front(to), WORK.walk, `걸어서 선반으로 (${to.short})`);
        await a.wait(WORK.replShelf + qty * WORK.replPerUnit, '박스 뜯어 진열');
        await this.go(a, gate, WORK.walk, '지게차로');
        a.parked = null;
      }
      if (qty > 0) {
        this.backend.replenishMove({ sku: need.sku, lot: need.lot, fromLocationCode: need.from, toLocationCode: need.to, qty, workerId: a.id }, newId('move'));
        a.done += 1;
      }
    } finally {
      this.claimed.delete(k);
      a.carrying = null;
    }
  }

  /** FC 피커 — 다음 작업 받기 → 착수 → 선반마다 지역 바코드·상품 스캔 → 담기 → 분류대 [현장 알바몬 FC] */
  /** 작업자 색(DPS·라인 표시등 = 그 작업자 스캐너 색) [현장 "스캐너 색과 같은 불"] */
  colorOf(a: Agent): { hex: string; name: string } {
    const same = this.agents.filter((x) => x.floor === a.floor && (x.role === 'FC' || x.role === 'SORT'));
    return WORKER_COLORS[Math.max(0, same.indexOf(a)) % WORKER_COLORS.length];
  }

  /**
   * 피킹 — 작업(TRF = MFC 하나 × 구역·작업 방식)을 PDA 로 받는다 [계약 그대로, 설계 §5.4 1단계].
   * FC·박스·분배용 야채: **지역 카트**에 담는다 — 같은 지역·같은 방식 작업을 이어 받으면 한 카트에 더 담고(MFC 별 칸 유지), 지역이 바뀌거나 차면 내려놓는다.
   * DPS(냉동): 빈 박스를 들고 작업자 색 불·숫자가 켜진 선반 칸에서 집는다 → 박스 닫아 DPS 컨베이어에.
   * 라인용 상자 상품(6F): 자키가 상품 박스를 핸드자키로 라인에 가져다준다.
   */
  private async pickOnce(a: Agent) {
    const site = this.floorSite(a);
    const held = this.carts.get(a.id);
    if (held && this.time / 60 >= this.window(a).end - 20) {
      await this.deliver(a, held);
      return;
    }
    let task: Task;
    try {
      ({ task } = await this.backend.pullNextTask(CENTER_ID, a.id, { kind: 'PICK', floor: String(a.floor) }, newId('next')));
    } catch (e) {
      if (e instanceof ApiProblem && e.problem.code === 'NO_TASK_AVAILABLE') {
        if (held) {
          await this.deliver(a, held);
          return;
        }
        a.pda = { title: 'FC 피킹', step: '받을 작업 없음', rows: [] };
        await a.wait(WORK.idlePoll, '작업 대기');
        return;
      }
      throw e;
    }
    if (task.state === 'ACCEPTED') task = await this.backend.startTask(task.taskId, a.id, newId('start'), task.version);
    const trf = await this.backend.getTransferIntake(task.trfId);
    const mfc = MFCS.find((m) => m.id === trf.mfcId);
    const handling: Handling = this.catalog.bySku.get(task.lines[0].sku)?.handling ?? 'FC';
    const region = mfc?.region ?? '';
    let cart = this.carts.get(a.id);
    if (cart && (cart.region !== region || cart.handling !== handling || cart.drops.length >= WORK.cartMaxTasks)) {
      await this.deliver(a, cart);
      cart = undefined;
    }
    if (!cart) {
      cart = { region, handling, drops: [] };
      this.carts.set(a.id, cart);
    }
    const color = this.colorOf(a);
    const basket = task.lines.map((l) => ({
      name: this.catalog.bySku.get(l.sku)?.name ?? l.sku,
      loc: this.locs.get(l.locationCode)?.short ?? l.locationCode,
      planned: l.plannedQty,
      picked: l.pickedQty,
      state: (l.pickedQty + l.shortQty >= l.plannedQty ? 'DONE' : 'TODO') as 'TODO' | 'NOW' | 'DONE' | 'SHORT',
    }));
    a.carrying = handling === 'LINE' ? 'PALLET' : 'CART';
    a.pda = {
      title: HANDLING_TITLE[handling],
      step: handling === 'DPS' ? `빈 박스 받기 — 내 불 ${color.name}` : '지역 바코드 스캔',
      rows: [
        ['작업', task.taskId],
        ['지역', `${region} → ${mfc?.name ?? trf.mfcId}`],
        [handling === 'DPS' ? '박스' : handling === 'LINE' ? '핸드자키' : '지역 카트', handling === 'DPS' ? `MFC 박스 (${mfc?.name ?? ''})` : `${region} ${cart.drops.length + 1}번째 MFC 몫`],
        ['진행', `0/${task.lines.length}`],
      ],
      basket,
    };
    await a.wait(WORK.regionScan, handling === 'DPS' ? '빈 박스 받기' : '지역 바코드 스캔');
    const took = new Map<string, number>();
    for (let i = 0; i < task.lines.length; i++) {
      const l = task.lines[i];
      const remaining = l.plannedQty - l.pickedQty - l.shortQty;
      if (remaining <= 0) continue;
      const loc = this.loc(l.locationCode);
      basket[i].state = 'NOW';
      a.pda.step = handling === 'PORT' ? '포트로 — 로봇이 통을 가져옴' : `${loc.short} 로 이동`;
      const dest = site.front(loc);
      await this.aisleClear(a, dest);
      await this.go(a, dest, WORK.cart, handling === 'PORT' ? '오토스토어 포트로' : `선반으로 (${loc.short})`);
      if (handling === 'PORT') await a.wait(WORK.portBin, '로봇이 통(빈)을 포트로');
      const short = this.rng.next() < WORK.shortRate ? Math.min(remaining, 1 + Math.floor(this.rng.next() * 3)) : 0;
      const take = remaining - short;
      let light: WorkLight | null = null;
      if (handling === 'DPS' && take > 0) {
        // DPS: 그 칸에 내 색 불과 숫자 [현장 DPS "진열 칸에 불과 수량"]
        light = { floor: a.floor as FloorNo, kind: 'DPS', x: loc.pos.x + (loc.face ?? 1) * 0.3, y: loc.pos.y + 0.32, z: loc.pos.z, color: color.hex, qty: take, who: a.id };
        this.lights.push(light);
        this.litCount++;
        a.pda.step = `${color.name} 불 ${take} → 박스에 담기`;
      } else a.pda.step = `${basket[i].name} ${take}개 ${handling === 'LINE' ? '박스째 싣기' : '카트에 담기'}`;
      await a.wait((WORK.pickScan + take * WORK.pickPerUnit * (handling === 'BOX' ? WORK.heavyFactor : 1)) / this.pace(a), handling === 'DPS' ? '불 보고 집기' : handling === 'BOX' ? '무거운 상자 싣기' : '상품 스캔 → 담기');
      if (light) this.lights.splice(this.lights.indexOf(light), 1);
      await this.backend.reportPickResult(
        task.taskId,
        { workerId: a.id, lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: take, ...(short ? { shortQty: short, shortReason: 'NOT_FOUND' as const } : {}) }] },
        newId('pick'),
      );
      if (take > 0) this.pickLog.push({ at: this.time, qty: take });
      this.shortUnits += short;
      if (take > 0) took.set(`${l.sku}|${l.lot}`, (took.get(`${l.sku}|${l.lot}`) ?? 0) + take);
      basket[i].picked += take;
      basket[i].state = short ? 'SHORT' : 'DONE';
      if (short) this.log('warn', `${a.name} 결품 보고 ${loc.short} ${basket[i].name} ${short}개`);
      a.pda.rows[3] = ['진행', `${basket.filter((b) => b.state === 'DONE' || b.state === 'SHORT').length}/${task.lines.length}`];
    }
    const contents: Contents = [...took].map(([k, qty]) => ({ sku: k.split('|')[0], lot: k.split('|')[1], qty }));
    if (contents.length)
      cart.drops.push({
        taskId: task.taskId,
        trfId: task.trfId,
        waveId: task.waveId,
        mfcId: trf.mfcId,
        contents,
        temp: this.catalog.bySku.get(contents[0].sku)?.temp ?? 'AMBIENT',
        stagingCode: stagingCodeFor(task.lines[0].locationCode, mfc?.staging ?? 1),
      });
    a.done += 1;
    if (handling === 'DPS' || handling === 'LINE') await this.deliver(a, cart);
  }

  /** 박스 닫기 — OUTBOUND.boxMaxUnits 개씩 나눠 LPN(한 LPN = 한 TRF) → 분류 결과(BOX SEALED) */
  private async seal(a: Agent, d: { trfId: string; waveId: string; contents: Contents; temp: TemperatureZone }) {
    const boxes: Contents[] = [[]];
    let room: number = OUTBOUND.boxMaxUnits;
    for (const c of d.contents) {
      let left = c.qty;
      while (left > 0) {
        if (room === 0) {
          boxes.push([]);
          room = OUTBOUND.boxMaxUnits;
        }
        const q = Math.min(left, room);
        boxes[boxes.length - 1].push({ sku: c.sku, lot: c.lot, qty: q });
        left -= q;
        room -= q;
      }
    }
    const lpns = boxes.filter((b) => b.length).map((cs) => ({ lpn: `BOX-${d.trfId}-${++this.lpnSeq}`, unitType: 'BOX' as const, state: 'SEALED' as const, temperatureZone: d.temp, contents: cs }));
    if (lpns.length) await this.backend.reportSortingResult({ waveId: d.waveId, trfId: d.trfId, workerId: a.id, lpns }, newId('sort'));
    return lpns;
  }

  /** 카트·박스 내려놓기 — 방식마다 다른 곳으로 */
  private async deliver(a: Agent, cart: Cart) {
    const site = this.floorSite(a);
    const fl = a.floor as FloorNo;
    const mfcName = (id: string) => MFCS.find((m) => m.id === id)?.name ?? id;
    if (cart.drops.length) {
      if (cart.handling === 'LINE') {
        // FC 는 피킹만 — 라인 공급대에 내려놓으면 자키가 라인으로 [사용자 2026-11-25 "라인 박스 운반을 자키에게"]
        a.pda = { title: HANDLING_TITLE.LINE, step: '라인 공급대에 내려놓기', rows: [['MFC', [...new Set(cart.drops.map((d) => mfcName(d.mfcId)))].join(' · ')]] };
        await this.go(a, site.lineBuffer(), WORK.cart, '라인 공급대로');
        await a.wait(WORK.cartDrop, '상품 박스 내려놓기');
        this.lineBuffer.get(fl)!.push(...cart.drops.map((drop) => ({ at: this.time, drop })));
      } else if (cart.handling === 'SPLIT') {
        a.pda = { title: HANDLING_TITLE.SPLIT, step: '분배대로 지역 카트 가져가기', rows: [['지역', cart.region], ['MFC', [...new Set(cart.drops.map((d) => mfcName(d.mfcId)))].join(' · ')]] };
        await this.go(a, site.dropAt('SPLIT'), WORK.cart, '분배대로');
        await a.wait(WORK.cartDrop, '지역 카트 내려놓기');
        this.splitQueue.get(fl)!.push({ region: cart.region, drops: cart.drops });
      } else if (cart.handling === 'BOX') {
        // 무거운 상자 → 1차 고속분류기(휠소터): 박스를 올리면 바퀴가 MFC 갈래로 보낸다 → 자키가 갈래 끝 롤테이너를 출고대기로
        a.pda = { title: HANDLING_TITLE.BOX, step: '휠소터 투입구에 박스 올리기', rows: [['지역', cart.region], ['MFC', [...new Set(cart.drops.map((d) => mfcName(d.mfcId)))].join(' · ')]] };
        await this.go(a, site.sorterIn(), WORK.cart, '휠소터로');
        await a.wait(WORK.cartDrop, '휠소터에 박스 올리기(라벨 스캔)');
        for (const d of cart.drops) {
          const lpns = await this.seal(a, d);
          this.sealedBy.SORTER += lpns.length;
          const m = Math.max(0, MFCS.findIndex((x) => x.id === d.mfcId));
          for (const l of lpns) {
            this.sorterIn.push(this.time);
            this.jockeyQueue.get(fl)!.push({ trfId: d.trfId, mfcId: d.mfcId, lpn: l.lpn, units: l.contents.reduce((x, c) => x + c.qty, 0), temp: d.temp, stagingCode: d.stagingCode, contents: l.contents, from: site.sorterOut(m), readyAt: this.time + WORK.sorterTravel });
          }
        }
        if (this.sorterIn.length > 200) this.sorterIn.splice(0, this.sorterIn.length - 200);
      } else if (cart.handling === 'DPS') {
        const at = site.dropAt('DPS');
        a.pda = { title: HANDLING_TITLE.DPS, step: '박스 닫아 컨베이어에', rows: [['MFC', mfcName(cart.drops[0].mfcId)]] };
        await this.go(a, at, WORK.cart, 'DPS 컨베이어로');
        await a.wait(WORK.cartDrop, '박스 닫아 컨베이어에');
        for (const d of cart.drops) {
          const lpns = await this.seal(a, d);
          this.sealedBy.DPS += lpns.length;
          for (const l of lpns) this.jockeyQueue.get(fl)!.push({ trfId: d.trfId, mfcId: d.mfcId, lpn: l.lpn, units: l.contents.reduce((x, c) => x + c.qty, 0), temp: d.temp, stagingCode: d.stagingCode, contents: l.contents, from: at });
        }
      } else {
        // 박스·FC: 피킹 = 분류 — 출고대기 MFC 롤테이너로 바로 [현장 "DPS·박스 피킹 → 바로 출고대기"]
        for (const code of [...new Set(cart.drops.map((d) => d.stagingCode))]) {
          const dest = this.loc(code);
          const ds = cart.drops.filter((d) => d.stagingCode === code);
          a.pda = { title: HANDLING_TITLE[cart.handling], step: `${dest.short} 로 — MFC 박스 내려놓기`, rows: [['지역', cart.region], ['MFC', mfcName(ds[0].mfcId)]] };
          await this.go(a, site.front(dest), WORK.cart, `출고대기로 (${dest.short})`);
          await a.wait(WORK.cartDrop, '박스 닫고 MFC 롤테이너에');
          for (const d of ds) {
            const lpns = await this.seal(a, d);
            if (cart.handling === 'PORT') this.sealedBy.PORT += lpns.length;
            else this.sealedBy.DIRECT += lpns.length;
            const arr = this.staged.get(code) ?? [];
            arr.push(...lpns.map((l) => ({ lpn: l.lpn, trfId: d.trfId, mfcId: d.mfcId, units: l.contents.reduce((x, c) => x + c.qty, 0), temp: d.temp, state: 'WAIT' as const, contents: l.contents })));
            this.staged.set(code, arr);
          }
        }
      }
    }
    this.carts.delete(a.id);
    a.carrying = null;
    a.pda = null;
  }

  /** 6F 분류 작업자 — 번호 홀수 = 라인(DAS), 짝수 = 분배 */
  private async sortOnce(a: Agent) {
    const k = Number(a.id.slice(-2));
    if (a.floor !== 6) {
      await a.wait(WORK.idlePoll, '대기');
      return;
    }
    if (k <= WORK.lineWorkers) await this.lineOnce(a, Math.floor((k - 1) / WORK.perLine));
    // (줄 하나에 WORK.perLine 명 — 같은 칸에 서로 다른 색 불)
    else await this.splitOnce(a, k - WORK.lineWorkers - 1);
  }

  /**
   * 라인(DAS) — 상품 기준(사용자 2026-11-25 "라인 입력을 상품 기준으로"): 라인에 모인 상품 박스 중 **가장 많은 MFC 가 기다리는 상품**을 스캔하면
   * 그 상품을 받는 MFC 칸마다 **내 스캐너 색 불과 숫자**가 켜지고, 칸마다 숫자만큼 넣는다. 한 줄에 두 사람이 있어 같은 칸에 두 색이 함께 켜질 수 있다.
   * 그 MFC 몫이 라인에 더 없으면 칸(MFC 박스)을 닫아 분류 결과(MFC 별) → 자키가 출고대기로 [현장 라인, 설계 §5.4].
   */
  private async lineOnce(a: Agent, k: number) {
    const site = this.floorSite(a);
    const fl = a.floor as FloorNo;
    const spot = site.lineSpot('DAS', k);
    const q = this.lineQueue.get(fl)!;
    const color = this.colorOf(a);
    const atStand = a.at.x === spot.stand.x && a.at.z === spot.stand.z;
    // 상품별로 어느 MFC(TRF) 몫이 얼마나 있나
    const by = new Map<string, { sku: string; lot: string; per: { d: Drop; c: Contents[number] }[] }>();
    for (const d of q)
      for (const c of d.contents)
        if (c.qty > 0) {
          const key = `${c.sku}|${c.lot}`;
          const g = by.get(key) ?? { sku: c.sku, lot: c.lot, per: [] };
          g.per.push({ d, c });
          by.set(key, g);
        }
    const groups = [...by.values()].map((g) => ({ ...g, trfs: new Set(g.per.map((x) => x.d.trfId)).size }));
    groups.sort((x, y) => y.trfs - x.trfs);
    const best = groups[0];
    const upstream = this.lineBuffer.get(fl)!.length > 0 || [...this.carts.values()].some((c) => c.handling === 'LINE');
    if (!best || (best.trfs === 1 && upstream && q.length < WORK.lineBatch * 2)) {
      // 같은 상품의 다른 MFC 몫이 오는 중이면 조금 기다린다(한 번 스캔에 여러 칸)
      await this.sealLineBoxes(a, fl, k);
      if (!atStand) await this.go(a, spot.stand, WORK.walk, '라인으로');
      a.pda = best ? { title: `라인 (DAS) — 내 불 ${color.name}`, step: '같은 상품 다른 MFC 몫 기다림', rows: [] } : null;
      await a.wait(WORK.idlePoll / 3, best ? '상품 박스 더 기다림' : '상품 박스 대기');
      return;
    }
    // 이 상품 몫을 집어 간다(다른 작업자와 겹치지 않게 바로 뺀다)
    const take = best.per.map(({ d, c }) => {
      const qty = c.qty;
      c.qty = 0;
      return { d, qty };
    });
    for (const d of q.filter((x) => x.contents.every((c) => c.qty <= 0))) q.splice(q.indexOf(d), 1);
    const perTrf = new Map<string, { d: Drop; qty: number }>();
    for (const t of take) {
      const cur = perTrf.get(t.d.trfId);
      if (cur) cur.qty += t.qty;
      else perTrf.set(t.d.trfId, { d: t.d, qty: t.qty });
    }
    for (const id of perTrf.keys()) this.busy.set(id, (this.busy.get(id) ?? 0) + 1);
    if (!atStand) await this.go(a, spot.stand, WORK.walk, '라인으로');
    const name = this.catalog.bySku.get(best.sku)?.name ?? best.sku;
    const mIdx = (id: string) => Math.max(0, MFCS.findIndex((m) => m.id === id));
    const targets = [...perTrf.values()].sort((x, y) => mIdx(x.d.mfcId) - mIdx(y.d.mfcId));
    a.pda = { title: `라인 (DAS) — 내 불 ${color.name}`, step: `${name} 스캔`, rows: [['상품', name], ...targets.map((t) => [MFCS[mIdx(t.d.mfcId)].name, `${t.qty}개`] as [string, string])] };
    await a.wait(WORK.lineScan / this.pace(a), '상품 스캔');
    const lit = targets.map((t) => ({ floor: fl, kind: 'LINE' as const, ...spot.light(mIdx(t.d.mfcId)), color: color.hex, qty: t.qty, who: a.id }));
    this.lights.push(...lit);
    this.litCount += lit.length;
    this.lineLitMax = Math.max(this.lineLitMax, lit.length);
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const m = mIdx(t.d.mfcId);
      a.pda.step = `${MFCS[m].name} 칸에 ${t.qty}개 — 불·숫자대로 넣기`;
      const p = spot.slot(m);
      await a.walk(p, [p], WORK.walk * this.pace(a), '불·숫자대로 칸에 넣기');
      await a.wait((t.qty * WORK.linePerUnit) / this.pace(a), '불·숫자대로 칸에 넣기');
      this.lights.splice(this.lights.indexOf(lit[i]), 1);
      const key = `${fl}-${k}-${t.d.trfId}`;
      const box = this.openBoxes.get(key) ?? { trfId: t.d.trfId, waveId: t.d.waveId, mfcId: t.d.mfcId, temp: t.d.temp, stagingCode: t.d.stagingCode, contents: [], row: k, floor: fl, from: p };
      const same = box.contents.find((c) => c.sku === best.sku && c.lot === best.lot);
      if (same) same.qty += t.qty;
      else box.contents.push({ sku: best.sku, lot: best.lot, qty: t.qty });
      this.openBoxes.set(key, box);
    }
    for (const id of perTrf.keys()) this.busy.set(id, (this.busy.get(id) ?? 1) - 1);
    await this.sealLineBoxes(a, fl, k);
  }

  /** 라인 칸 박스 닫기 — 그 MFC 몫이 라인에 더 없거나 박스가 차면 */
  private async sealLineBoxes(a: Agent, fl: FloorNo, k: number) {
    const q = this.lineQueue.get(fl)!;
    for (const [key, box] of [...this.openBoxes]) {
      if (box.floor !== fl || box.row !== k) continue;
      const units = box.contents.reduce((s, c) => s + c.qty, 0);
      const more = q.some((d) => d.trfId === box.trfId && d.contents.some((c) => c.qty > 0)) || this.lineBuffer.get(fl)!.some((x) => x.drop.trfId === box.trfId) || [...this.carts.values()].some((c) => c.drops.some((d) => d.trfId === box.trfId));
      if (more && units < OUTBOUND.boxMaxUnits) continue;
      // 같은 줄 다른 작업자가 이미 닫았으면 건너뜀(목록은 시작 때 찍은 것)
      if (this.openBoxes.get(key) !== box) continue;
      this.openBoxes.delete(key);
      if (!units) continue;
      const lpns = await this.seal(a, { trfId: box.trfId, waveId: box.waveId, contents: box.contents, temp: box.temp });
      this.sealedBy.LINE += lpns.length;
      for (const l of lpns) this.jockeyQueue.get(fl)!.push({ trfId: box.trfId, mfcId: box.mfcId, lpn: l.lpn, units: l.contents.reduce((x, c) => x + c.qty, 0), temp: box.temp, stagingCode: box.stagingCode, contents: l.contents, from: box.from });
    }
  }

  /**
   * 분배(야채) — FC 가 가져온 **지역 카트**(알티, 지역명 종이)를 PDA 로 스캔 → 지역·MFC 별 수량 → MFC 별 크레이트에 담고 **지역 바코드**로 확인 [현장 분배].
   * 크레이트 하나 = MFC 하나(LPN = TRF) [사용자 2026-11-25].
   */
  private async splitOnce(a: Agent, k: number) {
    const site = this.floorSite(a);
    const fl = a.floor as FloorNo;
    const spot = site.lineSpot('SPLIT', k);
    const q = this.splitQueue.get(fl)!;
    const cart = q.shift();
    if (!cart) {
      if (a.at.x !== spot.stand.x || a.at.z !== spot.stand.z) await this.go(a, spot.stand, WORK.walk, '분배대로');
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '지역 카트 대기');
      return;
    }
    for (const d of cart.drops) this.busy.set(d.trfId, (this.busy.get(d.trfId) ?? 0) + 1);
    if (a.at.x !== spot.stand.x || a.at.z !== spot.stand.z) await this.go(a, spot.stand, WORK.walk, '분배대로');
    await this.distribute(a, cart.drops, {
      title: `분배 (야채) — ${cart.region} 카트`,
      scan: WORK.splitScan,
      perUnit: WORK.splitPerUnit,
      slot: (m) => spot.slot(m),
      light: null,
      put: 'MFC 크레이트에 담기',
    });
    a.pda!.step = `${cart.region} 지역 바코드 스캔`;
    await a.wait(WORK.regionScan, '지역 바코드 스캔');
    await a.walk(spot.stand, [spot.stand], WORK.walk, '분배대로');
    for (const d of cart.drops) this.busy.set(d.trfId, (this.busy.get(d.trfId) ?? 1) - 1);
  }

  /** 나눠 담기(라인·분배 공통) — 상품별로 스캔 → MFC 칸마다 숫자만큼 → 다 끝나면 MFC(TRF) 별 박스 닫기 → 자키 줄 */
  private async distribute(
    a: Agent,
    drops: Drop[],
    o: { title: string; scan: number; perUnit: number; slot: (m: number) => WalkPoint; light: ((m: number, qty: number) => WorkLight) | null; put: string },
  ) {
    const fl = a.floor as FloorNo;
    const mIdx = (id: string) => Math.max(0, MFCS.findIndex((m) => m.id === id));
    const bySku = new Map<string, { sku: string; lot: string; per: Map<string, number> }>();
    for (const d of drops)
      for (const c of d.contents) {
        const key = `${c.sku}|${c.lot}`;
        const g = bySku.get(key) ?? { sku: c.sku, lot: c.lot, per: new Map() };
        g.per.set(d.trfId, (g.per.get(d.trfId) ?? 0) + c.qty);
        bySku.set(key, g);
      }
    const trfInfo = new Map(drops.map((d) => [d.trfId, d]));
    const into = new Map<string, Contents>();
    a.pda = { title: o.title, step: '상품 스캔', rows: [] };
    for (const g of bySku.values()) {
      const name = this.catalog.bySku.get(g.sku)?.name ?? g.sku;
      const targets = [...g.per].sort((x, y) => mIdx(trfInfo.get(x[0])!.mfcId) - mIdx(trfInfo.get(y[0])!.mfcId));
      a.pda.step = `${name} 스캔`;
      a.pda.rows = [['상품', name], ...targets.map(([t, qty]) => [MFCS[mIdx(trfInfo.get(t)!.mfcId)].name, `${qty}개`] as [string, string])];
      await a.wait(o.scan, '상품 스캔');
      const lit = o.light ? targets.map(([t, qty]) => o.light!(mIdx(trfInfo.get(t)!.mfcId), qty)) : [];
      this.lights.push(...lit);
      this.lineLitMax = Math.max(this.lineLitMax, lit.length);
      this.litCount += lit.length;
      for (let i = 0; i < targets.length; i++) {
        const [t, qty] = targets[i];
        const m = mIdx(trfInfo.get(t)!.mfcId);
        a.pda.step = `${MFCS[m].name} 칸에 ${qty}개 — ${o.put}`;
        const p = o.slot(m);
        await a.walk(p, [p], WORK.walk * this.pace(a), o.put);
        await a.wait((qty * o.perUnit) / this.pace(a), o.put);
        if (!o.light && this.rng.next() < WORK.splitMistake) {
          // 분배 수량 실수 → 지역 바코드 확인 전에 다시 셈 [현장 "자잘한 야채가 많아 수량 실수가 잦다"]
          this.splitMistakes++;
          a.pda.step = `수량이 안 맞음 — ${MFCS[m].name} 크레이트 다시 세기`;
          this.log('flow', `${a.name} 분배 수량 실수 → 다시 셈 (${MFCS[m].name} ${qty}개)`);
          await a.wait(WORK.recount, '수량 다시 세기');
        }
        if (lit[i]) this.lights.splice(this.lights.indexOf(lit[i]), 1);
        const arr = into.get(t) ?? [];
        arr.push({ sku: g.sku, lot: g.lot, qty });
        into.set(t, arr);
      }
    }
    a.pda.step = 'MFC 박스 닫기';
    for (const [t, contents] of into) {
      const d = trfInfo.get(t)!;
      const lpns = await this.seal(a, { trfId: t, waveId: d.waveId, contents, temp: d.temp });
      this.sealedBy[o.light ? 'LINE' : 'SPLIT'] += lpns.length;
      for (const l of lpns) this.jockeyQueue.get(fl)!.push({ trfId: t, mfcId: d.mfcId, lpn: l.lpn, units: l.contents.reduce((x, c) => x + c.qty, 0), temp: d.temp, stagingCode: d.stagingCode, contents: l.contents, from: o.slot(mIdx(d.mfcId)) });
    }
  }

  /** 아직 손에 있거나 줄에 있는 그 TRF 물건이 있는지(카트·라인·분배·자키·나눠 담는 중) */
  private pendingTrf(trfId: string): boolean {
    if ((this.busy.get(trfId) ?? 0) > 0) return true;
    for (const c of this.carts.values()) if (c.drops.some((d) => d.trfId === trfId)) return true;
    for (const q of this.lineQueue.values()) if (q.some((d) => d.trfId === trfId)) return true;
    for (const q of this.lineBuffer.values()) if (q.some((x) => x.drop.trfId === trfId)) return true;
    for (const b of this.openBoxes.values()) if (b.trfId === trfId) return true;
    for (const q of this.splitQueue.values()) if (q.some((c) => c.drops.some((d) => d.trfId === trfId))) return true;
    for (const q of this.jockeyQueue.values()) if (q.some((j) => j.trfId === trfId)) return true;
    return false;
  }

  /** 이 층에서 그 MFC 몫 일이 다 끝났는지 — 피킹·분류·출고대기 옮기기·검품 */
  private floorDoneFor(floor: FloorNo, trfId: string, code: string): boolean {
    const tasks = this.backend.allTasks().filter((t) => t.trfId === trfId && t.lines[0]?.locationCode.split('-')[2] === String(floor));
    if (!this.day.released || tasks.some((t) => !TERMINAL.includes(t.state))) return false;
    if (this.pendingTrf(trfId)) return false;
    return !(this.staged.get(code) ?? []).some((b) => b.state !== 'PASSED');
  }

  /**
   * 자키 — ① 분류된 박스를 출고대기(91 MFC 자리)로, 저온은 보냉 커버 [현장]
   * ② 21:00 부터(그 MFC 층 일이 끝났으면 더 일찍) 검품 합격 박스를 롤테이너째 승강기로 지하에 내린다 [현장 21시~ 하강]
   */
  private async jockeyOnce(a: Agent) {
    const site = this.floorSite(a);
    const f = this.floorOf(a);
    const fl = a.floor as FloorNo;
    const q = this.jockeyQueue.get(fl)!;
    // ① 라인 공급 — 공급대에 모인 상품 박스(여러 MFC 몫)를 핸드자키로 라인 줄에 [현장 "자키가 박스 갖다주면"]
    const buf = this.lineBuffer.get(fl)!;
    if (buf.length && (buf.length >= WORK.lineBatch || this.time - buf[0].at > WORK.lineWaitMax)) {
      const take = buf.splice(0, buf.length);
      const rows = Math.max(1, Math.ceil(WORK.lineWorkers / WORK.perLine));
      const row = this.lineRowNext++ % rows;
      for (const x of take) this.busy.set(x.drop.trfId, (this.busy.get(x.drop.trfId) ?? 0) + 1);
      a.pda = { title: '자키 — 라인 공급', step: `라인 ${row + 1}줄로 상품 박스`, rows: [['상품 박스', `${take.length}`], ['MFC', [...new Set(take.map((x) => MFCS.find((m) => m.id === x.drop.mfcId)?.name ?? ''))].join(' · ')]] };
      await this.go(a, site.lineBuffer(), WORK.walk, '라인 공급대로');
      await a.wait(WORK.jockeyHandle, '핸드자키에 싣기');
      a.carrying = 'PALLET';
      await this.go(a, site.lineSpot('DAS', row * WORK.perLine).stand, WORK.cart, `라인 ${row + 1}줄로`);
      await a.wait(WORK.jockeyHandle, '라인에 내려놓기');
      // 라인 전체가 같이 본다 — 작업자는 가장 많은 MFC 가 기다리는 상품부터
      this.lineQueue.get(fl)!.push(...take.map((x) => ({ ...x.drop, contents: x.drop.contents.map((c) => ({ ...c })) })));
      for (const x of take) this.busy.set(x.drop.trfId, (this.busy.get(x.drop.trfId) ?? 1) - 1);
      a.carrying = null;
      a.done += take.length;
      a.pda = null;
      return;
    }
    const readyJobs = q.filter((j) => (j.readyAt ?? 0) <= this.time);
    if (readyJobs.length) {
      const code = readyJobs[0].stagingCode;
      const batch: JockeyJob[] = [];
      for (let i = 0; i < q.length && batch.length < OUTBOUND.boxesPerRt; ) {
        if (q[i].stagingCode === code && (q[i].readyAt ?? 0) <= this.time) batch.push(...q.splice(i, 1));
        else i++;
      }
      const dest = this.loc(code);
      const units = batch.reduce((s, b) => s + b.units, 0);
      a.pda = { title: '자키', step: '롤테이너 싣기', rows: [['박스', `${batch.length}`], ['출고대기', dest.short], ['MFC', MFCS.find((m) => m.id === batch[0].mfcId)?.name ?? '']] };
      await this.go(a, batch[0].from, WORK.walk, '박스 가지러');
      await a.wait(WORK.jockeyHandle, '롤테이너 싣기');
      a.carrying = 'ROLL';
      a.cold = dest.temp !== 'AMBIENT';
      a.pda.step = `${dest.short} 로 밀고 가기`;
      await this.go(a, site.front(dest), WORK.cart, `출고대기로 (${dest.short})`);
      await a.wait(WORK.jockeyHandle, dest.temp === 'AMBIENT' ? '출고대기에 내려놓기' : '출고대기에 내려놓기 · 보냉 커버');
      const arr = this.staged.get(code) ?? [];
      arr.push(...batch.map((b) => ({ lpn: b.lpn, trfId: b.trfId, mfcId: b.mfcId, units: b.units, temp: b.temp, state: 'WAIT' as const, contents: b.contents })));
      this.staged.set(code, arr);
      a.carrying = null;
      a.done += batch.length;
      a.pda = null;
      void units;
      return;
    }
    // ② 하강
    const m = this.time / 60;
    const ready = f.staging.find((s) => {
      const arr = this.staged.get(s.code) ?? [];
      const passed = arr.filter((b) => b.state === 'PASSED');
      if (!passed.length) return false;
      return m >= OUTBOUND.lowerFrom || this.floorDoneFor(fl, passed[0].trfId, s.code);
    });
    if (!ready) {
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '롤테이너 대기');
      return;
    }
    const arr = this.staged.get(ready.code)!;
    const first = arr.find((b) => b.state === 'PASSED')!;
    const boxes = arr.filter((b) => b.state === 'PASSED' && b.trfId === first.trfId).slice(0, OUTBOUND.boxesPerRt);
    for (const b of boxes) b.state = 'MOVING';
    const lift = (MFCS.find((x) => x.id === boxes[0].mfcId)?.staging ?? 1) % f.lifts.length || f.lifts.length;
    a.pda = { title: '자키 — 하강', step: `${ready.short} 롤테이너 → 승강기 ${lift}`, rows: [['박스', `${boxes.length}`], ['MFC', MFCS.find((x) => x.id === boxes[0].mfcId)?.name ?? '']] };
    await this.go(a, site.front(ready), WORK.walk, `출고대기로 (${ready.short})`);
    await a.wait(WORK.jockeyHandle, '롤테이너 싣기');
    a.carrying = 'ROLL';
    a.cold = ready.temp !== 'AMBIENT';
    await this.go(a, liftDoor(f, lift), WORK.cart, `승강기 ${lift} 로`);
    await a.wait(OUTBOUND.liftRide, '승강기로 지하에 내림');
    this.staged.set(
      ready.code,
      arr.filter((b) => !boxes.includes(b)),
    );
    this.atB1.push({ boxes, mfcId: boxes[0].mfcId, trfId: boxes[0].trfId, lift });
    a.carrying = null;
    a.cold = false;
    a.done += boxes.length;
    a.pda = null;
  }

  /** 검품 — 출고대기 박스를 MFC 별로: 수량·봉인·온도 확인 → 합격/불합격(재포장 뒤 재검품) [WMS CDC-F-019] */
  private async inspectOnce(a: Agent) {
    const site = this.floorSite(a);
    const f = this.floorOf(a);
    const slot = f.staging.find((s) => (this.staged.get(s.code) ?? []).some((b) => b.state === 'WAIT'));
    if (!slot) {
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '검품 대기');
      return;
    }
    const boxes = this.staged.get(slot.code)!.filter((b) => b.state === 'WAIT').slice(0, 8);
    for (const b of boxes) b.state = 'CHECK';
    const trfId = boxes[0].trfId;
    const group = boxes.filter((b) => b.trfId === trfId);
    for (const b of boxes) if (!group.includes(b)) b.state = 'WAIT';
    a.pda = { title: '검품', step: '박스 수량·봉인·온도 확인', rows: [['출고대기', slot.short], ['TRF', trfId], ['박스', `${group.length}`]] };
    await this.go(a, site.front(slot), WORK.walk, `출고대기로 (${slot.short})`);
    await a.wait(OUTBOUND.inspectPerBox * group.length, '검품 — 수량·봉인·온도 확인');
    const failed = group.filter(() => this.rng.next() < OUTBOUND.inspectFailRate);
    const items = group.map((b) => (failed.includes(b) ? { lpn: b.lpn, result: 'FAILED' as const, failReason: 'DAMAGE' as const } : { lpn: b.lpn, result: 'PASSED' as const, ...(b.temp !== 'AMBIENT' ? { temperatureC: b.temp === 'FROZEN' ? -20 : 3 } : {}) }));
    await this.backend.reportInspectionResult({ trfId, inspectorId: a.id, items }, newId('inspect'));
    for (const b of group) b.state = failed.includes(b) ? 'FAILED' : 'PASSED';
    a.done += group.length;
    if (failed.length) {
      this.log('warn', `${a.name} 검품 불합격 ${failed.length}박스(파손) → 재포장`);
      a.pda.step = '재포장';
      await a.wait(OUTBOUND.rework, '재포장 → 재검품');
      await this.backend.reportInspectionResult({ trfId, inspectorId: a.id, items: failed.map((b) => ({ lpn: b.lpn, result: 'PASSED' as const })) }, newId('inspect'));
      for (const b of failed) b.state = 'PASSED';
    }
    a.pda = null;
  }

  /**
   * 지하 상차 — 그 운행 출차 30분 전부터(TMS §3), 방문 역순(뒤 정차 R/T 먼저, §7.4)으로 승강기에서 내려온 R/T 를 차에 싣고 LOADED 등록.
   * LOADED ≠ 출발, 수량 전기 없음.
   */
  private async loadOnce(a: Agent) {
    const ready = this.atB1
      .map((roll) => ({ roll, run: this.runByTrf.get(roll.trfId) }))
      .filter((x): x is { roll: RollAtB1; run: TripRun } => !!x.run && (x.run.state === 'PLANNED' || x.run.state === 'LOADING') && this.time >= (x.run.plan.plannedDepartMin - TMS.loadLeadMin) * 60)
      .sort((x, y) => x.run.plan.plannedDepartMin - y.run.plan.plannedDepartMin || this.stopSeq(y.run, y.roll.trfId) - this.stopSeq(x.run, x.roll.trfId));
    const pick = ready[0];
    if (!pick) {
      a.pda = null;
      const next = [...this.runs.values()].filter((r) => r.state === 'PLANNED').map((r) => r.plan.plannedDepartMin - TMS.loadLeadMin);
      await a.wait(WORK.idlePoll / 3, next.length ? `상차 대기 (다음 상차 ${fmt(Math.min(...next))})` : '상차 대기');
      return;
    }
    const { roll, run } = pick;
    this.atB1.splice(this.atB1.indexOf(roll), 1);
    const id = run.plan.tripId;
    this.loading.set(id, (this.loading.get(id) ?? 0) + 1);
    try {
      await this.loadRoll(a, roll, run);
    } finally {
      const n = (this.loading.get(id) ?? 1) - 1;
      if (n > 0) this.loading.set(id, n);
      else this.loading.delete(id);
    }
  }

  private stopSeq(run: TripRun, trfId: string): number {
    return run.plan.stops.findIndex((s) => s.trfIds.includes(trfId));
  }

  private async loadRoll(a: Agent, roll: RollAtB1, run: TripRun) {
    const p = run.plan;
    if (run.state === 'PLANNED') {
      run.state = 'LOADING';
      this.tms.markLoading(p.tripId);
    }
    const mfcName = MFCS.find((m) => m.id === roll.mfcId)?.name ?? roll.mfcId;
    a.pda = { title: '상차', step: `승강기 ${roll.lift} → ${run.dock.short}`, rows: [['차', `${run.plateNo} (${TEMP_KO[p.temp]})`], ['노선', `${p.region} · 출차 ${fmt(p.plannedDepartMin)}`], ['정차', `${this.stopSeq(run, roll.trfId) + 1}/${p.stops.length} ${mfcName}`], ['박스', `${roll.boxes.length}`]] };
    await this.go(a, this.b1.liftLanding(roll.lift), WORK.walk, `승강기 ${roll.lift} 착지로`);
    a.carrying = 'ROLL';
    a.cold = p.temp !== 'AMBIENT';
    await this.go(a, this.b1.dock(run.dock), WORK.cart, `${run.dock.short} 차로`);
    a.pda.step = `박스 ${roll.boxes.length}개 스캔 대조 (MFC·TRF·온도)`;
    await a.wait(roll.boxes.length * WORK.loadScan, '박스 스캔 대조 — MFC·TRF·온도 확인');
    a.pda.step = '차에 싣기 (방문 역순)';
    await a.wait(OUTBOUND.loadPerRoll, '차에 싣기 (방문 역순)');
    if (run.state !== 'LOADING') {
      this.log('warn', `${a.name}: ${run.plateNo} 이미 출차 — ${roll.boxes.length}박스 못 실음`);
    } else {
      await this.backend.reportLoadingResult(
        { trfId: roll.trfId, tripId: p.tripId, vehicleId: p.vehicleId, dockCode: run.dock.code, workerId: a.id, action: 'LOADED', lpns: roll.boxes.map((b) => ({ lpn: b.lpn, compartment: p.temp })) },
        newId('load'),
      );
      run.loaded.push(...roll.boxes);
      a.done += roll.boxes.length;
    }
    a.carrying = null;
    a.cold = false;
    a.pda = null;
  }

  // ── 화면 요약 ───────────────────────────────────────
  /** 지금 하루 단계(시간표 CDC-8) */
  phase(): string {
    const m = this.time / 60;
    const runs = [...this.runs.values()];
    if (m < 13 * 60) return '주간 · TRF 할당·선반 보충';
    if (m < OUTBOUND.lowerFrom) return '석간 · 피킹·분류·검품';
    if (m < OUTBOUND.loadFrom) return '하강 · R/T 카운팅·배차';
    if (!runs.some((r) => r.departedAt !== undefined)) return '지하 상차';
    if (runs.some((r) => r.state !== 'RETURNED' && r.state !== 'CANCELLED')) return '운송 · MFC 인계';
    return '마감 · 복귀';
  }

  /** 지금 줄 서 있는 일 — 오른쪽 숫자 모두 */
  queues() {
    const staged = [...this.staged.values()].flat();
    return {
      line: [...this.lineQueue.values()].reduce((s, q) => s + q.length, 0) + [...this.lineBuffer.values()].reduce((s, q) => s + q.length, 0),
      split: [...this.splitQueue.values()].reduce((s, q) => s + q.length, 0),
      jockey: [...this.jockeyQueue.values()].reduce((s, q) => s + q.length, 0),
      stagedWait: staged.filter((b) => b.state !== 'PASSED' && b.state !== 'MOVING').length,
      stagedPassed: staged.filter((b) => b.state === 'PASSED').length,
      atB1: this.atB1.length,
      carts: this.carts.size,
      lights: this.lights.length,
    };
  }

  /** 최근 1시간 피킹 개수 */
  pickedLastHour(): number {
    let n = 0;
    for (let i = this.pickLog.length - 1; i >= 0 && this.pickLog[i].at > this.time - 3600; i--) n += this.pickLog[i].qty;
    return n;
  }

  summary() {
    const tasks = this.backend.allTasks();
    const done = tasks.filter((t) => t.state === 'DONE' || t.state === 'PARTIAL').length;
    const trfs = this.backend.listTransfers();
    const sum = (f: (p: TransferProgress) => number) => trfs.reduce((s, t) => s + t.progress.reduce((a, p) => a + f(p), 0), 0);
    return {
      tasks: tasks.length,
      tasksDone: done,
      approved: sum((p) => p.approvedQty),
      picked: sum((p) => p.pickedQty),
      sorted: sum((p) => p.sortedQty),
      inspected: sum((p) => p.inspectedQty),
      loaded: sum((p) => p.loadedQty),
      departed: sum((p) => p.departedQty),
      received: this.backend.ledger.totals().acked,
      trips: this.runs.size,
      tripsDone: [...this.runs.values()].filter((r) => r.state === 'RETURNED').length,
      replNeeds: this.backend.replenishmentNeeds().length,
      busy: this.agents.filter((a) => !a.idle).length,
      waveId: this.day.waveId,
      released: this.day.released,
    };
  }
}

type TransferProgress = ReturnType<MockBackend['listTransfers']>[number]['progress'][number];
export type { FloorKey };
