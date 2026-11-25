// 가짜 상품 마스터와 시작 재고(시드) [시뮬]. 실서버 모드에서는 백엔드 SKU·재고를 쓴다(설계 §4.3).
// SKU 하나 = 피킹 선반 칸 하나(박스를 뜯어 낱개로 진열, MFC 처럼) + 팔레트 랙 기둥 한 칸(같은 통로·베이·슬롯의 1~4단, 입고·적치 보관).
// LOT: 선반 = 가장 먼저 끝나는 LOT, 팔레트 1·2단 = 같은 LOT, 3·4단 = 다음 LOT → FEFO 가 선반 → 팔레트 순으로 고른다.
// React·three 에 의존하지 않는다.

import { CATALOG, SHELF } from '../config';
import { Rng } from '../util/rng';
import { skuQuota, type Layout, type Location } from './layout';
import type { FloorNo, Temp } from './sites/chilgok';

export interface SeedLot {
  lot: string;
  expiresAt: string; // YYYY-MM-DD
  locationCode: string;
  qty: number;
}

/**
 * 상품 작업 방식 [사용자 2026-11-25, 설계 §5.4] — DPS(5F 냉동, 불 켜지는 선반) · BOX(5F 무거운 상자 박스 피킹) · FC(PDA 피킹, 지역 카트) ·
 * SPLIT(6F 야채 분배) · LINE(6F 그 밖 냉장 — 라인(DAS), 자키가 박스를 라인에 가져다줌)
 */
export type Handling = 'DPS' | 'BOX' | 'FC' | 'SPLIT' | 'LINE' | 'PORT';
/** 6F 야채(분배로 가는 것) [사용자 "야채는 분배, 나머지는 라인"] */
const VEG = new Set(['샐러드', '콩나물', '버섯', '양배추']);
export function handlingOf(zone: string, word: string): Handling {
  if (zone === 'A') return 'DPS';
  if (zone === 'C' || zone === 'D') return 'BOX';
  if (zone === 'B') return VEG.has(word) ? 'SPLIT' : 'LINE';
  // 7F H 비식재 소형 — 오토스토어 포트 [사용자 2026-11-25]
  if (zone === 'H') return 'PORT';
  return 'FC';
}

export interface SkuInfo {
  sku: string;
  name: string;
  handling: Handling;
  barcode: string;
  temp: Temp;
  zone: string;
  floor: FloorNo;
  /** 피킹 선반 칸 — FC 가 집는 곳 */
  shelf: Location;
  /** 팔레트 랙 기둥 한 칸의 1~4단 — 보관(보충 출발지) */
  column: Location[];
  /** 시작 재고 — [선반, 팔레트 1단 … 4단] */
  seed: SeedLot[];
}

export interface Catalog {
  skus: SkuInfo[];
  bySku: Map<string, SkuInfo>;
  /** 위치 코드 → 그 칸의 SKU (선반·팔레트) */
  byLocation: Map<string, SkuInfo>;
}

