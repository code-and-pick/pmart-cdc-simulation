// cdc-inventory 의미를 흉내 내는 원장 [시뮬]. 실서버를 대신하지 않는다.
// 수량 축: 칸(SKU·LOT·위치)마다 현물 H(onHand)·예약 R(reserved)·보류 held, 센터 전체 Transit.
// 불변식 (WMS 제1부 0.3, cdc-inventory Availability):
//   0 ≤ R ≤ H (칸마다), 할당별 보유 합 = 칸 R
//   할당 = 예약만 · 피킹(MOVE) = 위치만 · 출발 TOUT = H −q · R −q · Transit +q (한 거래) · 수령 확인 = Transit −r
//   시작 H 합 = 지금 H 합 + 출발 합,  Transit = 출발 합 − 확인 수령 합 − 승인 손실
// 할당 후보는 랙 칸(통로 01~89)의 적격 재고다. 출고대기(91)·접안(90)·승강기(92) 칸은 후보가 아니다.

import { SHELF, SKU_PLACE, VEG_LANES } from '../../config';
import type { Allocation, AllocationLot, Availability, Bucket, Commit, PostingKind, Transit } from '../../domain/contract';

export class LedgerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    msg: string,
  ) {
    super(msg);
  }
}

interface Cell {
  sku: string;
  lot: string;
  locationCode: string;
  onHand: number;
  reserved: number;
  held: number;
}

interface AllocRec {
  alloc: Allocation;
  /** 칸 키 → 이 할당이 잡고 있는 예약 수량(피킹으로 위치가 바뀌면 따라간다) */
  holdings: Map<string, number>;
  departed: boolean;
}

export interface LedgerOptions {
  cdcId: string;
  isoNow: () => string;
  /** 오늘(YYYY-MM-DD) — FEFO 잔여일수 계산 */
  today: () => string;
}

