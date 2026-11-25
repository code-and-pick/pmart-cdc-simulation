// 층마다 걷는 자리와 길 [시뮬]. 사람·카트·지게차는 통로망(WalkNet)만 따라 움직인다:
//   북쪽 통로(승강기·출고대기 앞) · 보관 방 북쪽 벽 앞 통로 · 선반 통로(남북) · 랙 앞 가로 통로 · 랙 통로(남북) · 서쪽 벽 연결 통로.
// React·three 에 의존하지 않는다.

import { MFCS } from '../config';
import type { EquipKind } from '../domain/sites/chilgok';
import type { FloorLayout, Layout, Location, Rect } from '../domain/layout';
import type { FloorNo } from '../domain/sites/chilgok';

export interface P {
  x: number;
  z: number;
}

/** 걷는 목적지 — lane 은 어느 가로 통로로 드나드는지(N 북쪽 · R 랙 앞 · S 선반 통로는 둘 다) */
export interface WalkPoint extends P {
  lane: 'N' | 'R' | 'S';
}

export class FloorSite {
  readonly floor: FloorNo;
  private readonly shelfAisleX = new Map<string, number>();
  private readonly rackAisleX = new Map<string, number>();

  constructor(
    readonly f: FloorLayout,
    readonly layout: Layout,
  ) {
    this.floor = f.floor;
    for (const a of f.shelfAisles) this.shelfAisleX.set(`${a.zone}${a.no}`, a.cx);
    for (const a of f.aisles) this.rackAisleX.set(`${a.zone}${a.no}`, a.cx);
  }

  /** 칸 앞 서는 자리 — 선반은 선반 통로 가운데, 팔레트는 랙 통로 가운데(지게차) */
  front(loc: Location): WalkPoint {
    if (loc.type === 'PICK_FACE') {
      const x = this.shelfAisleX.get(`${loc.zone}${loc.aisle}`) ?? loc.pos.x;
      return { x, z: loc.pos.z, lane: 'S' };
    }
    if (loc.type === 'RESERVE') {
      const x = this.rackAisleX.get(`${loc.zone}${loc.aisle}`) ?? loc.pos.x;
      return { x, z: loc.pos.z, lane: 'R' };
    }
    // 출고대기·그 밖: 북쪽 통로에서 그 자리 바로 남쪽
    return { x: loc.pos.x, z: Math.min(loc.pos.z + 1.2, this.f.walk.northZ), lane: 'N' };
  }

  /** 분류 자리(분배·라인·DAS·DPS·휠소터 앞) — FC 가 카트를 내려놓고 분류 작업자가 일하는 곳 */
  station(): WalkPoint {
    const pref = this.floor === 6 ? 'DAS' : this.floor === 5 ? 'WHEEL_SORTER' : 'AUTOSTORE';
    const e = this.f.equipment.find((x) => x.kind === pref) ?? this.f.equipment[0];
    if (!e) return this.home();
    if (e.rect.z0 >= this.layout.bandDepth) return { x: e.rect.x0 + 2, z: this.f.walk.rackZ, lane: 'R' };
    return { x: (e.rect.x0 + e.rect.x1) / 2, z: this.f.walk.northZ, lane: 'N' };
  }

  /** 라인(DAS)·분배 작업자 k 의 자리 — 줄 하나를 맡는다. stand = 줄 서쪽 끝 작업대 앞, slot(m) = MFC m 칸 앞, light(m) = 그 칸 위 표시등 */
  lineSpot(kind: 'DAS' | 'SPLIT', k: number) {
    const e = this.f.equipment.find((x) => x.kind === kind);
    if (!e) throw new Error(`${this.floor}F ${kind} 없음`);
    const rows = dasRows(e.rect);
    const r = rows[k % rows.length];
    const sx = (m: number) => r.slots[mfcSlotIndex(m, r.slots.length)];
    return {
      stand: { x: r.cx - r.len / 2 + 0.8, z: r.z - 0.9, lane: 'R' as const },
      slot: (m: number): WalkPoint => ({ x: sx(m), z: r.z - 0.9, lane: 'R' }),
      light: (m: number) => ({ x: sx(m), y: 2.45, z: r.z + 0.83 }),
    };
  }

  /** 설비에 물건을 내려놓는 자리 — 띠 설비는 북쪽 통로 쪽, 동쪽 설비는 랙 앞 통로 쪽 */
  dropAt(kind: EquipKind): WalkPoint {
    const e = this.f.equipment.find((x) => x.kind === kind);
    if (!e) return this.home();
    if (e.rect.z0 >= this.layout.bandDepth) return { x: e.rect.x0 + 2, z: this.f.walk.rackZ, lane: 'R' };
    return { x: (e.rect.x0 + e.rect.x1) / 2, z: this.f.walk.northZ, lane: 'N' };
  }

  /** 대기 자리 — 첫 승강기 앞 */
  home(): WalkPoint {
    const l = this.f.lifts[0];
    return { x: (l.rect.x0 + l.rect.x1) / 2, z: this.f.walk.northZ, lane: 'N' };
  }

