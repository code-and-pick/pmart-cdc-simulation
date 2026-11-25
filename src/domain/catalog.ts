// 가짜 상품 마스터와 시작 재고(시드) [시뮬]. 실서버 모드에서는 백엔드 SKU·재고를 쓴다(설계 §4.3).
// SKU 하나 = 피킹 선반 칸 하나(박스를 뜯어 낱개로 진열, MFC 처럼) + 팔레트 랙 기둥 한 칸(같은 통로·베이·슬롯의 1~4단, 입고·적치 보관).
// LOT: 선반 = 가장 먼저 끝나는 LOT, 팔레트 1·2단 = 같은 LOT, 3·4단 = 다음 LOT → FEFO 가 선반 → 팔레트 순으로 고른다.
// React·three 에 의존하지 않는다.

import { AUTOSTORE, CATALOG, SHELF, SKU_PLACE } from '../config';
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

export interface SkuInfo {
  sku: string;
  name: string;
  handling: Handling;
  barcode: string;
  temp: Temp;
  zone: string;
  floor: FloorNo;
  /** 집는 곳(홈) — 선반 칸 · 랙 1단 박스 피킹면 · 야채 레인 자리 · 오토스토어 칸 */
  shelf: Location;
  /** 같은 SKU 의 다른 피킹 칸(오토스토어 다른 통의 칸) */
  alt: Location[];
  /** 보관 팔레트 기둥(보충 출발지) — 피킹면 SKU 는 같은 기둥 2~4단, 야채는 없음 */
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
  H: ['냉동만두', '아이스크림', '냉동피자', '냉동새우', '돈까스', '냉동볶음밥', '떡갈비', '군만두', '냉동블루베리', '얼음컵'],
  G: ['우유', '두부', '요거트', '계란', '햄', '치즈', '김치', '어묵', '소시지', '생크림'],
  A: ['생수 2L', '쌀 10kg', '라면 박스', '식용유', '탄산수', '보리차'],
  B: ['캔커피 박스', '즉석밥 묶음', '통조림', '밀가루', '설탕', '간장'],
  C: ['시리얼', '참치캔', '즉석카레', '파스타면', '케첩', '마요네즈'],
  D: ['감자칩', '초코과자', '콜라', '사이다', '젤리', '컵라면', '에너지바'],
  E: ['물티슈', '주방세제', '섬유유연제', '세탁세제 리필', '샴푸', '바디워시', '고무장갑'],
  // 7F H 오토스토어 — 작고 가벼운 비식재(통 30kg·높이 425mm 안) [사용자 §5]
  F: ['칫솔', '건전지', '치약', '면봉', '위생장갑', '지퍼백', '수세미', '소형 주방용품', '욕실 소품'],
  // 랙 1단 박스 피킹면 — 5F 무거운 상자 · 7F 대용량
  A_FACE: ['생수 2L 묶음', '쌀 10kg', '라면 박스', '식용유 박스', '탄산수 박스', '보리차 박스'],
  B_FACE: ['캔커피 박스', '즉석밥 묶음', '통조림 박스', '밀가루 박스', '설탕 박스', '간장 박스'],
  E_FACE: ['대용량 화장지', '키친타월 묶음', '세탁세제 대용량', '쓰레기봉투 묶음'],
  F_FACE: ['대용량 화장지', '키친타월 묶음', '물티슈 박스', '세제 대용량'],
  // 6F 바닥 레인 → 분배
  VEG: ['샐러드', '콩나물', '버섯', '양배추', '상추', '깻잎', '대파', '양파'],
};
const VARIANTS = ['', ' 대용량', ' 소용량', ' 오리지널', ' 라이트', ' 묶음', ' 1+1', ' 가족용'];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function addDays(baseDate: string, days: number): string {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 시작 재고 만들기 [시뮬] — SKU 18,000(사용자 2026-11-25 §1)을 피킹 자리에 하나씩:
 * 냉동 A 선반(DPS) · 냉장 B 선반(라인) + 야채 바닥 레인(분배) · 5F C·D 랙 1단 박스 피킹면(휠소터) · 5F E·F 선반(FC) ·
 * 7F G·H 랙 1단(대용량, FC) · 7F G 선반(FC) · 7F H 오토스토어 칸(포트, SKU 하나 = 칸 AUTOSTORE.compartmentsPerSku 개).
 * 보충 출발지(팔레트 기둥)는 그 구역 보관 칸(RESERVE)을 SKU 들이 나눠 쓴다(섞인 팔레트 [시뮬]) — 야채는 바닥 레인에만.
 * baseDate 는 시뮬레이션 첫날(유통기한 기준).
 */
export function buildCatalog(layout: Layout, baseDate: string): Catalog {
  const rng = new Rng(CATALOG.seed);
  const pallets = layout.floors.flatMap((f) => f.locations);
  const byCode = new Map(pallets.map((l) => [l.code, l]));
  const fill = (r: readonly [number, number]) => rng.range(r[0], r[1]);
  const quota = skuQuota();

  type Place = { loc: Location; alt: Location[]; handling: Handling; words: string[] };
  const skus: SkuInfo[] = [];
  let serial = 0;
  for (const f of layout.floors) {
    for (const zs of f.spec.zones) {
      const z = zs.letter;
      const pick = f.shelves.filter((l) => l.zone === z);
      const shelves = pick.filter((l) => !l.bin && !l.lane);
      const lanes = pick.filter((l) => l.lane);
      const comps = pick.filter((l) => l.bin);
      const faces = f.locations.filter((l) => l.zone === z && l.type === 'PICK_FACE');
      const places: Place[] = [];
      const take = (arr: Location[], n: number, handling: Handling, words: string[]) => {
        if (arr.length < n) throw new Error(`구역 ${z} 피킹 칸 ${arr.length} < SKU ${n}`);
        for (const loc of arr.slice(0, n)) places.push({ loc, alt: [], handling, words });
      };
      for (const loc of faces) places.push({ loc, alt: [], handling: z === 'A' || z === 'B' ? 'BOX' : 'FC', words: WORDS[`${z}_FACE`] ?? WORDS[z] });
      const n = (quota.get(z) ?? 0) - faces.length;
      if (z === 'H') take(shelves, n, 'DPS', WORDS.H);
      else if (z === 'G') {
        take(shelves, n - SKU_PLACE.veg, 'LINE', WORDS.G);
        take(lanes, SKU_PLACE.veg, 'SPLIT', WORDS.VEG);
      } else if (z === 'F') {
        // 오토스토어: SKU 하나 = 서로 다른 통의 칸 AUTOSTORE.compartmentsPerSku 개
        const per = AUTOSTORE.compartmentsPerSku;
        const k = Math.floor(comps.length / per);
        if (k < n) throw new Error(`오토스토어 칸 ${comps.length} 으로 SKU ${n} 못 둠`);
        for (let i = 0; i < n; i++) places.push({ loc: comps[i], alt: Array.from({ length: per - 1 }, (_, j) => comps[i + (j + 1) * k]), handling: 'PORT', words: WORDS.F });
      } else if (n > 0) take(shelves, n, 'FC', WORDS[z] ?? ['상품']);

      // 보충 출발지 — 그 구역 보관 칸(RESERVE) 기둥(같은 통로·베이·슬롯), 피킹면 구역은 2~4단
      const bases = f.locations.filter((l) => l.zone === z && l.type === 'RESERVE' && l.level === (SKU_PLACE.faceZones.includes(z) ? 2 : 1));
      const cnt = places.filter((p) => p.handling !== 'SPLIT').length;
      const share = Math.max(1, Math.ceil(cnt / Math.max(1, bases.length)));
      let ri = 0;
      places.forEach((p, i) => {
        let column: Location[] = [];
        if (p.loc.type === 'PICK_FACE' && p.loc.aisle < SHELF.aisleBase) {
          // 랙 1단 박스 피킹면 — 같은 기둥 2~4단
          for (let lv = 2; ; lv++) {
            const loc = byCode.get(p.loc.code.replace(/-1-(\d)$/, `-${lv}-$1`));
            if (!loc) break;
            column.push(loc);
          }
        } else if (p.handling !== 'SPLIT' && bases.length) {
          const base = bases[Math.floor((ri++ * bases.length) / Math.max(1, cnt - faces.length))] ?? bases[ri % bases.length];
          for (let lv = base.level; ; lv++) {
            const loc = byCode.get(base.code.replace(/-(\d+)-(\d)$/, `-${lv}-$2`));
            if (!loc) break;
            column.push(loc);
          }
        }
        serial += 1;
        const word = p.words[i % p.words.length];
        const sku = `E-${pad(10_000_000 + serial * 37, 8)}`;
        const name = `${word}${VARIANTS[Math.floor(i / p.words.length) % VARIANTS.length]}`;
        const [lo, hi] = CATALOG.shelfLifeDays[p.loc.temp];
        const d1 = rng.int(lo, Math.max(lo, Math.floor((lo + hi) / 2)));
        const d2 = rng.int(d1 + 1, hi + 1);
        const e1 = addDays(baseDate, d1);
        const e2 = addDays(baseDate, d2);
        const lot1 = `L${e1.replace(/-/g, '').slice(2)}-${pad(serial, 4)}`;
        const lot2 = `L${e2.replace(/-/g, '').slice(2)}-${pad(serial, 4)}`;
        const pickFill = p.loc.aisle < SHELF.aisleBase ? CATALOG.reserveFill : SHELF.fill;
        const faceShare = p.loc.aisle < SHELF.aisleBase ? 1 : 1;
        skus.push({
          sku,
          name,
          handling: p.handling,
          barcode: `880${pad(serial, 10)}`,
          temp: p.loc.temp,
          zone: z,
          floor: f.floor,
          shelf: p.loc,
          alt: p.alt,
          column,
          seed: [
            { lot: lot1, expiresAt: e1, locationCode: p.loc.code, qty: Math.max(1, Math.round((p.loc.capacity * fill(pickFill)) / faceShare)) },
            ...p.alt.map((l) => ({ lot: lot1, expiresAt: e1, locationCode: l.code, qty: Math.max(1, Math.round(l.capacity * fill(SHELF.fill))) })),
            ...column.map((loc) => ({
              lot: loc.level <= 2 ? lot1 : lot2,
              expiresAt: loc.level <= 2 ? e1 : e2,
              locationCode: loc.code,
              qty: Math.max(1, Math.round((loc.capacity * fill(CATALOG.reserveFill)) / (p.loc.aisle < SHELF.aisleBase ? 1 : share))),
            })),
          ],
        });
      });
    }
  }
  // 시작 재고가 칸 용량을 넘지 않게 — 한 보관 칸을 여러 SKU 가 나눠 쓰면(섞인 팔레트) 칸 합을 용량 × 최대 채움 안으로 줄인다(사용자 2026-11-25 "7F G 133%·H 123% 과적재")
  const want = new Map<string, number>();
  for (const s of skus) for (const x of s.seed) want.set(x.locationCode, (want.get(x.locationCode) ?? 0) + x.qty);
  const capOf = new Map([...layout.floors.flatMap((f) => [...f.locations, ...f.shelves])].map((l) => [l.code, l.capacity]));
  for (const s of skus)
    for (const x of s.seed) {
      const cap = Math.floor((capOf.get(x.locationCode) ?? x.qty) * CATALOG.maxFill);
      const tot = want.get(x.locationCode)!;
      if (tot > cap) x.qty = Math.max(1, Math.floor((x.qty * cap) / tot));
    }
  const bySku = new Map(skus.map((s) => [s.sku, s]));
  const byLocation = new Map<string, SkuInfo>();
  for (const s of skus) {
    byLocation.set(s.shelf.code, s);
    for (const l of s.alt) byLocation.set(l.code, s);
    for (const l of s.column) if (!byLocation.has(l.code)) byLocation.set(l.code, s);
  }
  return { skus, bySku, byLocation };
}

