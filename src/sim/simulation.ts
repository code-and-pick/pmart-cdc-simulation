// 칠곡 DC 하루 — 시계, 근무(주간조·석간), TRF 유입, Wave 배포, 작업자(지게차 보충·FC·분배/라인·자키).
// 근거: 설계 §5·§6, 알바몬 후기(석간 13~22시·휴식·FC 지역 바코드·분배·라인), 우아한청년들 하루 일정(08:00 입고·13:00 선별·23:00 출발).
// 백엔드와는 계약 API 로만 주고받는다 — 지금은 MockBackend(설계 §12 ⑧ 실서버 모드 전). 검품·상차·출발은 §12 ⑥.
// React·three 에 의존하지 않는다(시험이 화면 없이 하루를 돌린다).

import { CENTER_ID, MFCS, SHIFT, SIM_START, SUPPLY, WORK, WORKFORCE } from '../config';
import type { MockBackend } from '../backend/mock/MockBackend';
import type { Catalog } from '../domain/catalog';
import { ApiProblem, type Task, type TemperatureZone } from '../domain/contract';
import { stagingCodeFor, type Layout, type Location } from '../domain/layout';
import type { FloorNo } from '../domain/sites/chilgok';
import { newId, Rng } from '../util/rng';
import { Agent, ROLE_KO, type DutyClock, type Role, type Shift } from './agent';
import { FloorSite, type WalkPoint } from './site';
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
  stagingCode: string;
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

export class Simulation implements DutyClock {
  time = SIM_START;
  speed = 15;
  readonly agents: Agent[] = [];
  readonly sites = new Map<FloorNo, FloorSite>();
  readonly events: SimEvent[] = [];
  readonly sortQueue = new Map<FloorNo, SortJob[]>(FLOORS.map((f) => [f, []]));
  readonly jockeyQueue = new Map<FloorNo, JockeyJob[]>(FLOORS.map((f) => [f, []]));
  /** 출고대기 자리(91 코드) → 자키가 옮겨 둔 박스 수 (화면용) */
  readonly staged = new Map<string, { boxes: number; units: number }>();
  private readonly claimed = new Set<string>();
  private readonly locs = new Map<string, Location>();
  private readonly rng: Rng;
  private day = { intake: false, creating: false, waveId: '', released: false, lastTry: 0, warned: false };

  constructor(
    readonly layout: Layout,
    readonly catalog: Catalog,
    readonly backend: MockBackend,
    private readonly opt: SimOptions,
  ) {
    this.rng = new Rng(opt.seed ?? 20261125);
    for (const f of layout.floors) {
      this.sites.set(f.floor, new FloorSite(f, layout));
      for (const l of [...f.locations, ...f.shelves, ...f.staging]) this.locs.set(l.code, l);
    }
    backend.onEvent((e) => this.log('flow', `${e.type} · ${e.summary}`));
    for (const fl of FLOORS) this.hire(fl);
    for (const a of this.agents) void this.run(a);
  }

  // ── 근무 ───────────────────────────────────────────
  private window(a: Agent) {
    return a.shift === 'DAY' ? SHIFT.day : SHIFT.evening;
  }
  onDuty(a: Agent): boolean {
    const m = this.time / 60;
    const w = this.window(a);
    if (m < w.start || m >= w.end) return false;
    const breaks = a.shift === 'DAY' ? [LUNCH_DAY] : SHIFT.breaks;
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
    const site = this.sites.get(fl)!;
    const home = site.home();
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
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // ── 하루 흐름 (replenishment·운영자 역할) ─────────────────
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
  }