  /** 길: from → to 를 지나는 점들(from 제외) */
  route(from: WalkPoint, to: WalkPoint): P[] {
    const { northZ, rackZ, westX } = this.f.walk;
    const corr = (p: WalkPoint) => (p.lane === 'N' ? [northZ] : p.lane === 'R' ? [rackZ] : [northZ, rackZ]);
    const cf = corr(from);
    const ct = corr(to);
    const common = cf.filter((c) => ct.includes(c));
    const pts: P[] = [];
    if (from.x === to.x && from.lane === to.lane && from.lane !== 'N' && common.length) {
      // 같은 통로 안 — 바로 간다
      pts.push({ x: to.x, z: to.z });
      return pts;
    }
    if (common.length) {
      const c = common.reduce((best, z) => (Math.abs(from.z - z) + Math.abs(to.z - z) < Math.abs(from.z - best) + Math.abs(to.z - best) ? z : best));
      pts.push({ x: from.x, z: c }, { x: to.x, z: c }, { x: to.x, z: to.z });
    } else {
      // 북쪽 ↔ 랙: 서쪽 벽 연결 통로로
      pts.push({ x: from.x, z: cf[0] }, { x: westX, z: cf[0] }, { x: westX, z: ct[0] }, { x: to.x, z: ct[0] }, { x: to.x, z: to.z });
    }
    return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.z !== pts[i - 1].z);
  }
}

/** 길이(m) */
export function pathLength(from: P, pts: P[]): number {
  let d = 0;
  let a = from;
  for (const b of pts) {
    d += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    a = b;
  }
  return d;
}


/**
 * 지하 B1 — 차량 접안(90). 접안 문은 z = 2 줄(차는 그 남쪽 z 3~14 에 선다), 문 북쪽이 상차 마당, 맨 북쪽에 승강기 착지(위층과 같은 승강기 4대) [가정].
 * 사람은 마당 가로 통로(z = B1.corridorZ)만 따라 승강기 착지 ↔ 접안 문을 오간다.
 */
export const B1 = { liftZ: -7, corridorZ: -2, doorZ: 0.8, truckZ0: 3, truckZ1: 14 } as const;

export class B1Site {
  constructor(readonly layout: Layout) {}

  /** 승강기 착지 — 위층 승강기와 같은 x */
  liftLanding(no: number): WalkPoint {
    const l = this.layout.floors[0].lifts[(no - 1) % this.layout.floors[0].lifts.length];
    return { x: (l.rect.x0 + l.rect.x1) / 2, z: B1.liftZ + 2, lane: 'N' };
  }

  /** 접안 문 앞(차 뒷문) */
  dock(loc: Location): WalkPoint {
    return { x: loc.pos.x, z: B1.doorZ, lane: 'N' };
  }

  home(): WalkPoint {
    return { ...this.liftLanding(1), z: B1.corridorZ };
  }

  route(from: WalkPoint, to: WalkPoint): P[] {
    const c = B1.corridorZ;
    const pts: P[] = [
      { x: from.x, z: c },
      { x: to.x, z: c },
      { x: to.x, z: to.z },
    ];
    return pts.filter((p, i) => (i === 0 ? p.x !== from.x || p.z !== from.z : p.x !== pts[i - 1].x || p.z !== pts[i - 1].z));
  }
}

/** 층 승강기 문(92) 앞 — 롤테이너를 승강기에 싣는 자리 */
export function liftDoor(f: FloorLayout, no: number): WalkPoint {
  const l = f.lifts[(no - 1) % f.lifts.length];
  return { x: (l.rect.x0 + l.rect.x1) / 2, z: f.walk.northZ, lane: 'N' };
}

/**
 * 라인(DAS)·분배 줄 — 설비 자리(rect) 안에 동서로 긴 줄(롤러 작업대 z, 그 남쪽 1.35m 에 MFC 칸 롤테이너들).
 * 화면(Equipment3D.DasLines)과 시뮬레이션이 같은 계산을 쓴다 [시뮬].
 */
export interface DasRow {
  z: number;
  cx: number;
  len: number;
  /** 칸(롤테이너) x 들 */
  slots: number[];
}
export function dasRows(r: Rect): DasRow[] {
  const rows = Math.max(1, Math.floor((r.z1 - r.z0) / 6.5));
  const len = r.x1 - r.x0 - 3;
  const cx = (r.x0 + r.x1) / 2;
  return Array.from({ length: rows }, (_, k) => {
    const n = Math.floor(len / 1.0);
    return { z: r.z0 + 3 + k * ((r.z1 - r.z0 - 4) / rows), cx, len, slots: Array.from({ length: n }, (_, i) => cx - len / 2 + (i + 0.5) * (len / n)) };
  });
}
/** MFC m(0~)이 쓰는 칸 번호 — 줄 앞쪽부터 띄엄띄엄 */
export function mfcSlotIndex(m: number, n: number): number {
  return Math.min(n - 1, 2 + m * Math.max(1, Math.floor((n - 4) / MFCS.length)));
}
