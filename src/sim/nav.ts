// 층마다 걷는 격자(0.5m) — 랙·선반·설비·승강기·온도 방 벽(문 자리는 뚫림)을 막고, 막힌 길은 A* 로 돌아간다 [시뮬].
// 사용자 2026-11-26 "얘네 동선도 이상해. 장애물 다 뚫고 다니는데" — 전엔 북쪽 통로·남쪽 가로 통로 두 줄 + 연결 통로만 알아
// 그 선이 DAS·오토스토어·벽을 가로지르면 그대로 지나갔다. 이제: 예전 통로 길이 비어 있으면 그대로(모양 유지·빠름), 막히면 격자 길찾기.
// React·three 에 의존하지 않는다.

import { AUTOSTORE, RACK, SHELF, VEG_LANES } from '../config';
import type { FloorLayout, Rect } from '../domain/layout';
import { dasRows, type P } from './site';

const CELL = 0.5;

export class NavGrid {
  readonly nx: number;
  readonly nz: number;
  /** 1 = 막힘 */
  readonly blocked: Uint8Array;
  private readonly cache = new Map<number, P[]>();

  constructor(f: FloorLayout, width: number, depth: number) {
    this.nx = Math.ceil(width / CELL);
    this.nz = Math.ceil(depth / CELL);
    this.blocked = new Uint8Array(this.nx * this.nz);
    const box = (x0: number, z0: number, x1: number, z1: number) => {
      const i0 = Math.max(0, Math.floor(x0 / CELL));
      const i1 = Math.min(this.nx - 1, Math.ceil(x1 / CELL) - 1);
      const j0 = Math.max(0, Math.floor(z0 / CELL));
      const j1 = Math.min(this.nz - 1, Math.ceil(z1 / CELL) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[j * this.nx + i] = 1;
    };
    // 랙·선반 줄
    for (const r of f.rows) box(r.cx - RACK.depth / 2, r.z0, r.cx + RACK.depth / 2, r.z1);
    for (const r of f.shelfRows) box(r.cx - SHELF.depth / 2, r.z0, r.cx + SHELF.depth / 2, r.z1);
    // 설비 — 사람이 서서 일하는 앞면은 비운다
    for (const e of f.equipment) {
      const r = e.rect;
      switch (e.kind) {
        case 'WHEEL_SORTER':
        case 'DPS':
          box(r.x0, r.z0, r.x1, r.z1);
          break;
        case 'DAS':
        case 'SPLIT':
          // 줄마다 컨베이어(작업대) + 그 남쪽 R/T·크레이트 — 줄 북쪽 0.9m(서는 자리)는 비움
          for (const row of dasRows(r)) box(row.cx - row.len / 2, row.z - 0.4, row.cx + row.len / 2, row.z + (e.kind === 'DAS' ? 1.85 : 1.3));
          break;
        case 'AUTOSTORE':
          // 격자 — 남쪽 포트 띠(작업자가 서는 곳)는 비움
          box(r.x0, r.z0, r.x1, r.z1 - 2.3);
          break;
        case 'OFFICE':
          box(r.x0 + 0.3, r.z0 + 0.3, r.x1 - 0.3, r.z1 - 0.3);
          break;
        case 'VEG_LANES': {
          // 레인(팔레트 줄)만 막고 레인 사이 틈은 걷는 길
          const step = VEG_LANES.laneW + VEG_LANES.gap;
          const lanes = Math.floor((r.x1 - r.x0 + VEG_LANES.gap) / step);
          for (let l = 0; l < lanes; l++) box(r.x0 + l * step, r.z0 + 0.5, r.x0 + l * step + VEG_LANES.laneW, r.z1);
          break;
        }
        default:
          break; // 입고 검수·출고대기 — 걷는 곳
      }
    }
    void AUTOSTORE;
    // 승강기
    for (const l of f.lifts) box(l.rect.x0, l.rect.z0, l.rect.x1, l.rect.z1);
    // 온도 방 벽 — 문 자리는 뚫림
    for (const room of f.coldRooms) {
      for (const w of room.walls) {
        const doors = room.doors.filter((d) => (w.z0 === w.z1 ? d.z0 === d.z1 && Math.abs(d.z0 - w.z0) < 0.05 : d.x0 === d.x1 && Math.abs(d.x0 - w.x0) < 0.05));
        if (w.z0 === w.z1) {
          for (let x = Math.min(w.x0, w.x1); x < Math.max(w.x0, w.x1); x += CELL / 2) {
            if (doors.some((d) => x >= Math.min(d.x0, d.x1) && x <= Math.max(d.x0, d.x1))) continue;
            box(x, w.z0 - 0.15, x + 0.01, w.z0 + 0.15);
          }
        } else {
          for (let z = Math.min(w.z0, w.z1); z < Math.max(w.z0, w.z1); z += CELL / 2) {
            if (doors.some((d) => z >= Math.min(d.z0, d.z1) && z <= Math.max(d.z0, d.z1))) continue;
            box(w.x0 - 0.15, z, w.x0 + 0.15, z + 0.01);
          }
        }
      }
    }
  }

  private idx(p: P): number {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor(p.x / CELL)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.floor(p.z / CELL)));
    return j * this.nx + i;
  }

  /** 점에서 가장 가까운 빈 칸(막힌 자리에 선 목적지 — 포트·작업대 앞 등) */
  private nearestFree(c: number): number {
    if (!this.blocked[c]) return c;
    const ci = c % this.nx;
    const cj = Math.floor(c / this.nx);
    for (let r = 1; r < 16; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const k = j * this.nx + i;
          if (!this.blocked[k]) return k;
        }
    return c;
  }

  /** 꺾이는 점들의 길이 막히지 않았나(양 끝 0.8m 안은 봐줌 — 설비 앞 서는 자리) */
  clear(from: P, pts: P[]): boolean {
    let a = from;
    const end = pts[pts.length - 1];
    for (const b of pts) {
      const n = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / (CELL / 2));
      for (let s = 1; s <= n; s++) {
        const p = { x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n };
        if (Math.hypot(p.x - from.x, p.z - from.z) < 0.8 || Math.hypot(p.x - end.x, p.z - end.z) < 0.8) continue;
        if (this.blocked[this.idx(p)]) return false;
      }
      a = b;
    }
    return true;
  }

  /** A*(4방향) — 꺾이는 점만 돌려준다. 끝은 실제 목적지 */
  find(from: P, to: P): P[] {
    const s = this.nearestFree(this.idx(from));
    const g = this.nearestFree(this.idx(to));
    const key = s * this.nx * this.nz + g;
    const hit = this.cache.get(key);
    if (hit) return [...hit.map((p) => ({ ...p })), { x: to.x, z: to.z }];
    const N = this.nx * this.nz;
    const cost = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const dir = new Int8Array(N).fill(-1);
    const gi = g % this.nx;
    const gj = Math.floor(g / this.nx);
    const h = (k: number) => Math.abs((k % this.nx) - gi) + Math.abs(Math.floor(k / this.nx) - gj);
    // 이진 힙
    const heap: number[] = [];
    const pri: number[] = [];
    const push = (k: number, p: number) => {
      heap.push(k);
      pri.push(p);
      let i = heap.length - 1;
      while (i > 0) {
        const u = (i - 1) >> 1;
        if (pri[u] <= pri[i]) break;
        [heap[u], heap[i]] = [heap[i], heap[u]];
        [pri[u], pri[i]] = [pri[i], pri[u]];
        i = u;
      }
    };
    const pop = () => {
      const top = heap[0];
      const lk = heap.pop()!;
      const lp = pri.pop()!;
      if (heap.length) {
        heap[0] = lk;
        pri[0] = lp;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && pri[l] < pri[m]) m = l;
          if (r < heap.length && pri[r] < pri[m]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          [pri[m], pri[i]] = [pri[i], pri[m]];
          i = m;
        }
      }
      return top;
    };
    cost[s] = 0;
    push(s, h(s));
    const D = [1, -1, this.nx, -this.nx];
    let found = false;
    while (heap.length) {
      const c = pop();
      if (c === g) {
        found = true;
        break;
      }
      const ci = c % this.nx;
      for (let d = 0; d < 4; d++) {
        if ((d === 0 && ci === this.nx - 1) || (d === 1 && ci === 0)) continue;
        const k = c + D[d];
        if (k < 0 || k >= N || this.blocked[k]) continue;
        // 꺾을 때 조금 더 — 통로를 따라 곧게 걷게
        const nc = cost[c] + 1 + (dir[c] >= 0 && dir[c] !== d ? 0.4 : 0);
        if (nc < cost[k]) {
          cost[k] = nc;
          prev[k] = c;
          dir[k] = d;
          push(k, nc + h(k));
        }
      }
    }
    if (!found) return [{ x: to.x, z: to.z }];
    const cells: number[] = [];
    for (let c = g; c !== -1; c = prev[c]) cells.push(c);
    cells.reverse();
    const pts: P[] = [];
    for (let i = 1; i < cells.length - 1; i++) if (dir[cells[i]] !== dir[cells[i + 1]]) pts.push(this.center(cells[i]));
    pts.push(this.center(g));
    if (this.cache.size > 40_000) this.cache.clear();
    this.cache.set(key, pts);
    return [...pts.map((p) => ({ ...p })), { x: to.x, z: to.z }];
  }

  private center(k: number): P {
    return { x: ((k % this.nx) + 0.5) * CELL, z: (Math.floor(k / this.nx) + 0.5) * CELL };
  }
}

export type { Rect };
