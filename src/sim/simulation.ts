// 칠곡 DC 하루 — 시계, 근무(주간조·석간·지하 상차), TRF 유입, Wave 배포, 작업자,
// 검품 → 승강기 하강 → 지하 상차 → 23:00 출발 검증(TOUT: CDC −q · Transit +q).
// 근거: 설계 §5·§6·§12, 알바몬 후기(석간 13~22시·휴식·FC 지역 바코드·분배·라인·21시~ 하강·보냉 커버),
//       우아한청년들 하루 일정(08:00 입고·13:00 선별·23:00 출발), WMS CDC-F-019~022(1요청·1이관·1출발).
// 백엔드와는 계약 API 로만 주고받는다 — 지금은 MockBackend(설계 §12 ⑧ 실서버 모드 전).
// 차량은 §12 ⑦ TMS 전까지 MFC 마다 한 대를 상온 접안에 둔다 [시뮬]. 출발 검증은 TMS 역할로 시뮬레이터가 부른다.
// React·three 에 의존하지 않는다(시험이 화면 없이 하루를 돌린다).

import { CENTER_ID, MFCS, OUTBOUND, SHIFT, SIM_START, SUPPLY, WORK, WORKFORCE } from '../config';
// 시간표 근거: 정본 CDC-8(PR #447) — 21:30 WMS 완료 · 22:00 R/T 카운팅 · 22:30 상차 · 23:00~ 출차
import type { MockBackend } from '../backend/mock/MockBackend';
import type { Catalog } from '../domain/catalog';
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

interface SortJob {
  taskId: string;
  trfId: string;
  waveId: string;
  mfcId: string;
}

interface JockeyJob {
  trfId: string;
  mfcId: string;
  lpn: string;
  units: number;
  temp: TemperatureZone;
  stagingCode: string;
}

/** 출고대기·하강·상차를 따라가는 박스(LPN) — 수량은 서버 분류 결과 그대로 */
export interface StagedBox {
  lpn: string;
  trfId: string;
  mfcId: string;
  units: number;
  temp: TemperatureZone;
  state: 'WAIT' | 'CHECK' | 'PASSED' | 'FAILED' | 'MOVING';
}

/** 지하 상차 마당에 내려온 롤테이너 */
interface RollAtB1 {
  boxes: StagedBox[];
  mfcId: string;
  lift: number;
}

