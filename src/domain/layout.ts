// 칠곡 DC 층별 배치 — 센터 데이터(sites/chilgok.ts)를 받아 층·구역·랙·칸·비랙 위치를 만든다.
// 좌표 단위 m, x = 동쪽, z = 남쪽(화면 아래), y = 높이. 층마다 같은 바닥(건물 한 층).
// 북쪽 띠(z 0 ~ bandDepth) = 승강기·출고대기 줄(북쪽 통로 북쪽) + 작업장. 그 남쪽 = 팔레트 랙 묶음(12개 × 양면 24개, 지게차 통로 3.0m).
// 온도 방(사용자 2026-11-25 지시문 §2·§3): 5F 냉동 = 냉동 랙 + 그 앞 띠(냉동 전실 — 피킹 선반·DPS 박스 컨베이어),
// 6F = 승강기·출고대기 줄을 뺀 층 전체가 냉장 방(서쪽 가공품 랙 · 가운데 피킹 선반 · 동쪽 라인 → 분배 → 야채 바닥 레인).
// 방 밖(승강기·출고대기)으로는 닫은 박스와 R/T 만 나간다(에어커튼). 7F H 작은 비식재는 오토스토어(§5).
// 위치 코드 형식(CDC01-구역-층-통로-베이-단-슬롯)은 그대로 [정본 CDC-3].

import { AISLE_PITCH, AUTOSTORE, B1_DOCKS, BUILDING, CAPACITY, CDC_FACTS, CENTER_ID, CHILLED_RACK, FLOOR_PYEONG, LIFTS_PER_FLOOR, PYEONG_M2, RACK, SHELF, SKU_PLACE, SKU_TARGET, STAGING_SLOTS, STORE, VEG_LANES } from '../config';
import { CHILGOK_FLOORS, type EquipKind, type FloorNo, type FloorSpec, type RackZoneSpec, type Temp } from './sites/chilgok';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** PICK_FACE = 피킹 칸(선반·랙 1단 박스 피킹면·야채 바닥 레인·오토스토어 칸), RESERVE = 팔레트 랙 보관 칸 */
export type LocationType = 'PICK_FACE' | 'RESERVE' | 'STAGING' | 'DOCK';

/** 랙 칸 또는 비랙 위치. code 는 계약 LocationCode 7구간 [정본 CDC-3·5] */
export interface Location {
  code: string;
  /** 화면 번호판 축약(개념도 CDC-04) — 예 C-02-24-3-1 */
  short: string;
  floor: FloorNo | 'B1';
  zone: string;
  temp: Temp;
  type: LocationType;
  aisle: number;
  bay: number;
  level: number;
  slot: number;
  /** 유닛 용량 — 계산값(CAPACITY·SHELF·AUTOSTORE) */
  capacity: number;
  /** 랙·선반 칸이 통로를 보는 쪽(x 방향 ±1) */
  face?: 1 | -1;
  /** 칸 중심(표시용) */
  pos: { x: number; y: number; z: number };
  /** 오토스토어 칸(통 안 칸) — 선반을 그리지 않고, 집는 곳은 포트. binNo = 통 번호 */
  bin?: true;
  binNo?: number;
  /** 야채 바닥 적치 레인 자리 */
  lane?: true;
}

export interface RackRow {
  zone: string;
  temp: Temp;
  aisle: number;
  /** 'E' = 홀수 베이(통로 동쪽), 'W' = 짝수 베이(서쪽) */
  side: 'E' | 'W';
  cx: number;
  z0: number;
  z1: number;
  levels: number;
}

export interface Aisle {
  zone: string;
  temp: Temp;
  no: number;
  cx: number;
  /** 번호판 — 사진처럼 랙 끝 위 흰 판(예 C02) */
  plate: string;
  /** 선반 통로 남북 끝(선반 블록마다) */
  z0?: number;
  z1?: number;
}

export interface ZoneArea {
  id: string;
  label: string;
  temp: Temp | null;
  kind: 'RACK' | 'BAND' | 'EQUIP' | 'SHELF';
  rect: Rect;
}

export interface Equip {
  kind: EquipKind;
  label: string;
  rect: Rect;
  /** 입고 검수 온도대 */
  temp?: Temp;
}

export interface Lift {
  no: number;
  /** 92 승강기 반출 문 코드 [정본 CDC-5] */
  code: string;
  rect: Rect;
}

/** 피킹 선반 한 줄(통로 한쪽) — MFC 시뮬레이터 선반 모양 */
export interface ShelfRow {
  zone: string;
  temp: Temp;
  aisle: number;
  side: 'E' | 'W';
  /** 선반 앞뒤 중심 x */
  cx: number;
  z0: number;
  z1: number;
  units: number;
}

/** 보관 방 — 팔레트 랙 구역(문서 보관 평수와 비교) */
export interface Room {
  key: string;
  temp: Temp;
  rect: Rect;
}

