// 칠곡 DC 층별 배치 — 센터 데이터(sites/chilgok.ts)를 받아 층·구역·랙·칸·비랙 위치를 만든다.
// 좌표 단위 m, x = 동쪽, z = 남쪽(화면 아래), y = 높이. 층마다 같은 바닥(건물 한 층).
// 북쪽 띠(z 0 ~ bandDepth, DT) = 승강기·출고대기 줄 + 그 남쪽 분류 설비. 그 남쪽 = 온도대 보관 방(문서 평수 그대로):
// 방 북쪽 블록 = 피킹 선반·오토스토어, 그 남쪽 = 팔레트 랙 묶음(12개 × 양면 24개, 지게차 통로가 남북으로 뻗고 묶음 사이 가로 통로).
// 팔레트 랙은 입고·적치 보관 자리이고 피킹은 선반에서 한다(사용자 2026-11-25).

import { AISLE_PITCH, B1_DOCKS, CAPACITY, CATALOG, CDC_FACTS, CENTER_ID, FLOOR_PYEONG, LIFTS_PER_FLOOR, PYEONG_M2, RACK, SHELF, STAGING_SLOTS, STORE } from '../config';
import { CHILGOK_FLOORS, type EquipKind, type FloorNo, type FloorSpec, type RackZoneSpec, type Temp } from './sites/chilgok';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** PICK_FACE = 피킹 선반 칸, RESERVE = 팔레트 랙 보관 칸 */
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
  /** 유닛 용량 — 모든 칸 합 + 오토스토어 = 520만 [고정] */
  capacity: number;
  /** 랙·선반 칸이 통로를 보는 쪽(x 방향 ±1) — 통로는 남북으로 뻗으니 칸 앞면은 늘 x 쪽. 정면 보기·칸 번호 붙이기용 */
  face?: 1 | -1;
  /** 칸 중심(표시용) */
  pos: { x: number; y: number; z: number };
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

/** 온도대 보관 방 — 문서 보관 평수 그대로 [정본 CDC-2, 사용자 2026-11-25] */
export interface Room {
  key: string;
  temp: Temp;
  rect: Rect;
}

/** 걷는 길 — 사람·카트는 이 선들만 따라 움직인다(설계 §10 navgrid 대신 단순 통로망 [시뮬]) */
export interface WalkNet {
  /** 북쪽 통로(승강기·출고대기 앞) z */
  northZ: number;
  /** 보관 방 북쪽 벽 앞 가로 통로 z(선반 통로 북쪽 끝) */
  roomZ: number;
  /** 랙 앞 가로 통로 z */
  rackZ: number;
  /** 서쪽 벽 쪽 남북 연결 통로 x */
  westX: number;
}

export interface FloorLayout {
  floor: FloorNo;
  label: string;
  spec: FloorSpec;
  zones: ZoneArea[];
  rooms: Room[];
  rows: RackRow[];
  aisles: Aisle[];
  locations: Location[];
  staging: Location[];
  /** 피킹 선반 칸(PICK_FACE) */
  shelves: Location[];
  shelfRows: ShelfRow[];
  /** 선반 통로 — 판 번호(예 C61)와 걷는 중심 x */
  shelfAisles: Aisle[];
  walk: WalkNet;
  lifts: Lift[];
  equipment: Equip[];
  /** 이 층에 쓴 배치 면적(평) — 문서 면적(spec.docPyeong)과 비교용 */
  layoutPyeong: { storage: number; band: number };
}

