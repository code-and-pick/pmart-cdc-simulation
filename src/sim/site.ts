// 층마다 걷는 자리와 길 [시뮬]. 사람·카트·지게차는 통로망(WalkNet)만 따라 움직인다:
//   북쪽 통로(승강기·출고대기 앞) · 보관 방 북쪽 벽 앞 통로 · 선반 통로(남북) · 랙 앞 가로 통로 · 랙 통로(남북) · 서쪽 벽 연결 통로.
// React·three 에 의존하지 않는다.

import { AUTOSTORE, MFCS, SHELF, VEG_LANES } from '../config';
const SHELF_BASE = SHELF.aisleBase;
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
    if (loc.bin) {
      // 오토스토어 빈: 작업자는 포트 앞에 서고 로봇이 통을 가져온다
      const e = this.f.equipment.find((x) => x.kind === 'AUTOSTORE');
      if (e) {
        const ports = autostorePorts(e.rect);
        return { x: ports[(loc.binNo ?? loc.bay) % ports.length], z: this.f.walk.roomZ, lane: 'S' };
      }
    }
    if (loc.lane) return { x: loc.pos.x + (VEG_LANES.laneW + VEG_LANES.gap) / 2, z: loc.pos.z, lane: 'R' };
    if (loc.type === 'PICK_FACE' && loc.aisle >= SHELF_BASE) {
      const x = this.shelfAisleX.get(`${loc.zone}${loc.aisle}`) ?? loc.pos.x;
      return { x, z: loc.pos.z, lane: 'S' };
    }
    if (loc.aisle < SHELF_BASE && loc.aisle < 90) {
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
    if (e.rect.z0 >= this.layout.bandDepth) return { x: e.rect.x0 + 2, z: this.f.walk.roomZ, lane: 'S' };
    return { x: (e.rect.x0 + e.rect.x1) / 2, z: this.f.walk.roomZ, lane: 'S' };
  }

  /** DPS 피커가 닫은 박스를 컨베이어에 올리는 곳(냉동 전실 안, 첫 선반 통로 북쪽 끝) */
  dpsLoad(): WalkPoint {
    const e = this.f.equipment.find((x) => x.kind === 'DPS');
    const a = this.f.shelfAisles.filter((x) => x.zone === 'A').sort((p, q) => p.cx - q.cx)[0];
    if (!e || !a) return this.home();
    return { x: a.cx, z: e.rect.z1 + 0.6, lane: 'S' };
  }

  /** 오토스토어 포트 p 의 MFC m 박스 자리(PPC-01~05 다섯 개가 포트 앞에 나란히) */
  portBox(p: number, m: number) {
    const e = this.f.equipment.find((x) => x.kind === 'AUTOSTORE')!;
    const px = autostorePorts(e.rect)[p];
    return { x: px + (m - (MFCS.length - 1) / 2) * 0.42, y: 1.05, z: e.rect.z1 - 0.3 };
  }

  /** 오토스토어 입고 포트(보충 — 통에 채우기): 오토스토어 동쪽 */
  autostoreRefill(): WalkPoint {
    const e = this.f.equipment.find((x) => x.kind === 'AUTOSTORE');
    if (!e) return this.home();
    return { x: e.rect.x1 + 0.6, z: this.f.walk.roomZ, lane: 'S' };
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
    if (kind === 'DPS') return { x: e.rect.x0 + 0.8, z: e.rect.z1 + 1.0, lane: 'N' };
    return { x: e.rect.x0 + 2, z: this.f.walk.roomZ, lane: 'S' };
  }

  /** 선반 통로 입구(북쪽 통로 위) — 지게차는 여기까지만 [사용자 2026-11-25] */
  shelfEntrance(loc: Location): WalkPoint {
    const x = this.shelfAisleX.get(`${loc.zone}${loc.aisle}`) ?? loc.pos.x;
    return { x, z: this.f.walk.roomZ, lane: 'S' };
  }

  /** 라인 공급대 — FC 가 라인용 상품 박스를 내려놓는 곳(선반 동쪽 끝, 북쪽 통로). 자키가 여기서 라인으로 */
  lineBuffer(): WalkPoint {
    const e = this.f.equipment.find((x) => x.kind === 'DAS');
    if (e) return { x: e.rect.x0 - 0.8, z: this.f.walk.roomZ, lane: 'S' };
    const xs = this.f.shelfAisles.map((a) => a.cx);
    return { x: (xs.length ? Math.max(...xs) : 10) + 3, z: this.f.walk.roomZ, lane: 'S' };
  }

  /** 휠소터 투입구(북쪽 통로)·MFC m 갈래 끝 */
  sorterIn(): WalkPoint {
    return this.dropAt('WHEEL_SORTER');
  }
  sorterOut(m: number): WalkPoint {
    const e = this.f.equipment.find((x) => x.kind === 'WHEEL_SORTER');
    if (!e) return this.home();
    const l = sorterLanes(e.rect)[m % MFCS.length];
    return { x: l.x, z: l.z, lane: 'N' };
  }

  /** 대기 자리 — 첫 승강기 앞 */
  home(): WalkPoint {
    const l = this.f.lifts[0];
    return { x: (l.rect.x0 + l.rect.x1) / 2, z: this.f.walk.northZ, lane: 'N' };
  }

  /**
   * 길: from → to 를 지나는 점들(from 제외). 북쪽 통로(N, 승강기·출고대기 앞)와 안쪽(선반·랙·설비 — 작업장 남쪽 통로 roomZ)은
   * 남북 연결 통로(walk.links — 온도 방 문 자리)로만 오간다 [시뮬].
   */
  route(from: WalkPoint, to: WalkPoint): P[] {
    const { northZ, roomZ, links } = this.f.walk;
    const cz = (p: WalkPoint) => (p.lane === 'N' ? northZ : roomZ);
    const pts: P[] = [];
    const a = cz(from);
    const b = cz(to);
    if (from.x === to.x && from.lane === to.lane && from.lane !== 'N') {
      pts.push({ x: to.x, z: to.z });
    } else if (a === b) {
      pts.push({ x: from.x, z: a }, { x: to.x, z: a }, { x: to.x, z: to.z });
    } else {
      // 가까운 연결 통로로
      const L = links.reduce((best, x) => (Math.abs(from.x - x) + Math.abs(to.x - x) < Math.abs(from.x - best) + Math.abs(to.x - best) ? x : best), links[0]);
      pts.push({ x: from.x, z: a }, { x: L, z: a }, { x: L, z: b }, { x: to.x, z: b }, { x: to.x, z: to.z });
    }
    return pts.filter((p, i) => (i === 0 ? p.x !== from.x || p.z !== from.z : p.x !== pts[i - 1].x || p.z !== pts[i - 1].z));
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

/** 오토스토어 포트 x 들 — 북쪽(통로 쪽) 면에 둘. 화면(AutoStore)과 같은 계산 */
export function autostorePorts(r: Rect): number[] {
  const n = AUTOSTORE.ports;
  return Array.from({ length: n }, (_, i) => r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / n);
}

/** 휠소터 MFC 갈래 — 갈래 끝 롤테이너 자리(x, z). 화면(WheelSorter)과 같은 계산 */
export function sorterLanes(r: Rect): { x: number; z: number; side: number }[] {
  const cx = (r.x0 + r.x1) / 2;
  const z0 = r.z0 + 1.2;
  const z1 = r.z1 - 1.2;
  const laneLen = Math.min(4.2, (r.x1 - r.x0) / 2 - 1.4);
  return MFCS.map((_, i) => {
    const side = i % 2 ? 1 : -1;
    return { x: cx + side * (laneLen + 1.1), z: z0 + ((i + 0.7) * (z1 - z0)) / (MFCS.length + 0.4), side };
  });
}