/** 온도 방 문 — 지게차 출입문 · 박스·R/T 반출 에어커튼 · 냉동 전실 문 [사용자 §2] */
export interface Door {
  kind: 'FORKLIFT' | 'AIR_CURTAIN' | 'ANTEROOM';
  /** 벽 위 문 구간(벽이 x 방향이면 z0 = z1) */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** 온도 관리 방(냉동·냉장) — 사각형 여럿의 합, 둘레에 단열 패널 벽 [사용자 §2] */
export interface ColdRoom {
  temp: 'FROZEN' | 'CHILLED';
  label: string;
  rects: Rect[];
  /** 벽(사각형 합의 바깥 둘레 선분, 건물 바깥벽과 겹치는 것은 뺌) */
  walls: { x0: number; z0: number; x1: number; z1: number }[];
  doors: Door[];
}

/** 걷는 길 — 사람·카트는 이 선들만 따라 움직인다(설계 §10 navgrid 대신 단순 통로망 [시뮬]) */
export interface WalkNet {
  /** 북쪽 통로(승강기·출고대기 앞) z · 그 통로가 뻗는 x 끝 */
  northZ: number;
  northX1: number;
  /** 작업장 남쪽 가로 통로 z(선반 통로 남쪽 끝) */
  roomZ: number;
  /** 랙 앞 가로 통로 z */
  rackZ: number;
  /** 북쪽 통로 ↔ 안쪽 통로 잇는 남북 통로 x 들(첫째 = 서쪽 벽) — 온도 방 문 자리 */
  links: number[];
  /** 서쪽 벽 연결 통로(= links[0]) */
  westX: number;
}

export interface FloorLayout {
  floor: FloorNo;
  label: string;
  spec: FloorSpec;
  zones: ZoneArea[];
  rooms: Room[];
  coldRooms: ColdRoom[];
  rows: RackRow[];
  aisles: Aisle[];
  /** 팔레트 랙 칸(1단 박스 피킹면은 PICK_FACE) */
  locations: Location[];
  staging: Location[];
  /** 피킹 칸 — 선반 · 야채 레인 · 오토스토어 칸(PICK_FACE) */
  shelves: Location[];
  shelfRows: ShelfRow[];
  /** 선반 통로 — 판 번호(예 C61)와 걷는 중심 x */
  shelfAisles: Aisle[];
  walk: WalkNet;
  lifts: Lift[];
  equipment: Equip[];
  /** 이 층 배치 면적(평) — 보관(랙) · 그 밖 */
  layoutPyeong: { storage: number; band: number };
}

/** 오토스토어 계산(§5) — 그린 면적으로 들어가는 통 수 검증 */
export interface AutostoreInfo {
  rect: Rect;
  skus: number;
  compartments: number;
  bins: number;
  cells: number;
  /** 그린 면적에 실제로 들어가는 통 수(격자 칸 × 쌓는 단) */
  binsFit: number;
  nx: number;
  nz: number;
  ports: number;
  robots: number;
  capacity: number;
  floorLoadKgM2: number;
  floorLoadAllowedKgM2: number;
}

/** 용량·SKU 자리 계산(§4) */
export interface CapacityReport {
  byTemp: Record<Temp, { pallets: number; palletUnits: number; faces: number; shelves: number; shelfUnits: number; lanes: number; laneUnits: number; compartments: number; binUnits: number; skuSlots: number; skuTarget: number }>;
  total: number;
  target: number;
  shortfall: number;
  skuSlots: number;
  skuTarget: number;
  pallets: number;
  /** 모자라면 보완안(랙 높이 올리기는 빼고) */
  advice: string[];
}

export interface Layout {
  width: number;
  depth: number;
  bandDepth: number;
  floors: FloorLayout[];
  /** 지하 B1 차량 접안(90 DOCK) — 8,600평 밖 [사용자·정본 R-07] */
  docks: Location[];
  /** 지하 B1 설비(냉동 입고 검수 — 5F 자리 부족) */
  b1Equipment: Equip[];
  autostore: AutostoreInfo | null;
  capacity: CapacityReport;
  /** 칸 용량 합(계산값) */
  totalCapacity: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 계약 LocationCode — {센터}-{구역}-{층}-{통로}-{베이}-{단}-{슬롯} [정본 CDC-3] */
export function locationCode(zone: string, floor: FloorNo | 'B1', aisle: number, bay: number, level: number, slot: number): string {
  return `${CENTER_ID}-${zone}-${floor}-${pad2(aisle)}-${pad2(bay)}-${level}-${slot}`;
}

/** 계약 cdc-location-service.yaml LocationCode 패턴 */
export const LOCATION_CODE_PATTERN = /^[A-Z0-9]+-[A-Z]-[A-Z0-9]+-[0-9]{2}-[0-9]{2}-[0-9]+-[0-9]+$/;

/** 온도대 → 문서 보관 면적 이름(방) [정본 CDC-2] */
const ROOM_OF: Record<Temp, string> = { AMBIENT: '상온', FROZEN: '냉동', CHILLED: '냉장' };
/** 랙 묶음 한 줄 길이 = 랙 12개 × 2.6m [사용자 2026-11-25] */
export const BUNDLE_LEN = RACK.bundleBays * RACK.bayW;

/** 보관 방 깊이(남북) — 가로 통로·묶음 줄 번갈아 */
export function storageDepth(): number {
  return RACK.crossAisle * (STORE.bundleRows + 1) + STORE.bundleRows * BUNDLE_LEN;
}

/** 건물 — 폭 = 보관이 가장 넓은 층의 보관 폭(문서 평수), 깊이 = 층 면적 ÷ 폭 [가정] */
export function building() {
  const Ds = storageDepth();
  const storageM2 = (f: FloorSpec) => Object.values(f.docPyeong.storage).reduce((a, b) => a + b, 0) * PYEONG_M2;
  const width = Math.max(...CHILGOK_FLOORS.map((f) => storageM2(f) / Ds));
  const depth = (Math.max(...Object.values(FLOOR_PYEONG)) * PYEONG_M2) / width;
  return { width, depth, bandDepth: depth - Ds, Ds };
}

/** 설비 구역 id — 입고 검수는 온도대마다 하나라 온도를 붙인다 */
export function equipZoneId(floor: FloorNo | 'B1', e: { kind: EquipKind; temp?: Temp }): string {
  return `${floor}-${e.kind}${e.temp ? `-${e.temp}` : ''}`;
}

/** 통로 수를 구역 몫(share)대로 — 최대 나머지, 구역마다 1 이상 */
function splitAisles(zs: RackZoneSpec[], nA: number): number[] {
  const tot = zs.reduce((s, z) => s + z.share, 0);
  const ex = zs.map((z) => (z.share / tot) * nA);
  const got = ex.map((e) => Math.max(1, Math.floor(e)));
  let left = nA - got.reduce((a, b) => a + b, 0);
  for (const i of ex.map((e, i) => [e % 1, i] as const).sort((a, b) => b[0] - a[0]).map((p) => p[1])) {
    if (left <= 0) break;
    got[i]++;
    left--;
  }
  return got;
}

/** 랙 묶음 수 → 폭 */
const rackWidth = (aisles: number) => RACK.aisleW + (aisles - 1) * AISLE_PITCH;
/** 폭 → 통로 수 */
const aislesFit = (w: number) => Math.floor((w - RACK.aisleW) / AISLE_PITCH) + 1;

/** 층 하나를 만드는 도구 — 칸·선반·설비를 모은다 */
class FloorBuilder {
  readonly zones: ZoneArea[] = [];
  readonly rows: RackRow[] = [];
  readonly aisles: Aisle[] = [];
  readonly locations: Location[] = [];
  readonly shelves: Location[] = [];
  readonly shelfRows: ShelfRow[] = [];
  readonly shelfAisles: Aisle[] = [];
  readonly equipment: Equip[] = [];
  readonly rooms: Room[] = [];
  readonly coldRooms: ColdRoom[] = [];
  readonly staging: Location[] = [];
  readonly lifts: Lift[] = [];
  /** 구역마다 다음 선반 통로 번호 */
  private nextShelfAisle = new Map<string, number>();