const key = (sku: string, lot: string, loc: string) => `${sku}|${lot}|${loc}`;
const aisleOf = (code: string) => Number(code.split('-')[3]);
/** 보관·피킹 칸 — 팔레트 랙 01~ · 피킹 선반·오토스토어 61~89 · 야채 바닥 레인(VEG_LANES.aisle). 할당 후보. 90 접안·91 출고대기·92 승강기는 아니다 */
export const isRackLocation = (code: string) => aisleOf(code) < 90 || aisleOf(code) === VEG_LANES.aisle;
/** 피킹 칸(PICK_FACE) — 선반·오토스토어 61~89 · 야채 레인 · 피킹면 구역(SKU_PLACE.faceZones) 랙 1단 [사용자 2026-11-25 §4] */
export const isShelfLocation = (code: string) => {
  const [, zone, , aisle, , level] = code.split('-');
  const a = Number(aisle);
  return (a >= SHELF.aisleBase && a < 90) || a === VEG_LANES.aisle || (a < SHELF.aisleBase && level === '1' && SKU_PLACE.faceZones.includes(zone));
};
/** 팔레트 랙 보관 칸(RESERVE) */
export const isPalletLocation = (code: string) => aisleOf(code) < SHELF.aisleBase && !isShelfLocation(code);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export class CdcLedger {
  private readonly cells = new Map<string, Cell>();
  private readonly lotExpiry = new Map<string, string>(); // sku|lot → 유통기한
  private readonly allocations = new Map<string, AllocRec>();
  private readonly allocByTrf = new Map<string, string>(); // trfId|version → allocationId
  private readonly transits = new Map<string, Transit>(); // trfId → Transit
  private readonly receipts = new Set<string>();
  private readonly departedTrfs = new Set<string>();
  private readonly commits = new Map<string, Commit>();
  /** 위치가 막힌 칸(부족 보고 NOT_FOUND·LOCATION_BLOCKED 뒤 재계수 전) — 새 할당 후보에서 뺀다 */
  readonly blocked = new Set<string>();
  /** 칸 수량이 바뀐 위치 코드(화면이 다시 그린다) */
  readonly dirty = new Set<string>();
  /** 거래마다 1 오른다 — 화면이 바뀐 때만 다시 그린다 */
  version = 0;
  private seq = 0;
  private initialTotal = 0;
  private departedTotal = 0;
  private ackedTotal = 0;

  constructor(private readonly opt: LedgerOptions) {}

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(6, '0')}`;
  }

  private cell(sku: string, lot: string, loc: string): Cell {
    const k = key(sku, lot, loc);
    let c = this.cells.get(k);
    if (!c) {
      c = { sku, lot, locationCode: loc, onHand: 0, reserved: 0, held: 0 };
      this.cells.set(k, c);
    }
    return c;
  }

  private commit(kind: PostingKind, sourceRef: string, deltas: Commit['deltas']): Commit {
    const c: Commit = { commitId: this.id('CMT'), requestId: sourceRef, postingKind: kind, status: 'APPLIED', sourceRef, appliedAt: this.opt.isoNow(), deltas };
    this.commits.set(c.commitId, c);
    this.version += 1;
    for (const d of deltas) if (d.locationCode) this.dirty.add(d.locationCode);
    return c;
  }

  getCommit(commitId: string): Commit | undefined {
    const c = this.commits.get(commitId);
    return c && structuredClone(c);
  }

  // ── 초기 보유 (INITIAL_BALANCE, CDC-F-003) ─────────────
  initialBalance(lines: { sku: string; lot: string; expiresAt: string; locationCode: string; qty: number }[]): Commit {
    const deltas: Commit['deltas'] = [];
    for (const l of lines) {
      if (l.qty <= 0) continue;
      const k = key(l.sku, l.lot, l.locationCode);
      if (this.cells.get(k)?.onHand) throw new LedgerError(409, 'INVALID_STATE', `초기 보유는 센터·SKU·LOT 당 1회: ${k}`);
      this.cell(l.sku, l.lot, l.locationCode).onHand += l.qty;
      this.lotExpiry.set(`${l.sku}|${l.lot}`, l.expiresAt);
      this.initialTotal += l.qty;
      deltas.push({ sku: l.sku, lot: l.lot, locationCode: l.locationCode, bucket: 'ON_HAND', delta: l.qty });
    }
    return this.commit('INITIAL_BALANCE', 'SEED', deltas);
  }

  // ── 조회 ────────────────────────────────────────
  cellsAt(locationCode: string): { sku: string; lot: string; onHand: number; reserved: number; expiresAt: string }[] {
    return [...this.cells.values()]
      .filter((c) => c.locationCode === locationCode && c.onHand > 0)
      .map((c) => ({ sku: c.sku, lot: c.lot, onHand: c.onHand, reserved: c.reserved, expiresAt: this.lotExpiry.get(`${c.sku}|${c.lot}`) ?? '' }));
  }

  /** 위치별 현물 합 (화면이 칸마다 상자를 그린다) */
  onHandByLocation(): Map<string, number> {
    const m = new Map<string, number>();
    for (const c of this.cells.values()) if (c.onHand > 0) m.set(c.locationCode, (m.get(c.locationCode) ?? 0) + c.onHand);
    return m;
  }

  onHandAt(locationCode: string): number {
    let n = 0;
    for (const c of this.cells.values()) if (c.locationCode === locationCode) n += c.onHand;
    return n;
  }

  totals() {
    let onHand = 0;
    let reserved = 0;
    for (const c of this.cells.values()) {
      onHand += c.onHand;
      reserved += c.reserved;
    }
    let transit = 0;
    for (const t of this.transits.values()) for (const l of t.lines) transit += l.t;
    return { onHand, reserved, transit, initial: this.initialTotal, departed: this.departedTotal, acked: this.ackedTotal };
  }

  /** 적격 E = 품질 RELEASED(MOCK 은 held 만 뺀다) · 랙 칸 · 막히지 않음 · 잔여일수 충족 */
  private eligibleCells(sku: string, minRemainingDays: number): Cell[] {
    const today = this.opt.today();
    return [...this.cells.values()]
      .filter((c) => c.sku === sku && isRackLocation(c.locationCode) && !this.blocked.has(key(c.sku, c.lot, c.locationCode)))
      .filter((c) => daysBetween(today, this.lotExpiry.get(`${c.sku}|${c.lot}`) ?? today) >= minRemainingDays)
      .sort((a, b) => {
        const ea = this.lotExpiry.get(`${a.sku}|${a.lot}`) ?? '';
        const eb = this.lotExpiry.get(`${b.sku}|${b.lot}`) ?? '';
        if (ea !== eb) return ea < eb ? -1 : 1; // FEFO
        const sa = isShelfLocation(a.locationCode) ? 0 : 1;
        const sb = isShelfLocation(b.locationCode) ? 0 : 1;
        if (sa !== sb) return sa - sb; // 같은 기한이면 피킹 선반 먼저(보충 없이 바로 집는다)
        const la = Number(a.locationCode.split('-')[5]);
        const lb = Number(b.locationCode.split('-')[5]);
        if (la !== lb) return la - lb; // 그다음 낮은 단
        return a.locationCode < b.locationCode ? -1 : 1;
      });
  }

  availability(sku: string, minRemainingDays: number, safety: number): Availability {
    let onHand = 0;
    let reserved = 0;
    let held = 0;
    let transit = 0;
    for (const c of this.cells.values()) {
      if (c.sku !== sku) continue;
      onHand += c.onHand;
      reserved += c.reserved;
      held += c.held;
    }
    for (const t of this.transits.values()) for (const l of t.lines) if (l.sku === sku) transit += l.t;
    const el = this.eligibleCells(sku, minRemainingDays);
    const eligible = el.reduce((s, c) => s + c.onHand - c.held, 0);
    const today = this.opt.today();
    const lots = new Map<string, Availability['lots'][number]>();
    for (const c of el) {
      const exp = this.lotExpiry.get(`${c.sku}|${c.lot}`) ?? today;
      const l = lots.get(c.lot) ?? { lot: c.lot, expiresAt: exp, remainingDays: daysBetween(today, exp), identification: 'VERIFIED' as const, eligible: 0, reserved: 0, held: 0 };
      l.eligible += c.onHand - c.held;
      l.reserved += c.reserved;
      l.held += c.held;
      lots.set(c.lot, l);
    }
    const elReserved = el.reduce((s, c) => s + c.reserved, 0);
    return {
      cdcId: this.opt.cdcId,
      sku,
      asOf: { asOf: this.opt.isoNow(), freshness: 'CURRENT' },
      onHand,
      eligible,
      reserved,
      held,
      safety: { state: 'VALUE', value: safety },
      available: Math.max(0, eligible - elReserved - safety),
      transit,
      handlingActive: onHand > 0 || transit > 0,
      lots: [...lots.values()],
    };
  }

  // ── 할당 (createAllocation, CDC-F-016) ─────────────────
  /** FEFO 다LOT 확보. 부분 할당 허용. trfId·trfVersion 당 1회 — 다시 부르면 기존 결과. */
  allocate(req: { trfId: string; trfVersion: number; lines: { sku: string; requestedQty: number; minRemainingDays: number }[] }, safety: number): Allocation {
    const k = `${req.trfId}|${req.trfVersion}`;
    const prev = this.allocByTrf.get(k);
    if (prev) return structuredClone(this.allocations.get(prev)!.alloc);
    if (this.departedTrfs.has(req.trfId)) throw new LedgerError(409, 'INVALID_STATE', '이미 출발 전기된 TRF');
    const allocationId = this.id('ALC');
    const rec: AllocRec = {
      alloc: { allocationId, trfId: req.trfId, trfVersion: req.trfVersion, state: 'ALLOCATED', version: 0, allocatedAt: this.opt.isoNow(), lines: [] },
      holdings: new Map(),
      departed: false,
    };
    const deltas: Commit['deltas'] = [];
    for (const l of req.lines) {
      const lots = this.reserve(rec, l.sku, l.requestedQty, l.minRemainingDays, safety, deltas);
      const got = lots.reduce((s, x) => s + x.qty, 0);
      rec.alloc.lines.push({ sku: l.sku, requestedQty: l.requestedQty, allocatedQty: got, shortQty: l.requestedQty - got, releasedQty: 0, departedQty: 0, lots });
    }
    const total = rec.alloc.lines.reduce((s, l) => s + l.allocatedQty, 0);
    rec.alloc.state = total === 0 ? 'FAILED' : rec.alloc.lines.some((l) => l.shortQty > 0) ? 'PARTIAL' : 'ALLOCATED';
    rec.alloc.commitId = this.commit('ALLOCATION', req.trfId, deltas).commitId;
    this.allocations.set(allocationId, rec);
    this.allocByTrf.set(k, allocationId);
    return structuredClone(rec.alloc);
  }

  private reserve(rec: AllocRec, sku: string, qty: number, minDays: number, safety: number, deltas: Commit['deltas']): AllocationLot[] {
    const out: AllocationLot[] = [];
    // 안전량은 SKU 전체 적격 가용에서 먼저 뺀다
    let free = Math.max(0, this.eligibleCells(sku, minDays).reduce((s, c) => s + c.onHand - c.held - c.reserved, 0) - safety);
    let need = Math.min(qty, free);
    for (const c of this.eligibleCells(sku, minDays)) {
      if (need <= 0) break;
      const take = Math.min(need, c.onHand - c.held - c.reserved);
      if (take <= 0) continue;
      c.reserved += take;
      need -= take;
      free -= take;
      const ck = key(c.sku, c.lot, c.locationCode);
      rec.holdings.set(ck, (rec.holdings.get(ck) ?? 0) + take);
      out.push({ lot: c.lot, locationCode: c.locationCode, qty: take, expiresAt: this.lotExpiry.get(`${c.sku}|${c.lot}`) ?? '' });
      deltas.push({ sku, lot: c.lot, locationCode: c.locationCode, bucket: 'RESERVED', delta: take });
    }
    return out;
  }

  getAllocation(allocationId: string): Allocation | undefined {
    const r = this.allocations.get(allocationId);
    return r && structuredClone(r.alloc);
  }

  /** 부족 보고 뒤 재할당 — 같은 할당의 승인 한도(requestedQty) 안에서만 [CDC-F-018] */
  reallocate(allocationId: string, sku: string, qty: number, minDays: number, safety: number): AllocationLot[] {
    const rec = this.mustAlloc(allocationId);
    const line = rec.alloc.lines.find((l) => l.sku === sku);
    if (!line) throw new LedgerError(404, 'NOT_FOUND', `할당에 없는 SKU ${sku}`);
    const room = line.requestedQty - (line.allocatedQty - line.releasedQty);
    const deltas: Commit['deltas'] = [];
    const lots = this.reserve(rec, sku, Math.min(qty, room), minDays, safety, deltas);
    const got = lots.reduce((s, x) => s + x.qty, 0);
    if (got > 0) {
      line.allocatedQty += got;
      line.shortQty = line.requestedQty - (line.allocatedQty - line.releasedQty);
      line.lots.push(...lots);
      rec.alloc.version += 1;
      this.commit('ALLOCATION', rec.alloc.trfId, deltas);
      this.refreshState(rec);
    }
    return lots;
  }

  // ── 해제 (releaseAllocation) ────────────────────────
  /** lines 비우면 전량. locationCode 는 MOCK 내부 확장(어느 칸의 예약을 풀지) — 없으면 랙 칸부터 */
  release(allocationId: string, reason: string, lines?: { sku: string; lot?: string; locationCode?: string; qty: number }[]): Commit {
    const rec = this.mustAlloc(allocationId);
    // 출발 전기된 수량은 이미 보유에서 빠졌다. 출발 뒤에는 남은 잔량 정리(RESIDUAL_CLOSED)만 받는다
    if (rec.departed && reason !== 'RESIDUAL_CLOSED') throw new LedgerError(409, 'INVALID_STATE', '출발한 TRF — 잔량 정리만 가능');
    const want = lines ?? [...rec.holdings.entries()].map(([k, q]) => { const [sku, lot, loc] = k.split('|'); return { sku, lot, locationCode: loc, qty: q }; });
    // 먼저 모두 검사하고(전부 또는 전무) 그다음 반영
    const plan: { k: string; qty: number }[] = [];
    for (const l of want) {
      let need = l.qty;
      const cands = [...rec.holdings.entries()]
        .filter(([k, q]) => q > 0 && k.startsWith(`${l.sku}|`) && (!l.lot || k.split('|')[1] === l.lot) && (!l.locationCode || k.split('|')[2] === l.locationCode))
        .sort(([a], [b]) => Number(isRackLocation(b.split('|')[2])) - Number(isRackLocation(a.split('|')[2])));
      for (const [k, q] of cands) {
        if (need <= 0) break;
        const already = plan.filter((p) => p.k === k).reduce((s, p) => s + p.qty, 0);
        const take = Math.min(need, q - already);
        if (take > 0) {
          plan.push({ k, qty: take });
          need -= take;
        }
      }
      if (need > 0) throw new LedgerError(409, 'RELEASE_EXCEEDS_ALLOCATED', `${l.sku} 해제 ${l.qty} > 보유`);
    }
    const deltas: Commit['deltas'] = [];
    for (const p of plan) {
      const [sku, lot, loc] = p.k.split('|');
      this.cell(sku, lot, loc).reserved -= p.qty;
      rec.holdings.set(p.k, rec.holdings.get(p.k)! - p.qty);
      const line = rec.alloc.lines.find((l) => l.sku === sku)!;
      line.releasedQty += p.qty;
      line.shortQty = line.requestedQty - (line.allocatedQty - line.releasedQty);
      deltas.push({ sku, lot, locationCode: loc, bucket: 'RESERVED', delta: -p.qty });
    }
    rec.alloc.version += 1;
    this.refreshState(rec);
    return this.commit('RELEASE', `${rec.alloc.trfId}:${reason}`, deltas);
  }

  /** 할당이 잡고 있는 칸별 예약 (0 보다 큰 것만) */
  holdingsOf(allocationId: string): { sku: string; lot: string; locationCode: string; qty: number }[] {
    const rec = this.mustAlloc(allocationId);
    return [...rec.holdings.entries()]
      .filter(([, q]) => q > 0)
      .map(([k, qty]) => {
        const [sku, lot, locationCode] = k.split("|");
        return { sku, lot, locationCode, qty };
      });
  }

  expiryOf(sku: string, lot: string): string | undefined {
    return this.lotExpiry.get(`${sku}|${lot}`);
  }

  /** 할당이 아직 잡고 있는 예약 (SKU 별) */
  heldQty(allocationId: string, sku?: string): number {
    const rec = this.mustAlloc(allocationId);
    let n = 0;
    for (const [k, q] of rec.holdings) if (!sku || k.startsWith(`${sku}|`)) n += q;
    return n;
  }

  // ── 위치 이동 (피킹 = 랙 칸 → 출고대기 91, 총현물 불변) ──────
  move(allocationId: string, sku: string, lot: string, from: string, to: string, qty: number, ref: string): Commit {
    const rec = this.mustAlloc(allocationId);
    const fk = key(sku, lot, from);
    const held = rec.holdings.get(fk) ?? 0;
    if (qty <= 0 || held < qty) throw new LedgerError(409, 'INVALID_STATE', `이동 ${qty} > 예약 보유 ${held} (${fk})`);
    const src = this.cell(sku, lot, from);
    if (src.onHand < qty) throw new LedgerError(409, 'INVALID_STATE', `이동 ${qty} > 현물 ${src.onHand} (${fk})`);
    const dst = this.cell(sku, lot, to);
    src.onHand -= qty;
    src.reserved -= qty;
    dst.onHand += qty;
    dst.reserved += qty;
    const tk = key(sku, lot, to);
    rec.holdings.set(fk, held - qty);
    rec.holdings.set(tk, (rec.holdings.get(tk) ?? 0) + qty);
    const d = (loc: string, bucket: Bucket, delta: number) => ({ sku, lot, locationCode: loc, bucket, delta });
    return this.commit('MOVE', ref, [d(from, 'ON_HAND', -qty), d(from, 'RESERVED', -qty), d(to, 'ON_HAND', qty), d(to, 'RESERVED', qty)]);
  }

  // ── 선반 보충 MOV (팔레트 랙 → 피킹 선반, cdc-inbound → cdc-inventory move-postings 역할) ──
  /**
   * 한 칸의 qty 를 다른 칸으로 옮긴다(총현물 불변, WMS CDC-F-013). 그 칸에 예약이 있으면 예약부터 함께 옮기고(할당 보유가 따라감),
   * 나머지는 자유 현물을 옮긴다. 막힌 칸·현물 부족은 거절.
   */
  replenishMove(sku: string, lot: string, from: string, to: string, qty: number, ref: string): Commit {
    const fk = key(sku, lot, from);
    const src = this.cells.get(fk);
    if (!src || qty <= 0 || src.onHand < qty) throw new LedgerError(409, 'INVALID_STATE', `보충 ${qty} > 현물 ${src?.onHand ?? 0} (${fk})`);
    if (this.blocked.has(fk)) throw new LedgerError(409, 'LOCATION_BLOCKED', fk);
    const tk = key(sku, lot, to);
    const dst = this.cell(sku, lot, to);
    let left = qty;
    let movedR = 0;
    for (const r of this.allocations.values()) {
      if (left <= 0) break;
      const h = r.holdings.get(fk) ?? 0;
      const take = Math.min(h, left);
      if (take <= 0) continue;
      r.holdings.set(fk, h - take);
      r.holdings.set(tk, (r.holdings.get(tk) ?? 0) + take);
      left -= take;
      movedR += take;
    }
    if (src.onHand - src.reserved < left) throw new LedgerError(409, 'INVALID_STATE', `보충 자유 현물 부족 (${fk})`);
    src.onHand -= qty;
    src.reserved -= movedR;
    dst.onHand += qty;
    dst.reserved += movedR;
    const d = (loc: string, bucket: Bucket, delta: number) => ({ sku, lot, locationCode: loc, bucket, delta });
    const deltas = [d(from, 'ON_HAND', -qty), d(to, 'ON_HAND', qty)];
    if (movedR) deltas.push(d(from, 'RESERVED', -movedR), d(to, 'RESERVED', movedR));
    return this.commit('MOVE', ref, deltas);
  }

  /** 칸의 현물·예약 (sku·lot 한 칸) */
  cellQty(sku: string, lot: string, loc: string): { onHand: number; reserved: number } {
    const c = this.cells.get(key(sku, lot, loc));
    return { onHand: c?.onHand ?? 0, reserved: c?.reserved ?? 0 };
  }

  // ── 출발 전기 TOUT (postDeparture) ────────────────────
  /** 현물 −q · 예약 −q · Transit +q 를 한 거래로. TRF 당 1회 — 두 번째는 INVALID_STATE(1요청·1이관·1출발). */
  postDeparture(req: { departureId: string; trfId: string; mfcId: string; allocationId: string; departedAt: string; lines: { departureLineId: string; sku: string; lot: string; locationCode: string; qty: number }[] }): Commit {
    if (this.departedTrfs.has(req.trfId)) throw new LedgerError(409, 'INVALID_STATE', '같은 TRF 2회 출발');
    const rec = this.mustAlloc(req.allocationId);
    // 먼저 검사(전부 또는 전무)
    const need = new Map<string, number>();
    for (const l of req.lines) need.set(key(l.sku, l.lot, l.locationCode), (need.get(key(l.sku, l.lot, l.locationCode)) ?? 0) + l.qty);
    for (const [k, q] of need) {
      const h = rec.holdings.get(k) ?? 0;
      if (q > h) throw new LedgerError(409, 'DEPARTURE_EXCEEDS_ALLOCATED', `${k} 출발 ${q} > 예약 ${h}`);
    }
    const deltas: Commit['deltas'] = [];
    const tl = new Map<string, Transit['lines'][number]>();
    for (const l of req.lines) {
      const k = key(l.sku, l.lot, l.locationCode);
      const c = this.cell(l.sku, l.lot, l.locationCode);
      c.onHand -= l.qty;
      c.reserved -= l.qty;
      rec.holdings.set(k, rec.holdings.get(k)! - l.qty);
      rec.alloc.lines.find((x) => x.sku === l.sku)!.departedQty += l.qty;
      deltas.push({ sku: l.sku, lot: l.lot, locationCode: l.locationCode, bucket: 'ON_HAND', delta: -l.qty });
      deltas.push({ sku: l.sku, lot: l.lot, locationCode: l.locationCode, bucket: 'RESERVED', delta: -l.qty });
      deltas.push({ sku: l.sku, lot: l.lot, locationCode: '', bucket: 'TRANSIT', delta: l.qty });
      const t = tl.get(`${l.sku}|${l.lot}`) ?? { sku: l.sku, lot: l.lot, q: 0, r: 0, normalQty: 0, quarantinedQty: 0, l: 0, t: 0 };
      t.q += l.qty;
      t.t += l.qty;
      tl.set(`${l.sku}|${l.lot}`, t);
      this.departedTotal += l.qty;
    }
    rec.departed = true;
    rec.alloc.state = 'DEPARTED';
    rec.alloc.version += 1;
    this.departedTrfs.add(req.trfId);
    this.transits.set(req.trfId, {
      trfId: req.trfId,
      departureId: req.departureId,
      mfcId: req.mfcId,
      state: 'TRANSIT_OPEN',
      departedAt: req.departedAt,
      reconciledAt: null,
      receiptIds: [],
      lines: [...tl.values()],
    });
    return this.commit('TOUT', req.departureId, deltas);
  }

  hasDeparted(trfId: string) {
    return this.departedTrfs.has(trfId);
  }

  // ── MFC 수령 확인 (acknowledgeReceipt) ─────────────────
  /** receiptId 1회 → Transit −r. MFC 재고는 건드리지 않는다(0.3.1-1). */
  acknowledgeReceipt(trfId: string, receiptId: string, lines: { sku: string; lot: string; normalQty: number; quarantinedQty: number }[]): Commit {
    const t = this.transits.get(trfId);
    if (!t) throw new LedgerError(404, 'NOT_FOUND', `Transit 없음 ${trfId}`);
    if (this.receipts.has(receiptId)) return [...this.commits.values()].find((c) => c.postingKind === 'RECEIPT_ACK' && c.sourceRef === receiptId)!;
    const deltas: Commit['deltas'] = [];
    for (const l of lines) {
      const tl = t.lines.find((x) => x.sku === l.sku && x.lot === l.lot);
      const r = l.normalQty + l.quarantinedQty;
      if (!tl || r > tl.t) throw new LedgerError(409, 'RECEIPT_EXCEEDS_TRANSIT', `${l.sku}/${l.lot} 수령 ${r} > 미정산 ${tl?.t ?? 0}`);
    }
    for (const l of lines) {
      const tl = t.lines.find((x) => x.sku === l.sku && x.lot === l.lot)!;
      const r = l.normalQty + l.quarantinedQty;
      tl.r += r;
      tl.normalQty += l.normalQty;
      tl.quarantinedQty += l.quarantinedQty;
      tl.t -= r;
      this.ackedTotal += r;
      deltas.push({ sku: l.sku, lot: l.lot, locationCode: '', bucket: 'TRANSIT', delta: -r });
    }
    this.receipts.add(receiptId);
    t.receiptIds.push(receiptId);
    t.state = t.lines.every((x) => x.t === 0) ? 'TRANSIT_RECONCILED' : 'RECEIPT_POSTED_AWAITING_ACK';
    if (t.state === 'TRANSIT_RECONCILED') t.reconciledAt = this.opt.isoNow();
    return this.commit('RECEIPT_ACK', receiptId, deltas);
  }

  transit(trfId: string): Transit | undefined {
    const t = this.transits.get(trfId);
    return t && structuredClone(t);
  }

  listTransits(): Transit[] {
    return [...this.transits.values()].map((t) => structuredClone(t));
  }

  // ── 불변식 점검 (시험·화면 경고) ─────────────────────
  check(): string[] {
    const v: string[] = [];
    const sumHold = new Map<string, number>();
    for (const r of this.allocations.values()) for (const [k, q] of r.holdings) {
      if (q < 0) v.push(`할당 ${r.alloc.allocationId} 보유 음수 ${k}`);
      sumHold.set(k, (sumHold.get(k) ?? 0) + q);
    }
    for (const [k, c] of this.cells) {
      if (c.onHand < 0) v.push(`현물 음수 ${k}`);
      if (c.reserved < 0 || c.reserved > c.onHand) v.push(`0 ≤ R ≤ H 위반 ${k} R=${c.reserved} H=${c.onHand}`);
      if ((sumHold.get(k) ?? 0) !== c.reserved) v.push(`할당 보유 합 ≠ 칸 R ${k}`);
    }
    for (const r of this.allocations.values()) for (const l of r.alloc.lines) {
      if (l.allocatedQty - l.releasedQty > l.requestedQty) v.push(`유효 할당 > 승인 ${r.alloc.trfId} ${l.sku}`);
      if (l.departedQty + l.releasedQty > l.allocatedQty) v.push(`출발+해제 > 할당 ${r.alloc.trfId} ${l.sku}`);
    }
    const t = this.totals();
    if (t.onHand + t.departed !== t.initial) v.push(`시작 H ${t.initial} ≠ 지금 H ${t.onHand} + 출발 ${t.departed}`);
    if (t.transit !== t.departed - t.acked) v.push(`Transit ${t.transit} ≠ 출발 ${t.departed} − 수령 ${t.acked}`);
    return v;
  }

  private refreshState(rec: AllocRec) {
    if (rec.departed) return;
    const held = [...rec.holdings.values()].reduce((a, b) => a + b, 0);
    if (held === 0 && rec.alloc.lines.some((l) => l.releasedQty > 0)) rec.alloc.state = 'RELEASED';
    else rec.alloc.state = rec.alloc.lines.some((l) => l.shortQty > 0) ? 'PARTIAL' : 'ALLOCATED';
  }

  private mustAlloc(id: string): AllocRec {
    const r = this.allocations.get(id);
    if (!r) throw new LedgerError(404, 'NOT_FOUND', `할당 없음 ${id}`);
    return r;
  }
}
