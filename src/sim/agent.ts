// 현장 사람 하나(FC 피커·분배/라인·자키·지게차 보충). 움직임은 시뮬레이션 시계로만 흐른다.
// 할 일은 async 함수(simulation.ts 의 역할별 루프)가 walk/wait/untilDuty 를 차례로 기다리며 진행한다.
// 수량·상태 변화는 계약 API 응답으로만 확정한다 — 화면 표시는 응답을 받은 뒤 바꾼다(MFC 시뮬레이터 worker.ts 와 같은 원칙).

import type { FloorKey } from '../domain/sites/chilgok';
import type { P, WalkPoint } from './site';

export type Role = 'FC' | 'SORT' | 'JOCKEY' | 'REPL' | 'INSPECT' | 'LOADER' | 'DPS';
/** DAY 주간조 08~17 · EVENING 석간 13~22 · NIGHT 지하 상차 19~23 [가정] */
export type Shift = 'DAY' | 'EVENING' | 'NIGHT';

export const ROLE_KO: Record<Role, string> = { FC: 'FC 피커', SORT: 'DAS·분배', JOCKEY: '자키', REPL: '지게차 보충', INSPECT: '검품', LOADER: '상차', DPS: 'DPS 구역' };

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
}

export class Agent {
  pos: P;
  at: WalkPoint;
  heading = 0;
  /** 가상 작업자 인원을 줄이면 지금 일을 마치고 빠진다(설정 → 가상 작업자) */
  retired = false;
  path: P[] = [];
  speed = 1;
  distance = 0;
  busySeconds = 0;
  done = 0;
  activity = '근무 전';
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
    return this.mode === 'duty' || this.activity.endsWith('대기') || this.mode === null;
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
      if (!this.activity.endsWith('대기')) this.busySeconds += dt;
      this.waitLeft -= dt;
      if (this.waitLeft <= 0) this.finish();
    } else if (this.mode === 'duty') {
      if (this.clock.onDuty(this)) this.finish();
      else this.activity = this.clock.dutyLabel(this);
    }
  }
}