  constructor(
    readonly spec: FloorSpec,
    readonly B: { width: number; depth: number; bandDepth: number },
  ) {}

  get floor() {
    return this.spec.floor;
  }
  get rackZ0() {
    return this.B.bandDepth + RACK.crossAisle;
  }
  zone(letter: string) {
    return this.spec.zones.find((z) => z.letter === letter)!;
  }

  /** 팔레트 랙 — 구역들을 [x0, x1] 안 가운데에, 통로 | 묶음 | … | 통로. 랙 1단은 faceZones 면 PICK_FACE(박스 피킹면) */
  racks(zs: { spec: RackZoneSpec; aisles: number }[], x0: number, x1: number, roomKey: string) {
    const nA = zs.reduce((s, z) => s + z.aisles, 0);
    const w = rackWidth(nA);
    if (w > x1 - x0 + 1e-6) throw new Error(`${this.floor}F ${roomKey} 랙 ${nA}통로(${w.toFixed(1)}m)가 폭 ${(x1 - x0).toFixed(1)}m 를 넘음`);
    const off = x0 + (x1 - x0 - w) / 2;
    const cxOf = (i: number) => off + RACK.aisleW / 2 + i * AISLE_PITCH;
    const segZ0 = (s: number) => this.rackZ0 + s * (BUNDLE_LEN + RACK.crossAisle);
    let ai = 0;
    zs.forEach(({ spec: z, aisles: n }, zi) => {
      const first = ai;
      const face = SKU_PLACE.faceZones.includes(z.letter);
      for (let no = 1; no <= n; no++, ai++) {
        const cx = cxOf(ai);
        this.aisles.push({ zone: z.letter, temp: z.temp, no, cx, plate: `${z.letter}${pad2(no)}` });
        for (const side of ['E', 'W'] as const) {
          if (side === 'W' && ai === 0) continue;
          if (side === 'E' && ai === nA - 1) continue;
          const rx = cx + (side === 'E' ? 1 : -1) * (RACK.aisleW / 2 + RACK.depth / 2);
          for (let s = 0; s < STORE.bundleRows; s++) {
            const zz0 = segZ0(s);
            this.rows.push({ zone: z.letter, temp: z.temp, aisle: no, side, cx: rx, z0: zz0, z1: zz0 + BUNDLE_LEN, levels: z.levels });
            for (let k = 0; k < RACK.bundleBays; k++) {
              const j = s * RACK.bundleBays + k;
              const bay = side === 'E' ? 2 * j + 1 : 2 * j + 2;
              for (let level = 1; level <= z.levels; level++) {
                for (let slot = 1; slot <= RACK.slots; slot++) {
                  this.locations.push({
                    code: locationCode(z.letter, this.floor, no, bay, level, slot),
                    short: `${z.letter}-${pad2(no)}-${pad2(bay)}-${level}-${slot}`,
                    floor: this.floor,
                    zone: z.letter,
                    temp: z.temp,
                    type: face && level === 1 ? 'PICK_FACE' : 'RESERVE',
                    aisle: no,
                    bay,
                    level,
                    slot,
                    capacity: CAPACITY.palletUnitsByZone[z.letter] ?? CAPACITY.palletUnits[z.temp],
                    face: side === 'E' ? -1 : 1,
                    pos: { x: rx, y: (level - 0.5) * RACK.levelH, z: zz0 + k * RACK.bayW + (slot - 0.5) * (RACK.bayW / RACK.slots) },
                  });
                }
              }
            }
          }
        }
      }
      const zx0 = zi === 0 ? x0 : (cxOf(first - 1) + cxOf(first)) / 2;
      const zx1 = zi === zs.length - 1 ? x1 : (cxOf(ai - 1) + cxOf(ai)) / 2;
      this.zones.push({ id: `${this.floor}-${z.letter}`, label: z.label, temp: z.temp, kind: 'RACK', rect: { x0: zx0, z0: this.B.bandDepth, x1: zx1, z1: this.B.depth } });
    });
    this.rooms.push({ key: roomKey, temp: zs[0].spec.temp, rect: { x0, z0: this.B.bandDepth, x1, z1: this.B.depth } });
  }