  // ── 사람 ───────────────────────────────────────────
  private async run(a: Agent) {
    for (;;) {
      try {
        await a.untilDuty();
        if (a.role === 'REPL') await this.replenishOnce(a);
        else if (a.role === 'FC') await this.pickOnce(a);
        else if (a.role === 'SORT') await this.sortOnce(a);
        else await this.jockeyOnce(a);
      } catch (e) {
        const msg = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}` : e instanceof Error ? e.message : String(e);
        this.log('warn', `${a.name}: ${msg}`);
        a.carrying = null;
        await a.wait(10, '오류 — 잠시 대기');
      }
    }
  }

  private async go(a: Agent, to: WalkPoint, speed: number, activity: string) {
    const site = this.sites.get(a.floor)!;
    await a.walk(to, site.route(a.at, to), speed, activity);
  }

  private loc(code: string): Location {
    const l = this.locs.get(code);
    if (!l) throw new Error(`위치 없음 ${code}`);
    return l;
  }

  /** 지게차 보충 — 팔레트 랙에 잡힌 Wave 수요를 선반으로(CDC-F-013) */
  private async replenishOnce(a: Agent) {
    const site = this.sites.get(a.floor)!;
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
    const site = this.sites.get(a.floor)!;
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
    this.sortQueue.get(a.floor)!.push({ taskId: task.taskId, trfId: task.trfId, waveId: task.waveId, mfcId: trf.mfcId });
    a.carrying = null;
    a.done += 1;
    a.pda = null;
  }

  /** 분배·라인 — 카트 상품 스캔 → MFC 칸(롤테이너)에 불·숫자대로 담기 → 분류 결과(BOX SEALED) [현장 분배·라인, 설계 §5.3] */
  private async sortOnce(a: Agent) {
    const site = this.sites.get(a.floor)!;
    const q = this.sortQueue.get(a.floor)!;
    const job = q.shift();
    const st = site.station();
    const slot = Number(a.id.slice(-2));
    const spot: WalkPoint = { ...st, x: st.x + (slot - 1.5) * 2 };
    if (!job) {
      if (a.at.x !== spot.x || a.at.z !== spot.z) await this.go(a, spot, WORK.walk, '분류대로');
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '카트 대기');
      return;
    }
    if (a.at.x !== spot.x || a.at.z !== spot.z) await this.go(a, spot, WORK.walk, '분류대로');
    const task = await this.backend.getTask(job.taskId);
    const contents = task.lines.filter((l) => l.pickedQty > 0).map((l) => ({ sku: l.sku, lot: l.lot, qty: l.pickedQty }));
    const units = contents.reduce((s, c) => s + c.qty, 0);
    const mfc = MFCS.find((m) => m.id === job.mfcId);
    a.pda = { title: '분배·라인', step: '상품 스캔 → 불·숫자대로 담기', rows: [['카트', job.taskId], ['MFC 칸', `PPC-${String(mfc?.staging ?? 0).padStart(2, '0')} ${mfc?.name ?? ''}`], ['수량', `${units}`]] };
    await a.wait(WORK.sortStart + units * WORK.sortPerUnit, '상품 스캔 → MFC 칸에 담기');
    if (units > 0) {
      const lpn = `BOX-${job.taskId}`;
      const temp: TemperatureZone = this.catalog.bySku.get(contents[0].sku)?.temp ?? 'AMBIENT';
      await this.backend.reportSortingResult(
        { waveId: job.waveId, trfId: job.trfId, workerId: a.id, lpns: [{ lpn, unitType: 'BOX', state: 'SEALED', temperatureZone: temp, contents }] },
        newId('sort'),
      );
      this.jockeyQueue.get(a.floor)!.push({ trfId: job.trfId, mfcId: job.mfcId, lpn, units, stagingCode: stagingCodeFor(task.lines[0].locationCode, mfc?.staging ?? 1) });
    }
    a.done += 1;
    a.pda = null;
  }

  /** 자키 — 다 찬 롤테이너를 출고대기(91 MFC 자리)로, 저온은 보냉 커버 [현장] */
  private async jockeyOnce(a: Agent) {
    const site = this.sites.get(a.floor)!;
    const q = this.jockeyQueue.get(a.floor)!;
    if (!q.length) {
      a.pda = null;
      await a.wait(WORK.idlePoll / 3, '롤테이너 대기');
      return;
    }
    const code = q[0].stagingCode;
    const batch: JockeyJob[] = [];
    for (let i = 0; i < q.length && batch.length < WORK.jockeyBatch; ) {
      if (q[i].stagingCode === code) batch.push(...q.splice(i, 1));
      else i++;
    }
    const dest = this.loc(code);
    const units = batch.reduce((s, b) => s + b.units, 0);
    a.pda = { title: '자키', step: '롤테이너 싣기', rows: [['박스', `${batch.length}`], ['출고대기', dest.short], ['MFC', MFCS.find((m) => m.id === batch[0].mfcId)?.name ?? '']] };
    await this.go(a, site.station(), WORK.walk, '분류대로');
    await a.wait(WORK.jockeyHandle, '롤테이너 싣기');
    a.carrying = 'ROLL';
    a.pda.step = `${dest.short} 로 밀고 가기`;
    await this.go(a, site.front(dest), WORK.cart, `출고대기로 (${dest.short})`);
    await a.wait(WORK.jockeyHandle, dest.temp === 'AMBIENT' ? '출고대기에 내려놓기' : '출고대기에 내려놓기 · 보냉 커버');
    const cur = this.staged.get(code) ?? { boxes: 0, units: 0 };
    this.staged.set(code, { boxes: cur.boxes + batch.length, units: cur.units + units });
    a.carrying = null;
    a.done += batch.length;
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
      replNeeds: this.backend.replenishmentNeeds().length,
      busy: this.agents.filter((a) => !a.idle).length,
      waveId: this.day.waveId,
      released: this.day.released,
    };
  }
}

type TransferProgress = ReturnType<MockBackend['listTransfers']>[number]['progress'][number];
