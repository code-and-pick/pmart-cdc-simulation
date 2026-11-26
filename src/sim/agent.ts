// 현장 사람 하나(FC 피커·분배/라인·자키·지게차 보충). 움직임은 시뮬레이션 시계로만 흐른다.
// 할 일은 async 함수(simulation.ts 의 역할별 루프)가 walk/wait/untilDuty 를 차례로 기다리며 진행한다.
// 수량·상태 변화는 계약 API 응답으로만 확정한다 — 화면 표시는 응답을 받은 뒤 바꾼다(MFC 시뮬레이터 worker.ts 와 같은 원칙).

import type { FloorKey } from '../domain/sites/chilgok';
import type { P, WalkPoint } from './site';

export type Role = 'FC' | 'SORT' | 'JOCKEY' | 'REPL' | 'INSPECT' | 'LOADER' | 'DPS' | 'INBOUND';
/** DAY 주간조 08~17 · EVENING 석간 13~22 · NIGHT 도크 상차·야간 자키 [가정] */
export type Shift = 'DAY' | 'EVENING' | 'NIGHT';

export const ROLE_KO: Record<Role, string> = { FC: 'FC 피커', SORT: 'DAS·분배', JOCKEY: '자키', REPL: '지게차 보충', INSPECT: '검품', LOADER: '상차', DPS: 'DPS 구역', INBOUND: '입고 검수' };

/** PDA 화면 — 작업자가 손에 든 단말에 보이는 것 */
export interface PdaView {
  title: string;
  /** 지금 하는 일 한 줄 */
  step: string;
  rows: [string, string][];
  /** FC: 이번 작업 줄 */
  basket?: { name: string; loc: string; planned: number; picked: number; state: 'TODO' | 'NOW' | 'DONE' | 'SHORT' }[];
}

export interface DutyClock {
  onDuty(a: Agent): boolean;
  dutyLabel(a: Agent): string;
  /** 시뮬레이션 시각(초) — 작업 기록 시각 */
  now?(): number;
}

/** 작업 기록 한 줄 — 하는 일이 바뀐 시각·그때 자리(사용자 2026-11-26 "작업자를 누르면 흐름·실시간으로 어디서 뭘 하는지") */
export interface ActivityRec {
  at: number;
  text: string;
  x: number;
  z: number;
}
/** 작업자마다 남기는 기록 수 */
const HISTORY_MAX = 60;

/** 일 없이 기다리는 중인지 — "작업 대기"·"DPS 박스 기다림" 등(좁은 통로에서 앞사람을 기다리는 것은 일하는 중으로 본다) */
export function idleActivity(activity: string): boolean {
  return activity.endsWith('대기') || (activity.endsWith('기다림') && !activity.includes('앞사람'));
}

export class Agent {
  pos: P;
  at: WalkPoint;
  heading = 0;
  /** 대기 자리(근무 밖일 때 돌아감) — 승강기 옆 */
  home: WalkPoint | null = null;
  /** 가상 작업자 인원을 줄이면 지금 일을 마치고 빠진다(설정 → 가상 작업자) */
  retired = false;
  path: P[] = [];
  speed = 1;
  distance = 0;
  busySeconds = 0;
  done = 0;
  /** 가동률 계산(사용자 2026-11-25 "작업자별 UPH·유휴율") — 근무 중 시간 · 그중 일 없이 기다린 시간 · 처리 유닛(피킹·라인 담기) */
  onDutySeconds = 0;
  idleSeconds = 0;
  units = 0;
  private _activity = '근무 전';
  /** 하는 일이 바뀐 기록(최근 HISTORY_MAX 개) */
  readonly history: ActivityRec[] = [];
  get activity(): string {
    return this._activity;
  }
  set activity(v: string) {
    if (v === this._activity) return;
    this._activity = v;
    this.history.push({ at: this.clock.now?.() ?? 0, text: v, x: this.pos.x, z: this.pos.z });
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }
  carrying: 'CART' | 'PALLET' | 'ROLL' | null = null;
  /** 지게차를 세워 두고 걸어서 선반에 갔을 때 — 지게차 자리 [사용자 2026-11-25 "지게차는 선반 입구까지만"] */
  parked: { x: number; z: number; heading: number } | null = null;
  /** 실은 짐이 보냉 커버(저온)인지 — 화면 색 */
  cold = false;
  pda: PdaView | null = null;
  private mode: 'walk' | 'wait' | 'duty' | null = null;
  private waitLeft = 0;
  private resolve: (() => void) | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly role: Role,
    readonly floor: FloorKey,
    readonly shift: Shift,
    start: WalkPoint,
    private readonly clock: DutyClock,
  ) {
    this.pos = { x: start.x, z: start.z };
    this.at = start;
  }

  get idle(): boolean {
    return this.mode === 'duty' || this.mode === null || idleActivity(this.activity);
  }

  /** 근무 중 가동률(0~1) — 일 없이 기다린 시간을 뺀 몫 */
  get utilization(): number {
    return this.onDutySeconds > 0 ? 1 - this.idleSeconds / this.onDutySeconds : 0;
  }

  /** 근무 시간당 처리 유닛(UPH) */
  get uph(): number {
    return this.onDutySeconds > 60 ? this.units / (this.onDutySeconds / 3600) : 0;
  }

  /** 걸어서(또는 카트·지게차로) 간다. path = route 결과 */
  walk(to: WalkPoint, path: P[], speed: number, activity?: string): Promise<void> {
    if (activity) this.activity = activity;
    this.path = path.map((p) => ({ ...p }));
    this.speed = speed;
    this.at = to;
    return this.begin('walk');
  }

  wait(sec: number, activity: string): Promise<void> {
    this.activity = activity;
    this.waitLeft = sec;
    return this.begin('wait');
  }

  /** 근무 시간·휴식 밖이면 들어올 때까지 기다린다 */
  untilDuty(): Promise<void> {
    if (this.clock.onDuty(this)) return Promise.resolve();
    this.activity = this.clock.dutyLabel(this);
    return this.begin('duty');
  }

  private begin(mode: 'walk' | 'wait' | 'duty'): Promise<void> {
    this.mode = mode;
    return new Promise((r) => {
      this.resolve = r;
    });
  }

  private finish() {
    this.mode = null;
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  tick(dt: number) {
    if (this.mode === 'walk' || this.mode === 'wait') this.onDutySeconds += dt;
    if (this.mode === 'wait' && idleActivity(this.activity)) this.idleSeconds += dt;
    if (this.mode === 'walk') {
      this.busySeconds += dt;
      let move = this.speed * dt;
      while (move > 0 && this.path.length) {
        const t = this.path[0];
        const dx = t.x - this.pos.x;
        const dz = t.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-6) this.heading = Math.atan2(dx, dz);
        if (d <= move) {
          this.pos = { x: t.x, z: t.z };
          this.path.shift();
          this.distance += d;
          move -= d;
        } else {
          this.pos = { x: this.pos.x + (dx / d) * move, z: this.pos.z + (dz / d) * move };
          this.distance += move;
          move = 0;
        }
      }
      if (!this.path.length) this.finish();
    } else if (this.mode === 'wait') {
      if (!idleActivity(this.activity)) this.busySeconds += dt;
      this.waitLeft -= dt;
      if (this.waitLeft <= 0) this.finish();
    } else if (this.mode === 'duty') {
      if (this.clock.onDuty(this)) this.finish();
      else this.activity = this.clock.dutyLabel(this);
    }
  }
}