/** MFC 행 차 한 대 [시뮬 — §12 ⑦ TMS 전 자리표시] */
export interface Truck {
  mfcId: string;
  vehicleId: string;
  tripId: string;
  dock: Location;
  loaded: StagedBox[];
  state: 'DOCKED' | 'DEPARTED';
  departureId?: string;
  result?: string;
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
const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };

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
  readonly sortQueue = new Map<FloorNo, SortJob[]>(FLOORS.map((f) => [f, []]));
  readonly jockeyQueue = new Map<FloorNo, JockeyJob[]>(FLOORS.map((f) => [f, []]));
  /** 출고대기 자리(91 코드) → 그 자리에 놓인 박스 */
  readonly staged = new Map<string, StagedBox[]>();
  /** 지하 상차 마당에 내려와 실을 차례를 기다리는 롤테이너 */
  readonly atB1: RollAtB1[] = [];
  readonly trucks = new Map<string, Truck>();
  private readonly claimed = new Set<string>();
  /** 지금 싣고 있는 R/T 수(MFC 별) — 다 싣기 전에 출차하지 않게 */
  private readonly loading = new Map<string, number>();
  private readonly locs = new Map<string, Location>();
  private readonly rng: Rng;
  private day = { intake: false, creating: false, waveId: '', released: false, lastTry: 0, warned: false, rtCounted: false, lastDepartCheck: 0 };

  constructor(
    readonly layout: Layout,
    readonly catalog: Catalog,
    readonly backend: MockBackend,
    private readonly opt: SimOptions,
  ) {
    this.rng = new Rng(opt.seed ?? 20261125);
    this.b1 = new B1Site(layout);
    for (const f of layout.floors) {
      this.sites.set(f.floor, new FloorSite(f, layout));
      for (const l of [...f.locations, ...f.shelves, ...f.staging]) this.locs.set(l.code, l);
    }
    backend.onEvent((e) => this.log('flow', `${e.type} · ${e.summary}`));
    for (const fl of FLOORS) this.hire(fl);
    for (let i = 1; i <= OUTBOUND.loaders; i++) {
      const no = String(i).padStart(2, '0');
      const home = this.b1.home();
      this.agents.push(new Agent(`loader-b1-${no}`, `${ROLE_KO.LOADER} B1-${no}`, 'LOADER', 'B1', 'NIGHT', { ...home, x: home.x + i * 0.6 }, this));
    }
    this.dockTrucks();
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

  /** MFC 마다 차 한 대 — 상온 접안(C) 문에 차례로 [시뮬] */
  private dockTrucks() {
    const docks = this.layout.docks.filter((d) => d.zone === 'C');
    const day = this.opt.baseDate.replace(/-/g, '').slice(2);
    for (const m of MFCS) {
      const short = m.id.replace(/^MFC-/, '').replace(/-01$/, '');
      this.trucks.set(m.id, { mfcId: m.id, vehicleId: `VH-${short}`, tripId: `TRIP-${day}-${short}`, dock: docks[(m.staging - 1) % docks.length], loaded: [], state: 'DOCKED' });
    }
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
      for (const t of this.trucks.values()) {
        const boxes = [...[...this.staged.values()].flat(), ...this.atB1.flatMap((r) => r.boxes), ...t.loaded].filter((b) => b.mfcId === t.mfcId);
        const byTemp = new Map<TemperatureZone, number>();
        for (const b of boxes) byTemp.set(b.temp, (byTemp.get(b.temp) ?? 0) + 1);
        const rt = [...byTemp.entries()].map(([k, n]) => `${TEMP_KO[k]} ${Math.ceil(n / OUTBOUND.boxesPerRt)}`).join(' · ');
        this.log('flow', `22:00 R/T 카운팅 ${MFCS.find((x) => x.id === t.mfcId)?.name}: 박스 ${boxes.length} → R/T ${rt || '없음'}`);
      }
    }
    if (m >= SHIFT.departure && this.time - this.day.lastDepartCheck >= 30) {
      // 23:00~ 출차 — 그 MFC R/T 를 다 실은 차부터, 늦어도 departLatest 엔 실은 것만으로 [CDC-8]
      this.day.lastDepartCheck = this.time;
      for (const t of this.trucks.values()) if (t.state === 'DOCKED' && (m >= OUTBOUND.departLatest || this.allLoaded(t.mfcId))) this.depart(t);
    }
  }

  /** 그 MFC 몫이 모두 차에 실렸는지 — 피킹·분류·출고대기·하강·지하 마당에 남은 것 없음 */
  private allLoaded(mfcId: string): boolean {
    const trf = this.backend.listTransfers().find((x) => x.mfcId === mfcId && x.state !== 'CANCELLED');
    if (!trf || !this.day.released) return false;
    if (this.backend.allTasks().some((t) => t.trfId === trf.trfId && !TERMINAL.includes(t.state))) return false;
    for (const q of this.sortQueue.values()) if (q.some((j) => j.mfcId === mfcId)) return false;
    for (const q of this.jockeyQueue.values()) if (q.some((j) => j.mfcId === mfcId)) return false;
    if ([...this.staged.values()].flat().some((b) => b.mfcId === mfcId)) return false;
    if (this.atB1.some((r) => r.mfcId === mfcId)) return false;
    return this.trucks.get(mfcId)!.loaded.length > 0 && !this.loading.has(mfcId);
  }

  /**
   * 출차 — TMS 실제 출발 사실을 cdc-outbound 출발 검증으로(TruckActuallyDeparted 소비 흉내, source SIMULATED). 이때만 TOUT.
   * 실린 LPN 만 출발한다. 못 실은 것은 두 번째 차로 보내지 않는다(1요청·1이관·1출발) → 잔량 정리.
   */
  private depart(t: Truck) {
    {
      const trf = this.backend.listTransfers().find((x) => x.mfcId === t.mfcId && x.state !== 'CANCELLED');
      if (!trf) return;
      if (!t.loaded.length) {
        t.state = 'DEPARTED';
        t.result = 'EMPTY';
        this.log('warn', `${hm(this.time)} ${t.vehicleId} 빈 차 — ${trf.trfId} 출발 없음`);
        return;
      }
      const departureId = `DEP-${t.tripId}`;
      try {
        const v = this.backend.validateDeparture(
          {
            departureId,
            tripId: t.tripId,
            vehicleId: t.vehicleId,
            departedAt: new Date(Date.parse(`${this.opt.baseDate}T00:00:00+09:00`) + this.time * 1000).toISOString(),
            source: 'SIMULATED',
            trfCompositions: [{ trfId: trf.trfId, mfcId: t.mfcId, lpns: t.loaded.map((b) => b.lpn) }],
          },
          newId('departure'),
        );
        t.state = 'DEPARTED';
        t.departureId = departureId;
        t.result = v.overallResult;
        const q = v.transfers.reduce((s, x) => s + x.departedQty, 0);
        this.log(v.overallResult === 'MATCHED' ? 'flow' : 'warn', `${hm(this.time)} ${t.vehicleId} 출발 → ${MFCS.find((m) => m.id === t.mfcId)?.name} · ${v.overallResult} · ${q.toLocaleString()}개 (CDC −${q} · Transit +${q})`);
      } catch (e) {
        this.log('warn', `출발 검증 실패 ${t.vehicleId}: ${e instanceof ApiProblem ? e.problem.code : e instanceof Error ? e.message : e}`);
      }
    }
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
    await a.walk(to, this.siteOf(a).route(a.at, to), speed, activity);
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
      await this.go(a, site.front(to), WORK.forklift, `선반으로 (${to.short})`);
      const now = this.backend.replenishmentNeeds().find((n) => `${n.sku}|${n.lot}|${n.from}` === k);
      const qty = now?.qty ?? 0;
      a.pda.step = '박스 뜯어 진열';
      await a.wait(WORK.replShelf + qty * WORK.replPerUnit, '박스 뜯어 진열');
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
  private async pickOnce(a: Agent) {
    const site = this.floorSite(a);
    let task: Task;
    try {
      ({ task } = await this.backend.pullNextTask(CENTER_ID, a.id, { kind: 'PICK', floor: String(a.floor) }, newId('next')));
    } catch (e) {
      if (e instanceof ApiProblem && e.problem.code === 'NO_TASK_AVAILABLE') {
        a.pda = { title: 'FC 피킹', step: '받을 작업 없음', rows: [] };
        await a.wait(WORK.idlePoll, '작업 대기');
        return;
      }
      throw e;
    }
    if (task.state === 'ACCEPTED') task = await this.backend.startTask(task.taskId, a.id, newId('start'), task.version);
    const trf = await this.backend.getTransferIntake(task.trfId);
    const mfc = MFCS.find((m) => m.id === trf.mfcId);
    const basket = task.lines.map((l) => ({
      name: this.catalog.bySku.get(l.sku)?.name ?? l.sku,
      loc: this.locs.get(l.locationCode)?.short ?? l.locationCode,
      planned: l.plannedQty,
      picked: l.pickedQty,
      state: (l.pickedQty + l.shortQty >= l.plannedQty ? 'DONE' : 'TODO') as 'TODO' | 'NOW' | 'DONE' | 'SHORT',
    }));
    a.carrying = 'CART';
    a.pda = {
      title: 'FC 피킹',
      step: '지역 바코드 스캔',
      rows: [
        ['작업', task.taskId],
        ['지역', `${mfc?.region ?? ''} (${mfc?.name ?? trf.mfcId})`],
        ['TRF', task.trfId],
        ['진행', `0/${task.lines.length}`],
      ],
      basket,
    };
    for (let i = 0; i < task.lines.length; i++) {
      const l = task.lines[i];
      const remaining = l.plannedQty - l.pickedQty - l.shortQty;
      if (remaining <= 0) continue;
      const loc = this.loc(l.locationCode);
      basket[i].state = 'NOW';
      a.pda.step = `${loc.short} 로 이동`;
      await this.go(a, site.front(loc), WORK.cart, `선반으로 (${loc.short})`);
      const short = this.rng.next() < WORK.shortRate ? Math.min(remaining, 1 + Math.floor(this.rng.next() * 3)) : 0;
      const take = remaining - short;
      a.pda.step = `${basket[i].name} ${take}개 담기`;
      await a.wait(WORK.pickScan + take * WORK.pickPerUnit, '지역 바코드·상품 스캔 → 담기');
      await this.backend.reportPickResult(
        task.taskId,
        { workerId: a.id, lines: [{ sku: l.sku, lot: l.lot, locationCode: l.locationCode, pickedQty: take, ...(short ? { shortQty: short, shortReason: 'NOT_FOUND' as const } : {}) }] },
        newId('pick'),
      );
      basket[i].picked += take;
      basket[i].state = short ? 'SHORT' : 'DONE';
      if (short) this.log('warn', `${a.name} 결품 보고 ${loc.short} ${basket[i].name} ${short}개`);
      a.pda.rows[3] = ['진행', `${basket.filter((b) => b.state === 'DONE' || b.state === 'SHORT').length}/${task.lines.length}`];
    }
    a.pda.step = '분류대로 카트 가져가기';
    await this.go(a, site.station(), WORK.cart, '분류대로');
    await a.wait(WORK.cartDrop, '분류대에 카트 내려놓기');
    this.sortQueue.get(a.floor as FloorNo)!.push({ taskId: task.taskId, trfId: task.trfId, waveId: task.waveId, mfcId: trf.mfcId });
    a.carrying = null;
    a.done += 1;
    a.pda = null;
  }

  /** 분배·라인 — 카트 상품 스캔 → MFC 칸(롤테이너)에 불·숫자대로 담기 → 분류 결과(BOX SEALED) [현장 분배·라인, 설계 §5.3] */
  private async sortOnce(a: Agent) {
    const site = this.floorSite(a);
    const q = this.sortQueue.get(a.floor as FloorNo)!;
    const job = q.shift();
    const st = site.station();
    const slot = Number(a.id.slice(-2));
    const spot: WalkPoint = { ...st, x: st.x + (slot - 1.5) * 2 };
    if (a.at.x !== spot.x || a.at.z !== spot.z) await this.go(a, spot, WORK.walk, '분류대로');
    if (!job) {
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '카트 대기');
      return;
    }
    const task = await this.backend.getTask(job.taskId);
    const contents = task.lines.filter((l) => l.pickedQty > 0).map((l) => ({ sku: l.sku, lot: l.lot, qty: l.pickedQty }));
    const units = contents.reduce((s, c) => s + c.qty, 0);
    const mfc = MFCS.find((m) => m.id === job.mfcId);
    a.pda = { title: '분배·라인', step: '상품 스캔 → 불·숫자대로 담기', rows: [['카트', job.taskId], ['MFC 칸', `PPC-${String(mfc?.staging ?? 0).padStart(2, '0')} ${mfc?.name ?? ''}`], ['수량', `${units}`]] };
    await a.wait(WORK.sortStart + units * WORK.sortPerUnit, '상품 스캔 → MFC 칸에 담기');
    if (units > 0) {
      // 박스 하나에 OUTBOUND.boxMaxUnits 개까지 — 넘으면 나눈다(LPN 은 박스마다, 한 LPN = 한 TRF)
      const temp: TemperatureZone = this.catalog.bySku.get(contents[0].sku)?.temp ?? 'AMBIENT';
      const boxes: { sku: string; lot: string; qty: number }[][] = [[]];
      let room: number = OUTBOUND.boxMaxUnits;
      for (const c of contents) {
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
      const lpns = boxes.map((cs, i) => ({ lpn: `BOX-${job.taskId}-${i + 1}`, unitType: 'BOX' as const, state: 'SEALED' as const, temperatureZone: temp, contents: cs }));
      await this.backend.reportSortingResult({ waveId: job.waveId, trfId: job.trfId, workerId: a.id, lpns }, newId('sort'));
      const stagingCode = stagingCodeFor(task.lines[0].locationCode, mfc?.staging ?? 1);
      for (const l of lpns) this.jockeyQueue.get(a.floor as FloorNo)!.push({ trfId: job.trfId, mfcId: job.mfcId, lpn: l.lpn, units: l.contents.reduce((x, c) => x + c.qty, 0), temp, stagingCode });
    }
    a.done += 1;
    a.pda = null;
  }

  /** 이 층에서 그 MFC 몫 일이 다 끝났는지 — 피킹·분류·출고대기 옮기기·검품 */
  private floorDoneFor(floor: FloorNo, trfId: string, code: string): boolean {
    const tasks = this.backend.allTasks().filter((t) => t.trfId === trfId && t.lines[0]?.locationCode.split('-')[2] === String(floor));
    if (!this.day.released || tasks.some((t) => !TERMINAL.includes(t.state))) return false;
    if (this.sortQueue.get(floor)!.some((j) => j.trfId === trfId)) return false;
    if (this.jockeyQueue.get(floor)!.some((j) => j.stagingCode === code)) return false;
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
    if (q.length) {
      const code = q[0].stagingCode;
      const batch: JockeyJob[] = [];
      for (let i = 0; i < q.length && batch.length < OUTBOUND.boxesPerRt; ) {
        if (q[i].stagingCode === code) batch.push(...q.splice(i, 1));
        else i++;
      }
      const dest = this.loc(code);
      const units = batch.reduce((s, b) => s + b.units, 0);
      a.pda = { title: '자키', step: '롤테이너 싣기', rows: [['박스', `${batch.length}`], ['출고대기', dest.short], ['MFC', MFCS.find((m) => m.id === batch[0].mfcId)?.name ?? '']] };
      await this.go(a, site.station(), WORK.walk, '분류대로');
      await a.wait(WORK.jockeyHandle, '롤테이너 싣기');
      a.carrying = 'ROLL';
      a.cold = dest.temp !== 'AMBIENT';
      a.pda.step = `${dest.short} 로 밀고 가기`;
      await this.go(a, site.front(dest), WORK.cart, `출고대기로 (${dest.short})`);
      await a.wait(WORK.jockeyHandle, dest.temp === 'AMBIENT' ? '출고대기에 내려놓기' : '출고대기에 내려놓기 · 보냉 커버');
      const arr = this.staged.get(code) ?? [];
      arr.push(...batch.map((b) => ({ lpn: b.lpn, trfId: b.trfId, mfcId: b.mfcId, units: b.units, temp: b.temp, state: 'WAIT' as const })));
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
    const boxes = arr.filter((b) => b.state === 'PASSED').slice(0, OUTBOUND.boxesPerRt);
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
    this.atB1.push({ boxes, mfcId: boxes[0].mfcId, lift });
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

  /** 지하 상차 — 승강기로 내려온 롤테이너를 그 MFC 차에 싣고 LOADED 등록(LOADED ≠ 출발, 수량 전기 없음) */
  private async loadOnce(a: Agent) {
    if (this.time / 60 < OUTBOUND.loadFrom) {
      a.pda = null;
      await a.wait(Math.max(5, OUTBOUND.loadFrom * 60 - this.time), '상차 대기 (22:30 시작)');
      return;
    }
    const roll = this.atB1.shift();
    if (!roll) {
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '롤테이너 대기');
      return;
    }
    const truck = this.trucks.get(roll.mfcId)!;
    const trfId = roll.boxes[0].trfId;
    if (truck.state !== 'DOCKED') {
      this.log('warn', `${a.name}: ${truck.vehicleId} 이미 출발 — ${roll.boxes.length}박스 못 실음`);
      return;
    }
    this.loading.set(roll.mfcId, (this.loading.get(roll.mfcId) ?? 0) + 1);
    try {
      await this.loadRoll(a, roll, truck, trfId);
    } finally {
      const n = (this.loading.get(roll.mfcId) ?? 1) - 1;
      if (n > 0) this.loading.set(roll.mfcId, n);
      else this.loading.delete(roll.mfcId);
    }
  }

  private async loadRoll(a: Agent, roll: RollAtB1, truck: Truck, trfId: string) {
    a.pda = { title: '상차', step: `승강기 ${roll.lift} → ${truck.dock.short}`, rows: [['차', truck.vehicleId], ['운행', truck.tripId], ['박스', `${roll.boxes.length}`]] };
    await this.go(a, this.b1.liftLanding(roll.lift), WORK.walk, `승강기 ${roll.lift} 착지로`);
    a.carrying = 'ROLL';
    a.cold = roll.boxes.some((b) => b.temp !== 'AMBIENT');
    await this.go(a, this.b1.dock(truck.dock), WORK.cart, `${truck.dock.short} 차로`);
    await a.wait(OUTBOUND.loadPerRoll, '차에 싣기');
    if (truck.state !== 'DOCKED') {
      this.log('warn', `${a.name}: ${truck.vehicleId} 이미 출발 — ${roll.boxes.length}박스 못 실음`);
    } else {
      await this.backend.reportLoadingResult(
        {
          trfId,
          tripId: truck.tripId,
          vehicleId: truck.vehicleId,
          dockCode: truck.dock.code,
          workerId: a.id,
          action: 'LOADED',
          lpns: roll.boxes.map((b) => ({ lpn: b.lpn, compartment: b.temp })),
        },
        newId('load'),
      );
      truck.loaded.push(...roll.boxes);
      a.done += roll.boxes.length;
    }
    a.carrying = null;
    a.cold = false;
    a.pda = null;
  }

  // ── 화면 요약 ───────────────────────────────────────
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
      replNeeds: this.backend.replenishmentNeeds().length,
      busy: this.agents.filter((a) => !a.idle).length,
      waveId: this.day.waveId,
      released: this.day.released,
    };
  }
}

type TransferProgress = ReturnType<MockBackend['listTransfers']>[number]['progress'][number];
export type { FloorKey };