export interface Layout {
  width: number;
  depth: number;
  bandDepth: number;
  floors: FloorLayout[];
  /** 지하 B1 차량 접안(90 DOCK) — 8,600평 밖 [사용자·정본 R-07] */
  docks: Location[];
  autostore: { bins: number; unitsPerBin: number; capacity: number };
  /** 모든 칸 용량 + 오토스토어 = CDC_FACTS.capacityUnits */
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

/** 보관 방 깊이(남북) — 북쪽 선반 블록 + 가로 통로·묶음 줄 번갈아 */
export function storageDepth(): number {
  return STORE.shelfDepth + RACK.crossAisle * (STORE.bundleRows + 1) + STORE.bundleRows * BUNDLE_LEN;
}

interface RoomPlan {
  key: string;
  temp: Temp;
  x0: number;
  x1: number;
  /** 묶음 수(동서) — 통로 수 = 묶음 + 1 */
  bundles: number;
  /** 묶음·통로 무리를 방 가운데 두는 여백 */
  off: number;
  zones: { spec: RackZoneSpec; aisles: number }[];
}

interface SitePlan {
  width: number;
  depth: number;
  bandDepth: number;
  floors: { spec: FloorSpec; rooms: RoomPlan[]; storageEast: number }[];
}

let planCache: SitePlan | null = null;

/**
 * 건물·방 계획 — 문서 면적을 고정으로(사용자 2026-11-25 "문서 면적을 고정으로 하고 통로나 배치를 더 현실적으로").
 * 방(온도대 보관) 하나 = 문서 보관 평수 그대로의 직사각형(깊이 = storageDepth). 건물 폭 = 가장 넓은 층 보관 폭, 깊이 = 층 면적 ÷ 폭.
 * 나머지(북쪽 띠 + 방 동쪽 남는 폭) = DT(작업장) — 층 면적 − 보관 = 문서 DT.
 * 방 안 랙: 통로 | 묶음 | 통로 | … | 통로, 묶음 = 등 맞댄 두 줄 × 12개(24개), 통로 = 지게차 통로 [사용자·가정].
 */
export function sitePlan(): SitePlan {
  if (planCache) return planCache;
  const Ds = storageDepth();
  const storageM2 = (f: FloorSpec) => Object.values(f.docPyeong.storage).reduce((a, b) => a + b, 0) * PYEONG_M2;
  const width = Math.max(...CHILGOK_FLOORS.map((f) => storageM2(f) / Ds));
  const depth = (Math.max(...Object.values(FLOOR_PYEONG)) * PYEONG_M2) / width;
  const floors = CHILGOK_FLOORS.map((spec) => {
    let x = 0;
    const rooms: RoomPlan[] = [];
    for (const [key, py] of Object.entries(spec.docPyeong.storage)) {
      const w = (py * PYEONG_M2) / Ds;
      const zs = spec.zones.filter((z) => ROOM_OF[z.temp] === key);
      if (!zs.length) throw new Error(`${spec.floor}F ${key} 방에 구역 없음`);
      const bundles = Math.floor((w - RACK.aisleW) / AISLE_PITCH);
      const nA = bundles + 1;
      // 통로를 구역 몫(share)대로 — 최대 나머지, 구역마다 1 이상
      const tot = zs.reduce((s, z) => s + z.share, 0);
      const ex = zs.map((z) => (z.share / tot) * nA);
      const got = ex.map((e) => Math.max(1, Math.floor(e)));
      let left = nA - got.reduce((a, b) => a + b, 0);
      for (const i of ex.map((e, i) => [e % 1, i] as const).sort((a, b) => b[0] - a[0]).map((p) => p[1])) {
        if (left <= 0) break;
        got[i]++;
        left--;
      }
      rooms.push({ key, temp: zs[0].temp, x0: x, x1: x + w, bundles, off: (w - (RACK.aisleW + bundles * AISLE_PITCH)) / 2, zones: zs.map((spec, i) => ({ spec, aisles: got[i] })) });
      x += w;
    }
    return { spec, rooms, storageEast: x };
  });
  planCache = { width, depth, bandDepth: depth - Ds, floors };
  return planCache;
}

/** 구역별 팔레트 통로 수(계획에서) */
export function zoneAisles(): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of sitePlan().floors) for (const r of f.rooms) for (const z of r.zones) out.set(z.spec.letter, z.aisles);
  return out;
}