  /**
   * 피킹 선반 — [rect] 안에 남북으로 뻗은 선반 통로(MFC 선반 1.25m · 5단 × 3칸). need 칸 이상이 되게 통로 수를 정하고, 블록 여럿(zs)에 나눠 놓는다.
   * 통로 번호는 구역마다 61 부터 이어 간다 [시뮬 R-13]. 쓴 폭(m)을 돌려준다.
   */
  shelvesIn(letter: string, rects: Rect[], need: number, label?: string, idSuffix = ''): number {
    const z = this.zone(letter);
    const pitch = SHELF.depth * 2 + SHELF.aisleW + 0.6;
    const blocks = rects.map((r) => ({ r, units: Math.floor((r.z1 - r.z0 - 0.8) / SHELF.unitLen) }));
    const perAisleAll = blocks.reduce((s, b) => s + b.units * 2 * SHELF.levels * SHELF.slots, 0);
    const n = Math.max(1, Math.ceil(need / perAisleAll));
    const w = n * pitch;
    for (const { r } of blocks) if (w > r.x1 - r.x0 + 0.01) throw new Error(`${this.floor}F ${letter} 선반 ${n}통로(${w.toFixed(1)}m)가 폭 ${(r.x1 - r.x0).toFixed(1)}m 를 넘음`);
    let no = this.nextShelfAisle.get(letter) ?? SHELF.aisleBase;
    for (const { r, units } of blocks) {
      const uz0 = r.z0 + 0.4;
      for (let k = 0; k < n; k++, no++) {
        if (no >= 90) throw new Error(`${this.floor}F ${letter} 선반 통로 번호가 89 를 넘음`);
        const cx = r.x0 + k * pitch + pitch / 2;
        this.shelfAisles.push({ zone: letter, temp: z.temp, no, cx, plate: `${letter}${no}`, z0: uz0, z1: uz0 + units * SHELF.unitLen });
        for (const side of ['E', 'W'] as const) {
          const rx = cx + (side === 'E' ? 1 : -1) * (SHELF.aisleW / 2 + SHELF.depth / 2);
          this.shelfRows.push({ zone: letter, temp: z.temp, aisle: no, side, cx: rx, z0: uz0, z1: uz0 + units * SHELF.unitLen, units });
          for (let j = 0; j < units; j++) {
            const bay = side === 'E' ? 2 * j + 1 : 2 * j + 2;
            for (let level = 1; level <= SHELF.levels; level++) {
              for (let slot = 1; slot <= SHELF.slots; slot++) {
                this.shelves.push({
                  code: locationCode(letter, this.floor, no, bay, level, slot),
                  short: `${letter}-${no}-${pad2(bay)}-${level}-${slot}`,
                  floor: this.floor,
                  zone: letter,
                  temp: z.temp,
                  type: 'PICK_FACE',
                  aisle: no,
                  bay,
                  level,
                  slot,
                  capacity: SHELF.slotUnits,
                  face: side === 'E' ? -1 : 1,
                  pos: { x: rx, y: 0.15 + ((level - 1) * (SHELF.height - 0.25)) / SHELF.levels, z: uz0 + j * SHELF.unitLen + ((slot - 0.5) * SHELF.unitLen) / SHELF.slots },
                });
              }
            }
          }
        }
      }
      this.zones.push({ id: `${this.floor}-${letter}-SHELF${idSuffix}${rects.length > 1 ? `-${rects.indexOf(r) + 1}` : ''}`, label: label ?? `${z.label} 피킹 선반`, temp: z.temp, kind: 'SHELF', rect: { x0: r.x0, z0: r.z0, x1: r.x0 + w, z1: r.z1 } });
    }
    this.nextShelfAisle.set(letter, no);
    return w;
  }

  /** 야채 바닥 적치 레인(6F 냉장) — 레인 남북, 자리 하나 = 팔레트 하나. 통로 VEG_LANES.aisle, 베이 = 레인, 슬롯 = 자리 [가정] */
  vegLanes(letter: string, r: Rect, need: number) {
    const z = this.zone(letter);
    const lanes = Math.floor((r.x1 - r.x0 + VEG_LANES.gap) / (VEG_LANES.laneW + VEG_LANES.gap));
    const per = Math.floor((r.z1 - r.z0 - 1) / VEG_LANES.posLen);
    if (lanes * per < need) throw new Error(`${this.floor}F 야채 레인 ${lanes * per}자리 < ${need}`);
    for (let l = 0; l < lanes; l++) {
      const x = r.x0 + VEG_LANES.laneW / 2 + l * (VEG_LANES.laneW + VEG_LANES.gap);
      for (let p = 0; p < per; p++) {
        this.shelves.push({
          code: locationCode(letter, this.floor, VEG_LANES.aisle, l + 1, 1, p + 1),
          short: `${letter}-${VEG_LANES.aisle}-${pad2(l + 1)}-${p + 1}`,
          floor: this.floor,
          zone: letter,
          temp: z.temp,
          type: 'PICK_FACE',
          aisle: VEG_LANES.aisle,
          bay: l + 1,
          level: 1,
          slot: p + 1,
          capacity: CAPACITY.vegLaneUnits,
          pos: { x, y: 0.5, z: r.z0 + 0.5 + (p + 0.5) * VEG_LANES.posLen },
          lane: true,
        });
      }
    }
    this.equipment.push({ kind: 'VEG_LANES', label: '야채 바닥 적치 레인', rect: r, temp: z.temp });
  }

  /** 오토스토어(7F H) — SKU 수 → 칸 → 통 → 격자. 통 위치 코드 = 통로 61~ · 베이 = 격자 칸 · 단 = 쌓은 높이 · 슬롯 = 통 안 칸 */
  autostore(letter: string, x0: number, z0: number, z1: number, maxW: number): AutostoreInfo {
    const z = this.zone(letter);
    const A = AUTOSTORE;
    const compartments = SKU_PLACE.autostore * A.compartmentsPerSku;
    const bins = Math.ceil(compartments / A.compartmentsPerBin);
    const cells = Math.ceil(bins / A.stack);
    const portStrip = 2.3;
    const nz = Math.max(1, Math.floor((z1 - z0 - portStrip - 0.5) / A.cell.z));
    const nx = Math.ceil(cells / nz);
    const w = nx * A.cell.x + 1;
    if (w > maxW) throw new Error(`${this.floor}F 오토스토어 폭 ${w.toFixed(1)}m > ${maxW.toFixed(1)}m`);
    const rect = { x0, z0, x1: x0 + w, z1 };
    const gx0 = x0 + 0.5;
    // 포트는 남쪽(작업장 남쪽 통로 쪽) 띠
    const gz0 = z0 + 0.5;
    let made = 0;
    for (let b = 0; b < bins; b++) {
      const c = Math.floor(b / A.stack);
      const lv = (b % A.stack) + 1;
      const col = Math.floor(c / nz);
      const row = c % nz;
      const aisle = SHELF.aisleBase + Math.floor(c / 99);
      const bay = (c % 99) + 1;
      for (let s = 1; s <= A.compartmentsPerBin && made < compartments; s++, made++) {
        this.shelves.push({
          code: locationCode(letter, this.floor, aisle, bay, lv, s),
          short: `${letter}-${aisle}-${pad2(bay)}-${lv}-${s}`,
          floor: this.floor,
          zone: letter,
          temp: z.temp,
          type: 'PICK_FACE',
          aisle,
          bay,
          level: lv,
          slot: s,
          capacity: A.unitsPerCompartment,
          pos: { x: gx0 + col * A.cell.x + A.cell.x / 2, y: lv * 0.27, z: gz0 + row * A.cell.z + A.cell.z / 2 },
          bin: true,
          binNo: b + 1,
        });
      }
    }
    this.equipment.push({ kind: 'AUTOSTORE', label: '오토스토어 (비식재 소형)', rect });
    const floorLoadAllowedKgM2 = BUILDING.floorLoadKgM2[this.floor];
    return {
      rect,
      skus: SKU_PLACE.autostore,
      compartments,
      bins,
      cells,
      binsFit: nx * nz * A.stack,
      nx,
      nz,
      ports: A.ports,
      robots: A.robots,
      capacity: compartments * A.unitsPerCompartment,
      floorLoadKgM2: A.floorLoadKgM2,
      floorLoadAllowedKgM2,
    };
  }

