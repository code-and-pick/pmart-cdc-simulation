// 층마다 걷는 자리와 길 [시뮬]. 사람·카트·지게차는 통로망(WalkNet)만 따라 움직인다:
//   북쪽 통로(승강기·출고대기와 선반 사이) · 선반 통로(남북) · 랙 앞 가로 통로 · 랙 통로(남북) · 서쪽 벽 연결 통로.
// React·three 에 의존하지 않는다.

import type { FloorLayout, Layout, Location } from '../domain/layout';
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