export function buildLayout(): Layout {
  const plan = sitePlan();
  const { width, depth, bandDepth } = plan;
  const roomZ0 = bandDepth;
  const rackZ0 = roomZ0 + STORE.shelfDepth + RACK.crossAisle;
  const segZ0 = (s: number) => rackZ0 + s * (BUNDLE_LEN + RACK.crossAisle);
  const northZ = SHELF.northStrip - 0.6;

  const floors: FloorLayout[] = plan.floors.map(({ spec, rooms: roomPlans, storageEast }) => {
    const zones: ZoneArea[] = [];
    const rows: RackRow[] = [];
    const aisles: Aisle[] = [];
    const locations: Location[] = [];
    const rooms: Room[] = [];
    zones.push({ id: `${spec.floor}-BAND`, label: '승강기·출고대기·분류', temp: null, kind: 'BAND', rect: { x0: 0, z0: 0, x1: width, z1: bandDepth } });

    for (const rp of roomPlans) {
      rooms.push({ key: rp.key, temp: rp.temp, rect: { x0: rp.x0, z0: roomZ0, x1: rp.x1, z1: depth } });
      const cxOf = (i: number) => rp.x0 + rp.off + RACK.aisleW / 2 + i * AISLE_PITCH;
      const nA = rp.bundles + 1;
      let ai = 0;
      rp.zones.forEach(({ spec: z, aisles: n }, zi) => {
        const first = ai;
        for (let no = 1; no <= n; no++, ai++) {
          const cx = cxOf(ai);
          aisles.push({ zone: z.letter, temp: z.temp, no, cx, plate: `${z.letter}${pad2(no)}` });
          // 통로 동쪽(E·홀수)·서쪽(W·짝수) — 방 양 끝 통로는 한쪽만(벽 쪽엔 랙 없음)
          for (const side of ['E', 'W'] as const) {
            if (side === 'W' && ai === 0) continue;
            if (side === 'E' && ai === nA - 1) continue;
            const rx = cx + (side === 'E' ? 1 : -1) * (RACK.aisleW / 2 + RACK.depth / 2);
            for (let s = 0; s < STORE.bundleRows; s++) {
              const z0 = segZ0(s);
              rows.push({ zone: z.letter, temp: z.temp, aisle: no, side, cx: rx, z0, z1: z0 + BUNDLE_LEN, levels: z.levels });
              for (let k = 0; k < RACK.bundleBays; k++) {
                const j = s * RACK.bundleBays + k;
                const bay = side === 'E' ? 2 * j + 1 : 2 * j + 2; // 북쪽에서 남쪽을 볼 때 왼쪽(동) 홀수·오른쪽(서) 짝수 [개념도]
                for (let level = 1; level <= z.levels; level++) {
                  for (let slot = 1; slot <= RACK.slots; slot++) {
                    locations.push({
                      code: locationCode(z.letter, spec.floor, no, bay, level, slot),
                      short: `${z.letter}-${pad2(no)}-${pad2(bay)}-${level}-${slot}`,
                      floor: spec.floor,
                      zone: z.letter,
                      temp: z.temp,
                      type: 'RESERVE',
                      aisle: no,
                      bay,
                      level,
                      slot,
                      capacity: 0,
                      face: side === 'E' ? -1 : 1,
                      pos: { x: rx, y: (level - 0.5) * RACK.levelH, z: z0 + k * RACK.bayW + (slot - 0.5) * (RACK.bayW / RACK.slots) },
                    });
                  }
                }
              }
            }
          }
        }
        // 구역 바닥 = 그 구역 통로들(경계는 이웃 통로 사이 가운데 — 묶음 등 맞댄 선), 방 북쪽 끝부터 남쪽 끝까지
        const x0 = zi === 0 ? rp.x0 : (cxOf(first - 1) + cxOf(first)) / 2;
        const x1 = zi === rp.zones.length - 1 ? rp.x1 : (cxOf(ai - 1) + cxOf(ai)) / 2;
        zones.push({ id: `${spec.floor}-${z.letter}`, label: z.label, temp: z.temp, kind: 'RACK', rect: { x0, z0: roomZ0, x1, z1: depth } });
      });
    }

    // 북쪽 띠: 서쪽 끝 승강기, 그 옆 출고대기, 동쪽에 띠 설비
    const lifts: Lift[] = [];
    const liftW = 4.0;
    for (let i = 0; i < LIFTS_PER_FLOOR; i++) {
      lifts.push({ no: i + 1, code: locationCode(spec.liftLetter, spec.floor, 92, i + 1, 0, 1), rect: { x0: 1 + i * (liftW + 1), z0: 0.5, x1: 1 + i * (liftW + 1) + liftW, z1: 0.5 + liftW } });
    }
    const liftEnd = 1 + LIFTS_PER_FLOOR * (liftW + 1);
    const staging: Location[] = [];
    const slotW = 1.4;
    let sx = liftEnd + 2;
    spec.stagingLetters.forEach((letter, li) => {
      const temp: Temp = letter === 'A' ? 'FROZEN' : letter === 'B' ? 'CHILLED' : 'AMBIENT';
      const per = spec.stagingLetters.length > 1 ? STAGING_SLOTS / 2 : STAGING_SLOTS;
      for (let k = 1; k <= per; k++) {
        const row = (k - 1) % 2;
        const col = Math.floor((k - 1) / 2);
        staging.push({
          code: locationCode(letter, spec.floor, 91, k, 0, 1),
          short: `PPC-${pad2(k)}${spec.stagingLetters.length > 1 ? letter : ''}`,
          floor: spec.floor,
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

    // 피킹 선반 — 그 온도대 방의 북쪽 블록(보관 면적 안, 사용자 2026-11-25), 구역마다 SKU 수만큼 칸, 통로 번호 61 부터 [시뮬 R-13]
    const shelves: Location[] = [];
    const shelfRows: ShelfRow[] = [];
    const shelfAisles: Aisle[] = [];
    const unitsPerSide = Math.floor((STORE.shelfDepth - 2.5) / SHELF.unitLen);
    const perAisle = unitsPerSide * 2 * SHELF.levels * SHELF.slots;
    const shelfPitch = SHELF.depth * 2 + SHELF.aisleW + 0.6;
    const quota = skuQuota();
    const shelfTarget = shelfTargets();
    const equipment: Equip[] = [];
    const uz0 = roomZ0 + 1.2;
    for (const rp of roomPlans) {
      let shx = rp.x0 + 2.5;
      for (const { spec: z } of rp.zones) {
        const need = Math.max(quota.get(z.letter) ?? 0, shelfTarget.get(z.letter) ?? 0);
        const nAisles = Math.max(1, Math.ceil(need / perAisle));
        const zx0 = shx - 0.3;
        for (let k = 0; k < nAisles; k++) {
          const no = SHELF.aisleBase + k;
          const cx = shx + shelfPitch / 2;
          shelfAisles.push({ zone: z.letter, temp: z.temp, no, cx, plate: `${z.letter}${no}` });
          for (const side of ['E', 'W'] as const) {
            const rx = cx + (side === 'E' ? 1 : -1) * (SHELF.aisleW / 2 + SHELF.depth / 2);
            shelfRows.push({ zone: z.letter, temp: z.temp, aisle: no, side, cx: rx, z0: uz0, z1: uz0 + unitsPerSide * SHELF.unitLen, units: unitsPerSide });
            for (let j = 0; j < unitsPerSide; j++) {
              const bay = side === 'E' ? 2 * j + 1 : 2 * j + 2;
              for (let level = 1; level <= SHELF.levels; level++) {
                for (let slot = 1; slot <= SHELF.slots; slot++) {
                  shelves.push({
                    code: locationCode(z.letter, spec.floor, no, bay, level, slot),
                    short: `${z.letter}-${no}-${pad2(bay)}-${level}-${slot}`,
                    floor: spec.floor,
                    zone: z.letter,
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
          shx += shelfPitch;
        }
        zones.push({ id: `${spec.floor}-${z.letter}-SHELF`, label: `${z.label} 피킹 선반`, temp: z.temp, kind: 'SHELF', rect: { x0: zx0, z0: roomZ0 + 0.6, x1: shx - 0.3, z1: roomZ0 + STORE.shelfDepth - 0.6 } });
        shx += 0.6;
      }
      if (shx > rp.x1 - 0.5) throw new Error(`${spec.floor}F ${rp.key} 방 선반이 방 폭을 넘음`);
      // 그 방 북쪽 블록 남는 폭 = 오토스토어(보관 면적 안 설비)
      for (const e of spec.equipment.filter((x) => x.where === 'storage' && x.room === rp.key)) {
        if (rp.x1 - 1 - (shx + 1.5) < 6) throw new Error(`${spec.floor}F ${rp.key} 오토스토어 자리 부족`);
        equipment.push({ kind: e.kind, label: e.label, rect: { x0: shx + 1.5, z0: roomZ0 + 1, x1: rp.x1 - 1, z1: roomZ0 + STORE.shelfDepth - 0.6 } });
      }
    }

    const band = spec.equipment.filter((e) => e.where === 'band');
    const bandX0 = sx + 2;
    const bandW = (width - bandX0 - 1) / Math.max(1, band.length);
    band.forEach((e, i) => equipment.push({ kind: e.kind, label: e.label, rect: { x0: bandX0 + i * bandW, z0: northZ + 1.5, x1: bandX0 + (i + 1) * bandW - 1, z1: bandDepth - 2.6 } }));
    const east = spec.equipment.filter((e) => e.where === 'east');
    if (east.length) {
      if (width - storageEast < 6) throw new Error(`${spec.floor}F 동쪽 작업장 폭 부족`);
      const h = (depth - bandDepth - 2) / east.length;
      east.forEach((e, i) => equipment.push({ kind: e.kind, label: e.label, rect: { x0: storageEast + 1, z0: bandDepth + 1 + i * h, x1: width - 1, z1: bandDepth + (i + 1) * h } }));
    } else if (width - storageEast > 2) {
      zones.push({ id: `${spec.floor}-DT`, label: '작업장 (DT)', temp: null, kind: 'BAND', rect: { x0: storageEast, z0: bandDepth, x1: width, z1: depth } });
    }
    for (const e of equipment) zones.push({ id: `${spec.floor}-${e.kind}`, label: e.label, temp: null, kind: 'EQUIP', rect: e.rect });

    const m2 = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);
    const storageM2 = rooms.reduce((s, r) => s + m2(r.rect), 0);
    return {
      floor: spec.floor,
      label: spec.label,
      spec,
      zones,
      rooms,
      rows,
      aisles,
      locations,
      staging,
      shelves,
      shelfRows,
      shelfAisles,
      walk: { northZ, roomZ: roomZ0 - 1.2, rackZ: roomZ0 + STORE.shelfDepth + RACK.crossAisle / 2, westX: 1.2 },
      lifts,
      equipment,
      layoutPyeong: { storage: storageM2 / PYEONG_M2, band: (width * depth - storageM2) / PYEONG_M2 },
    };
  });

  const docks: Location[] = [];
  let bay = 1;
  for (const d of B1_DOCKS) {
    const temp: Temp = d.temp === 'A' ? 'FROZEN' : d.temp === 'B' ? 'CHILLED' : 'AMBIENT';
    for (let i = 0; i < d.count; i++, bay++) {
      docks.push({ code: locationCode(d.temp, 'B1', 90, bay, 0, 1), short: `B1-${pad2(bay)}`, floor: 'B1', zone: d.temp, temp, type: 'DOCK', aisle: 90, bay, level: 0, slot: 1, capacity: 0, pos: { x: 6 + (bay - 1) * 4.5, y: 0, z: 2 } });
    }
  }

  const autostoreCapacity = CAPACITY.autostoreBins * CAPACITY.unitsPerBin;
  // 선반 칸은 고정 용량(SHELF.slotUnits), 팔레트 칸이 나머지를 나눠 합이 정확히 520만 [고정]
  const shelfCapacity = floors.reduce((s, f) => s + f.shelves.reduce((a, l) => a + l.capacity, 0), 0);
  allocateCapacity(
    floors.flatMap((f) => f.locations),
    CDC_FACTS.capacityUnits - autostoreCapacity - shelfCapacity,
  );
  const totalCapacity = floors.reduce((s, f) => s + f.locations.reduce((a, l) => a + l.capacity, 0), 0) + shelfCapacity + autostoreCapacity;
  return { width, depth, bandDepth, floors, docks, autostore: { bins: CAPACITY.autostoreBins, unitsPerBin: CAPACITY.unitsPerBin, capacity: autostoreCapacity }, totalCapacity };
}

/**
 * 구역별 피킹 선반 칸 목표(SHELF.targetSlots) — 냉동·냉장은 그 구역 하나, 상온은 C~H 를 팔레트 통로 수 비율로(최대 나머지).
 */
export function shelfTargets(): Map<string, number> {
  const zs = CHILGOK_FLOORS.flatMap((f) => f.zones);
  const out = new Map<string, number>();
  for (const temp of ['FROZEN', 'CHILLED', 'AMBIENT'] as const) {
    const group = zs.filter((z) => z.temp === temp);
    const na = zoneAisles();
    const total = group.reduce((s, z) => s + na.get(z.letter)!, 0);
    const want = SHELF.targetSlots[temp];
    const q = group.map((z) => ({ z: z.letter, exact: (na.get(z.letter)! / total) * want }));
    for (const x of q) out.set(x.z, Math.floor(x.exact));
    let left = want - q.reduce((s, x) => s + Math.floor(x.exact), 0);
    for (const x of [...q].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
      if (left-- <= 0) break;
      out.set(x.z, out.get(x.z)! + 1);
    }
  }
  return out;
}

/**
 * 구역별 SKU 수 [시뮬] — 팔레트 통로 수에 비례, 최대 나머지 방식으로 합이 정확히 CATALOG.skus.
 * 선반 칸 수와 가짜 상품 마스터(catalog.ts)가 함께 쓴다.
 */
export function skuQuota(): Map<string, number> {
  const zs = CHILGOK_FLOORS.flatMap((f) => f.zones);
  const na = zoneAisles();
  const total = zs.reduce((s, z) => s + na.get(z.letter)!, 0);
  const q = zs.map((z) => ({ z: z.letter, exact: (na.get(z.letter)! / total) * CATALOG.skus }));
  const out = new Map(q.map((x) => [x.z, Math.floor(x.exact)]));
  let left = CATALOG.skus - [...out.values()].reduce((a, b) => a + b, 0);
  for (const x of [...q].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (left-- <= 0) break;
    out.set(x.z, out.get(x.z)! + 1);
  }
  return out;
}

/** 칸 용량 배분 — 무게대로 나누고 나머지는 큰 소수부부터 1씩(합이 정확히 total) [가정] */
function allocateCapacity(locs: Location[], total: number) {
  const w = locs.map((l) => CAPACITY.weight[l.temp]);
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / sum) * total);
  let given = 0;
  locs.forEach((l, i) => {
    l.capacity = Math.floor(raw[i]);
    given += l.capacity;
  });
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < total - given; k++) locs[order[k][1]].capacity++;
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