  equip(kind: EquipKind, label: string, rect: Rect, temp?: Temp) {
    this.equipment.push({ kind, label, rect, temp });
  }

  /** 북쪽 줄 — 서쪽 끝 승강기, 그 옆 출고대기(91) */
  liftsAndStaging() {
    const liftW = 4.0;
    for (let i = 0; i < LIFTS_PER_FLOOR; i++) {
      this.lifts.push({ no: i + 1, code: locationCode(this.spec.liftLetter, this.floor, 92, i + 1, 0, 1), rect: { x0: 1 + i * (liftW + 1), z0: 0.5, x1: 1 + i * (liftW + 1) + liftW, z1: 0.5 + liftW } });
    }
    const liftEnd = 1 + LIFTS_PER_FLOOR * (liftW + 1);
    const slotW = 1.4;
    let sx = liftEnd + 2;
    this.spec.stagingLetters.forEach((letter, li) => {
      const temp: Temp = letter === 'A' ? 'FROZEN' : letter === 'B' ? 'CHILLED' : 'AMBIENT';
      const per = this.spec.stagingLetters.length > 1 ? STAGING_SLOTS / 2 : STAGING_SLOTS;
      for (let k = 1; k <= per; k++) {
        const row = (k - 1) % 2;
        const col = Math.floor((k - 1) / 2);
        this.staging.push({
          code: locationCode(letter, this.floor, 91, k, 0, 1),
          short: `PPC-${pad2(k)}${this.spec.stagingLetters.length > 1 ? letter : ''}`,
          floor: this.floor,
          zone: letter,
          temp,
          type: 'STAGING',
          aisle: 91,
          bay: k,
          level: 0,
          slot: 1,
          capacity: 0,
          pos: { x: sx + col * slotW + slotW / 2, y: 0, z: 1.5 + row * 2.2 },
        });
      }
      sx += Math.ceil(per / 2) * slotW + (li === 0 ? 3 : 0);
    });
    return sx;
  }

  /** 출고대기 구역 글자(letter)의 x 범위 */
  stagingSpan(letter: string): [number, number] {
    const xs = this.staging.filter((s) => s.zone === letter).map((s) => s.pos.x);
    return [Math.min(...xs) - 1.5, Math.max(...xs) + 1.5];
  }

  /** 온도 방 — 사각형 합의 바깥 둘레를 벽으로(건물 바깥벽과 겹치는 선은 뺀다), 문은 따로 */
  coldRoom(temp: 'FROZEN' | 'CHILLED', rects: Rect[], doors: Door[]) {
    const walls = perimeter(rects).filter((s) => !onOuterWall(s, this.B.width, this.B.depth));
    this.coldRooms.push({ temp, label: BUILDING.roomTempLabel[temp], rects, walls, doors });
  }