// 구역 성격별 상품 이름 [시뮬] — 실제 회사·상표 이름은 쓰지 않는다(설계 §9).
const WORDS: Record<string, string[]> = {
  A: ['냉동만두', '아이스크림', '냉동피자', '냉동새우', '돈까스', '냉동볶음밥', '떡갈비', '군만두', '냉동블루베리', '얼음컵'],
  B: ['우유', '두부', '요거트', '계란', '햄', '치즈', '김치', '어묵', '샐러드', '콩나물', '버섯', '양배추'],
  C: ['생수 2L', '쌀 10kg', '라면 박스', '식용유', '탄산수', '보리차'],
  D: ['캔커피 박스', '즉석밥 묶음', '통조림', '밀가루', '설탕', '간장'],
  E: ['시리얼', '참치캔', '즉석카레', '파스타면', '케첩', '마요네즈'],
  F: ['감자칩', '초코과자', '콜라', '사이다', '젤리', '컵라면', '에너지바'],
  G: ['화장지', '키친타월', '세탁세제', '섬유유연제', '주방세제', '물티슈'],
  H: ['샴푸', '치약', '칫솔', '바디워시', '위생장갑', '지퍼백', '쓰레기봉투'],
};
const VARIANTS = ['', ' 대용량', ' 소용량', ' 오리지널', ' 라이트', ' 묶음', ' 1+1', ' 가족용'];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function addDays(baseDate: string, days: number): string {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 시작 재고 만들기. 구역마다 SKU 수(skuQuota)만큼 선반 칸을 차례로 채우고, 팔레트 기둥은 그 구역 랙에 골고루 흩는다.
 * baseDate 는 시뮬레이션 첫날(유통기한 기준).
 */
export function buildCatalog(layout: Layout, baseDate: string): Catalog {
  const rng = new Rng(CATALOG.seed);
  const pallets = layout.floors.flatMap((f) => f.locations);
  const byCode = new Map(pallets.map((l) => [l.code, l]));
  const shelves = layout.floors.flatMap((f) => f.shelves);
  const quota = skuQuota();
  const fill = (r: readonly [number, number]) => rng.range(r[0], r[1]);

  const skus: SkuInfo[] = [];
  let serial = 0;
  for (const f of layout.floors) {
    for (const zs of f.spec.zones) {
      const z = zs.letter;
      const n = quota.get(z) ?? 0;
      const zShelves = shelves.filter((l) => l.zone === z);
      const bases = pallets.filter((l) => l.zone === z && l.level === 1);
      if (zShelves.length < n) throw new Error(`구역 ${z} 선반 칸 ${zShelves.length} < SKU ${n}`);
      const words = WORDS[z] ?? ['상품'];
      for (let i = 0; i < n; i++) {
        const shelf = zShelves[i];
        const base = bases[Math.floor((i * bases.length) / n)];
        const share = Math.max(1, Math.ceil(n / Math.max(1, bases.length)));
        const column: Location[] = [];
        for (let lv = 1; ; lv++) {
          const loc = byCode.get(base.code.replace(/-1-(\d)$/, `-${lv}-$1`));
          if (!loc) break;
          column.push(loc);
        }
        serial += 1;
        const sku = `E-${pad(10_000_000 + serial * 37, 8)}`;
        const name = `${words[i % words.length]}${VARIANTS[Math.floor(i / words.length) % VARIANTS.length]}`;
        const [lo, hi] = CATALOG.shelfLifeDays[shelf.temp];
        const d1 = rng.int(lo, Math.max(lo, Math.floor((lo + hi) / 2)));
        const d2 = rng.int(d1 + 1, hi + 1);
        const e1 = addDays(baseDate, d1);
        const e2 = addDays(baseDate, d2);
        const lot1 = `L${e1.replace(/-/g, '').slice(2)}-${pad(serial, 4)}`;
        const lot2 = `L${e2.replace(/-/g, '').slice(2)}-${pad(serial, 4)}`;
        skus.push({
          sku,
          name,
          handling: handlingOf(z, words[i % words.length]),
          barcode: `880${pad(serial, 10)}`,
          temp: shelf.temp,
          zone: z,
          floor: f.floor,
          shelf,
          column,
          seed: [
            { lot: lot1, expiresAt: e1, locationCode: shelf.code, qty: Math.max(1, Math.round(SHELF.slotUnits * fill(SHELF.fill))) },
            ...column.map((loc) => ({
              lot: loc.level <= 2 ? lot1 : lot2,
              expiresAt: loc.level <= 2 ? e1 : e2,
              locationCode: loc.code,
              qty: Math.max(1, Math.round((loc.capacity * fill(CATALOG.reserveFill)) / share)),
            })),
          ],
        });
      }
    }
  }
  const bySku = new Map(skus.map((s) => [s.sku, s]));
  const byLocation = new Map<string, SkuInfo>();
  for (const s of skus) {
    byLocation.set(s.shelf.code, s);
    for (const l of s.column) byLocation.set(l.code, s);
  }
  return { skus, bySku, byLocation };
}