  done(walk: WalkNet): FloorLayout {
    for (const e of this.equipment) this.zones.push({ id: equipZoneId(this.floor, e), label: e.label, temp: e.temp ?? null, kind: 'EQUIP', rect: e.rect });
    const m2 = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);
    const storageM2 = this.rooms.reduce((s, r) => s + m2(r.rect), 0);
    return {
      floor: this.floor,
      label: this.spec.label,
      spec: this.spec,
      zones: this.zones,
      rooms: this.rooms,
      coldRooms: this.coldRooms,
      rows: this.rows,
      aisles: this.aisles,
      locations: this.locations,
      staging: this.staging,
      shelves: this.shelves,
      shelfRows: this.shelfRows,
      shelfAisles: this.shelfAisles,
      walk,
      lifts: this.lifts,
      equipment: this.equipment,
      layoutPyeong: { storage: storageM2 / PYEONG_M2, band: (this.B.width * this.B.depth - storageM2) / PYEONG_M2 },
    };
  }
}

/** 축에 나란한 사각형 합의 바깥 둘레 선분(0.5m 격자로 계산) */
function perimeter(rects: Rect[]): { x0: number; z0: number; x1: number; z1: number }[] {
  const g = 0.5;
  const inside = (x: number, z: number) => rects.some((r) => x > r.x0 + 1e-6 && x < r.x1 - 1e-6 && z > r.z0 + 1e-6 && z < r.z1 - 1e-6);
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  // 가로 선(z 고정)
  for (const z of zs) {
    let start: number | null = null;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    for (let x = x0; x <= x1 + 1e-6; x += g) {
      const mid = x + g / 2;
      const edge = mid < x1 && inside(mid, z - 0.01) !== inside(mid, z + 0.01);
      if (edge && start === null) start = x;
      if (!edge && start !== null) {
        out.push({ x0: start, z0: z, x1: Math.min(x, x1), z1: z });
        start = null;
      }
    }
    if (start !== null) out.push({ x0: start, z0: z, x1, z1: z });
  }
  // 세로 선(x 고정)
  for (const x of xs) {
    let start: number | null = null;
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    for (let z = z0; z <= z1 + 1e-6; z += g) {
      const mid = z + g / 2;
      const edge = mid < z1 && inside(x - 0.01, mid) !== inside(x + 0.01, mid);
      if (edge && start === null) start = z;
      if (!edge && start !== null) {
        out.push({ x0: x, z0: start, x1: x, z1: Math.min(z, z1) });
        start = null;
      }
    }
    if (start !== null) out.push({ x0: x, z0: start, x1: x, z1 });
  }
  return out;
}
const onOuterWall = (s: { x0: number; z0: number; x1: number; z1: number }, W: number, D: number) =>
  (s.z0 === s.z1 && (Math.abs(s.z0) < 0.01 || Math.abs(s.z0 - D) < 0.01)) || (s.x0 === s.x1 && (Math.abs(s.x0) < 0.01 || Math.abs(s.x0 - W) < 0.01));

let layoutCache: Layout | null = null;

export function buildLayout(): Layout {
  if (layoutCache) return layoutCache;
  const Bd = building();
  const { width, depth, bandDepth, Ds } = Bd;
  const northZ = SHELF.northStrip - 0.6;
  const sz1 = bandDepth - 1.6;
  const roomZ = bandDepth - 0.8;
  // 휠소터 줄(북쪽 통로 바로 남쪽)·DAS 존·선반 블록 시작 [사용자 §9 — 휠소터 끝·롤테이너·DAS 존이 출고대기 바로 앞]
  const SORT_Z0 = northZ + 0.9;
  const SORT_Z1 = SORT_Z0 + 1.2;
  const DAS_Z0 = SORT_Z1 + 0.5;
  const rackZ = bandDepth + RACK.crossAisle / 2;
  const specOf = (fl: FloorNo) => CHILGOK_FLOORS.find((f) => f.floor === fl)!;
  const roomW = (spec: FloorSpec, key: string) => (spec.docPyeong.storage[key] * PYEONG_M2) / Ds;

  // ── 5F 상온(C·D·E·F) · 냉동(A) ────────────────────────
  const f5 = new FloorBuilder(specOf(5), Bd);
  const s5 = f5.spec;
  const amb5 = roomW(s5, '상온');
  const amb5Zones = s5.zones.filter((z) => ROOM_OF[z.temp] === '상온');
  const nA5 = aislesFit(amb5);
  f5.racks(
    amb5Zones.map((z, i) => ({ spec: z, aisles: splitAisles(amb5Zones, nA5)[i] })),
    0,
    amb5,
    '상온',
  );
  const frzX0 = amb5;
  const nAf = aislesFit(width - frzX0);
  f5.racks([{ spec: f5.zone('A'), aisles: nAf }], frzX0, width, '냉동');
  f5.liftsAndStaging();
  // [사용자 2026-11-25 §9] 출고 흐름: 상품 박스 → 컨베이어 → 휠소터 ─ 박스째: PPC 롤테이너 슈트로 / 낱개: DAS 존 라인. DAS·롤테이너는 출고대기 바로 앞.
  const [c0, c1] = f5.stagingSpan('C');
  const [a0] = f5.stagingSpan('A');
  f5.equip('WHEEL_SORTER', '휠소터 (상온 — 박스째 → PPC 슈트 / 낱개 → DAS)', { x0: c0, z0: SORT_Z0, x1: amb5 - 0.6, z1: SORT_Z1 }, 'AMBIENT');
  f5.equip('DAS', 'DAS 존 (상온)', { x0: c0, z0: DAS_Z0, x1: c1, z1: sz1 }, 'AMBIENT');
  f5.shelvesIn('E', [{ x0: 2.5, z0: DAS_Z0, x1: c0 - 1, z1: sz1 }], SKU_PLACE.efShelf);
  f5.shelvesIn('F', [{ x0: c1 + 1, z0: DAS_Z0, x1: amb5 - 0.6, z1: sz1 }], SKU_PLACE.efShelf);
  // 냉동 전실: DPS 컨베이어(가운데 동서) — 위·아래 선반 블록을 지나 에어커튼 밖 냉동 휠소터 줄로, 슈트가 A 출고대기 롤테이너로
  const frzLineZ0 = 5.0;
  const frzLineZ1 = 6.2;
  f5.equip('WHEEL_SORTER', '휠소터 (냉동 — DPS 박스 → PPC 슈트)', { x0: a0, z0: frzLineZ0, x1: frzX0, z1: frzLineZ1 }, 'FROZEN');
  f5.equip('DPS', 'DPS 컨베이어 (냉동 전실 — 구역마다 불·수량)', { x0: frzX0, z0: frzLineZ0, x1: width - 0.5, z1: frzLineZ1 });
  f5.shelvesIn(
    'A',
    [
      { x0: frzX0 + 1.2, z0: 0.4, x1: width - 0.3, z1: frzLineZ0 - 0.3 },
      { x0: frzX0 + 1.2, z0: frzLineZ1 + 0.3, x1: width - 0.3, z1: sz1 },
    ],
    SKU_TARGET.FROZEN,
    '냉동 A 피킹 선반 (DPS 구역)',
  );
  f5.coldRoom(
    'FROZEN',
    [
      { x0: frzX0, z0: 0, x1: width, z1: bandDepth },
      { x0: frzX0, z0: bandDepth, x1: width, z1: depth },
    ],
    [
      { kind: 'AIR_CURTAIN', x0: frzX0, z0: frzLineZ0 - 0.1, x1: frzX0, z1: frzLineZ1 + 0.1 },
      { kind: 'ANTEROOM', x0: frzX0, z0: roomZ - 1.2, x1: frzX0, z1: roomZ + 1.2 },
      { kind: 'FORKLIFT', x0: frzX0, z0: rackZ - 2, x1: frzX0, z1: rackZ + 2 },
    ],
  );
  const L5 = f5.done({ northZ, northX1: frzX0 - 0.6, roomZ, rackZ, links: [1.2, c1 + 0.5], westX: 1.2 });

  // ── 7F 생활용품(G·H) ─────────────────────────────────
  const f7 = new FloorBuilder(specOf(7), Bd);
  const s7 = f7.spec;
  const amb7 = roomW(s7, '상온');
  const nA7 = aislesFit(amb7);
  f7.racks(
    s7.zones.map((z, i) => ({ spec: z, aisles: splitAisles(s7.zones, nA7)[i] })),
    0,
    amb7,
    '상온',
  );
  f7.liftsAndStaging();
  // 상온 SKU 8,500 = C·D·G·H 랙 1단 박스 피킹면 + E·F 선반 + 오토스토어 + G 선반(나머지)
  const faceCount = [...L5.locations, ...f7.locations].filter((l) => l.type === 'PICK_FACE').length;
  const gShelf = SKU_TARGET.AMBIENT - faceCount - SKU_PLACE.efShelf * 2 - SKU_PLACE.autostore;
  if (gShelf < 0) throw new Error(`상온 SKU 목표보다 피킹면이 많음(${faceCount})`);
  const [g0, g1] = f7.stagingSpan('G');
  f7.equip('DAS', 'DAS 존 (상온 생활용품)', { x0: g0, z0: DAS_Z0, x1: g1, z1: sz1 }, 'AMBIENT');
  const westUnits = Math.floor((sz1 - DAS_Z0 - 0.8) / SHELF.unitLen) * 2 * SHELF.levels * SHELF.slots;
  const westAisles = Math.floor((g0 - 1 - 2.5) / (SHELF.depth * 2 + SHELF.aisleW + 0.6));
  const gWest = Math.min(gShelf, westAisles * westUnits);
  f7.shelvesIn('G', [{ x0: 2.5, z0: DAS_Z0, x1: g0 - 1, z1: sz1 }], gWest, '생활용품 G 피킹 선반 (서쪽)', '-W');
  const gW = f7.shelvesIn('G', [{ x0: g1 + 1, z0: DAS_Z0, x1: width - 8, z1: sz1 }], gShelf - gWest, '생활용품 G 피킹 선반 (동쪽)', '-E');
  const autoX0 = g1 + 1 + gW + 1.0;
  const autoInfo = f7.autostore('H', autoX0, DAS_Z0, sz1, width - autoX0 - 0.5);
  f7.equip('WHEEL_SORTER', '휠소터 (생활용품 — 박스째 → PPC 슈트 / 낱개 → DAS)', { x0: g0, z0: SORT_Z0, x1: autoInfo.rect.x1, z1: SORT_Z1 }, 'AMBIENT');
  f7.equip('OFFICE', 'DC 관리자 사무실', { x0: amb7 + 1, z0: bandDepth + 1, x1: width - 1, z1: bandDepth + 18 });
  f7.equip('INBOUND', '입고 검수 (상온)', { x0: amb7 + 1, z0: bandDepth + 20, x1: width - 1, z1: bandDepth + 36 }, 'AMBIENT');
  const L7 = f7.done({ northZ, northX1: width - 1, roomZ, rackZ, links: [1.2, g1 + 0.5], westX: 1.2 });

  // ── 6F 냉장 — 층 전체가 냉장 방 ─────────────────────
  const f6 = new FloorBuilder(specOf(6), Bd);
  // 가공품 팔레트 랙 통로: 출발 10, 팔레트 칸 하한(18,000)을 지키도록 늘린다 [사용자 "용량 계산 결과로"]
  const others = L5.locations.length + L7.locations.length;
  const perAisle6 = 2 * RACK.bundleBays * 2 * STORE.bundleRows * RACK.slots * RACK.levels; // 묶음 하나 192 칸 → 통로 하나당 한 묶음
  let nB = CHILLED_RACK.startAisles;
  while (others + (nB - 1) * (perAisle6 / 2) < CHILLED_RACK.palletMin) nB++;
  const rack6W = rackWidth(nB) + 1;
  f6.racks([{ spec: f6.zone('B'), aisles: nB }], 0, rack6W, '냉장');
  f6.liftsAndStaging();
  const coldZ0 = SORT_Z0 - 0.25;
  // 냉장 피킹 선반(라인 상품 = 냉장 목표 − 야채): 랙 동쪽, 남북 두 블록
  const shX0 = rack6W + 1;
  const mid = bandDepth + 2 + (depth - bandDepth - 4) / 2;
  const shW = f6.shelvesIn(
    'B',
    [
      { x0: shX0, z0: bandDepth + 0.6, x1: width - 22, z1: mid - 0.8 },
      { x0: shX0, z0: mid + 0.8, x1: width - 22, z1: depth - 1.2 },
    ],
    SKU_TARGET.CHILLED - SKU_PLACE.veg,
    '냉장 B 피킹 선반 (라인 상품)',
  );
  // 냉장 방 안, 출고대기 바로 앞: 휠소터 줄 → DAS 존(컨베이어로 상품이 들어옴 — 핸드자키 대신, 사용자 §9). 동쪽: 분배(크레이트) → 야채 바닥 레인
  const [b0, b1] = f6.stagingSpan('B');
  const ex0 = shX0 + shW + 1.2;
  f6.equip('WHEEL_SORTER', '휠소터 (냉장 — 박스째 → PPC 슈트 / 낱개 → DAS)', { x0: b0, z0: SORT_Z0, x1: ex0 - 0.5, z1: SORT_Z1 }, 'CHILLED');
  f6.equip('DAS', 'DAS 존 (냉장)', { x0: b0, z0: DAS_Z0, x1: b1, z1: sz1 }, 'CHILLED');
  const splitZ1 = bandDepth + 10;
  f6.equip('SPLIT', '분배 (MFC 크레이트 — 출고 용기)', { x0: ex0, z0: DAS_Z0, x1: width - 1, z1: splitZ1 });
  f6.vegLanes('B', { x0: ex0, z0: splitZ1 + 1, x1: width - 1, z1: depth - 1 }, SKU_PLACE.veg);
  f6.equip('INBOUND', '입고 검수 (냉장)', { x0: 2, z0: DAS_Z0, x1: Math.min(16, b0 - 1), z1: sz1 }, 'CHILLED');
  f6.coldRoom(
    'CHILLED',
    [{ x0: 0, z0: coldZ0, x1: width, z1: depth }],
    [
      { kind: 'FORKLIFT', x0: 2.5, z0: coldZ0, x1: 6.5, z1: coldZ0 },
      { kind: 'AIR_CURTAIN', x0: b0, z0: coldZ0, x1: b1, z1: coldZ0 },
    ],
  );
  const L6 = f6.done({ northZ, northX1: width - 1, roomZ, rackZ, links: [4.5, (b0 + b1) / 2], westX: 4.5 });

  const floors = [L5, L6, L7];

  // ── B1 — 접안 + 냉동 입고 검수(5F 자리 부족 → 지하 도크 쪽) ──
  const docks: Location[] = [];
  let bay = 1;
  for (const d of B1_DOCKS) {
    const temp: Temp = d.temp === 'A' ? 'FROZEN' : d.temp === 'B' ? 'CHILLED' : 'AMBIENT';
    for (let i = 0; i < d.count; i++, bay++) {
      docks.push({ code: locationCode(d.temp, 'B1', 90, bay, 0, 1), short: `B1-${pad2(bay)}`, floor: 'B1', zone: d.temp, temp, type: 'DOCK', aisle: 90, bay, level: 0, slot: 1, capacity: 0, pos: { x: 6 + (bay - 1) * 4.5, y: 0, z: 2 } });
    }
  }
  const b1x0 = 6 + docks.length * 4.5 + 2;
  const b1Equipment: Equip[] = [
    { kind: 'INBOUND', label: '입고 검수 (냉동 — 지하 도크)', rect: { x0: b1x0, z0: -8.5, x1: b1x0 + 12, z1: -0.5 }, temp: 'FROZEN' },
    { kind: 'INBOUND', label: '입고 검수 (5F 상온 — 지하 도크)', rect: { x0: b1x0 + 13, z0: -8.5, x1: b1x0 + 25, z1: -0.5 }, temp: 'AMBIENT' },
  ];

  const capacity = capacityReport(floors);
  layoutCache = { width, depth, bandDepth, floors, docks, b1Equipment, autostore: autoInfo, capacity, totalCapacity: capacity.total };
  return layoutCache;
}

/** 용량·SKU 자리 계산(§4) — 총 용량은 계산값, 목표(520만·SKU)와 비교해 모자라면 보완안 */
export function capacityReport(floors: FloorLayout[]): CapacityReport {
  const temps: Temp[] = ['FROZEN', 'CHILLED', 'AMBIENT'];
  const byTemp = Object.fromEntries(
    temps.map((t) => {
      const pal = floors.flatMap((f) => f.locations).filter((l) => l.temp === t);
      const pick = floors.flatMap((f) => f.shelves).filter((l) => l.temp === t);
      const shelves = pick.filter((l) => !l.bin && !l.lane);
      const lanes = pick.filter((l) => l.lane);
      const comps = pick.filter((l) => l.bin);
      const faces = pal.filter((l) => l.type === 'PICK_FACE').length;
      const skuSlots = shelves.length + faces + lanes.length + Math.floor(comps.length / AUTOSTORE.compartmentsPerSku);
      return [
        t,
        {
          pallets: pal.length,
          palletUnits: pal.reduce((s, l) => s + l.capacity, 0),
          faces,
          shelves: shelves.length,
          shelfUnits: shelves.reduce((s, l) => s + l.capacity, 0),
          lanes: lanes.length,
          laneUnits: lanes.reduce((s, l) => s + l.capacity, 0),
          compartments: comps.length,
          binUnits: comps.reduce((s, l) => s + l.capacity, 0),
          skuSlots,
          skuTarget: SKU_TARGET[t],
        },
      ];
    }),
  ) as CapacityReport['byTemp'];
  const total = temps.reduce((s, t) => s + byTemp[t].palletUnits + byTemp[t].shelfUnits + byTemp[t].laneUnits + byTemp[t].binUnits, 0);
  const target = CDC_FACTS.capacityUnits;
  const skuSlots = temps.reduce((s, t) => s + byTemp[t].skuSlots, 0);
  const advice: string[] = [];
  const short = target - total;
  if (short > 0) {
    const per = CAPACITY.palletUnits.AMBIENT;
    advice.push(`보완안 1: 7F 동쪽 작업장(DT)·사무실 옆에 상온 랙 묶음 ${Math.ceil(short / (192 * per))}개 더 놓기(묶음 하나 192칸 × ${per}유닛) — 랙 높이는 천장 때문에 그대로`);
    advice.push(`보완안 2: 팔레트 칸 평균 유닛을 상온 ${per} → ${Math.ceil(per + short / Math.max(1, byTemp.AMBIENT.pallets))} 로(작은 상품을 섞은 팔레트) 또는 오토스토어 통 ${Math.ceil(short / (AUTOSTORE.unitsPerCompartment * AUTOSTORE.compartmentsPerBin))}개 늘리기`);
  }
  for (const t of temps) {
    const d = byTemp[t].skuTarget - byTemp[t].skuSlots;
    if (d > 0) advice.push(`${ROOM_OF[t]} SKU 자리 ${d.toLocaleString()} 모자람 — 선반 통로를 더 두거나 랙 1단 박스 피킹면을 늘리기`);
  }
  return { byTemp, total, target, shortfall: Math.max(0, short), skuSlots, skuTarget: SKU_TARGET.total, pallets: floors.reduce((s, f) => s + f.locations.length, 0), advice };
}

/** 구역별 SKU 수 — 그 구역 피킹 칸(선반·1단 피킹면·레인·오토스토어 SKU 자리)에서 [시뮬] */
export function skuQuota(): Map<string, number> {
  const L = buildLayout();
  const out = new Map<string, number>();
  for (const f of L.floors) {
    for (const z of f.spec.zones) {
      const faces = f.locations.filter((l) => l.zone === z.letter && l.type === 'PICK_FACE').length;
      const pick = f.shelves.filter((l) => l.zone === z.letter);
      let n = faces;
      if (z.letter === 'A') n += SKU_TARGET.FROZEN;
      else if (z.letter === 'B') n += SKU_TARGET.CHILLED;
      else if (z.letter === 'E' || z.letter === 'F') n += SKU_PLACE.efShelf;
      else if (z.letter === 'G') n += SKU_TARGET.AMBIENT - L.floors.flatMap((x) => x.locations).filter((l) => l.type === 'PICK_FACE' && l.temp === 'AMBIENT').length - SKU_PLACE.efShelf * 2 - SKU_PLACE.autostore;
      else if (z.letter === 'H') n += SKU_PLACE.autostore;
      void pick;
      out.set(z.letter, (out.get(z.letter) ?? 0) + n);
    }
  }
  return out;
}

/**
 * 피킹한 물건이 가는 출고대기(91) 자리 — 그 칸이 있는 층, 같은 온도대의 출고대기 구역 글자, MFC 자리 번호(PPC-01~05) [정본 CDC-5].
 * 5F 는 상온 C·냉동 A 두 줄, 6F 는 냉장 B, 7F 는 생활용품 G.
 */
export function stagingCodeFor(rackLocationCode: string, stagingNo: number): string {
  const [, zone, floorStr] = rackLocationCode.split('-');
  const floor = Number(floorStr) as FloorNo;
  const spec = CHILGOK_FLOORS.find((f) => f.floor === floor);
  if (!spec) throw new Error(`층 없음: ${rackLocationCode}`);
  const temp = spec.zones.find((z) => z.letter === zone)?.temp ?? 'AMBIENT';
  const want = temp === 'FROZEN' ? 'A' : temp === 'CHILLED' ? 'B' : null;
  const letter = (want && spec.stagingLetters.find((l) => l === want)) ?? spec.stagingLetters.find((l) => l !== 'A' && l !== 'B') ?? spec.stagingLetters[0];
  return locationCode(letter, floor, 91, stagingNo, 0, 1);
}
