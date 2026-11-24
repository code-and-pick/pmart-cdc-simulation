// 가짜 상품 마스터와 시작 재고(시드) [시뮬]. 실서버 모드에서는 백엔드 SKU·재고를 쓴다(설계 §4.3).
// SKU 하나 = 랙 기둥 한 칸(같은 통로·베이·슬롯)의 모든 단: 1단 피킹면 · 2단 보충 대기(피킹면과 같은 LOT) · 3단~ 리저브(다음 LOT).
// LOT 은 피킹면 쪽이 먼저 끝난다(FEFO 가 피킹면 → 보충 대기 → 리저브 순으로 고른다).
// React·three 에 의존하지 않는다.

import { CATALOG } from '../config';
import { Rng } from '../util/rng';
import type { Layout, Location } from './layout';
import type { FloorNo, Temp } from './sites/chilgok';

export interface SeedLot {
  lot: string;
  expiresAt: string; // YYYY-MM-DD
  locationCode: string;
  qty: number;
}

export interface SkuInfo {
  sku: string;
  name: string;
  barcode: string;
  temp: Temp;
  zone: string;
  floor: FloorNo;
  pickFace: Location;
  /** 2단 보충 대기 [개념도 CDC-04] */
  buffer: Location;
  /** 3단 리저브(대표) — 위 단도 같은 LOT */
  reserve: Location;
  /** 이 SKU 가 쓰는 칸 전부(1단~맨 위) */
  column: Location[];
  /** 시작 재고 — FEFO 순(먼저 끝나는 LOT 먼저) */
  seed: SeedLot[];
}

export interface Catalog {
  skus: SkuInfo[];
  bySku: Map<string, SkuInfo>;
  /** 위치 코드 → 그 칸의 SKU (피킹면·리저브) */
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
 * 시작 재고 만들기. 구역마다 피킹면 수에 비례해 SKU 를 나누고, 통로·베이에 골고루 흩는다.
 * baseDate 는 시뮬레이션 첫날(유통기한 기준).
 */
export function buildCatalog(layout: Layout, baseDate: string): Catalog {
  const rng = new Rng(CATALOG.seed);
  const all = layout.floors.flatMap((f) => f.locations);
  const byCode = new Map(all.map((l) => [l.code, l]));
  const faces = all.filter((l) => l.type === 'PICK_FACE');
  const zones = [...new Set(faces.map((l) => l.zone))];
  const facesByZone = new Map(zones.map((z) => [z, faces.filter((l) => l.zone === z)]));

  // 구역별 SKU 수 — 최대 나머지 방식으로 합이 정확히 CATALOG.skus
  const quotas = zones.map((z) => ({ z, exact: (facesByZone.get(z)!.length / faces.length) * CATALOG.skus }));
  const counts = new Map(quotas.map((q) => [q.z, Math.floor(q.exact)]));
  let left = CATALOG.skus - [...counts.values()].reduce((a, b) => a + b, 0);
  for (const q of [...quotas].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (left-- <= 0) break;
    counts.set(q.z, counts.get(q.z)! + 1);
  }

  const fill = (r: readonly [number, number]) => rng.range(r[0], r[1]);
  const skus: SkuInfo[] = [];
  let serial = 0;
  for (const z of zones) {
    const zf = facesByZone.get(z)!;
    const n = counts.get(z)!;
    const words = WORDS[z] ?? ['상품'];
    for (let i = 0; i < n; i++) {
      // 피킹면을 고르게 흩는다(통로·베이 순서대로 늘어선 목록에서 일정 간격)
      const face = zf[Math.floor((i * zf.length) / n)];
      const at = (lv: number) => byCode.get(face.code.replace(/-1-(\d)$/, `-${lv}-$1`));
      const column: Location[] = [];
      for (let lv = 1; at(lv); lv++) column.push(at(lv)!);
      const buffer = column[1];
      const reserve = column[2];
      serial += 1;
      const sku = `E-${pad(10_000_000 + serial * 37, 8)}`;
      const name = `${words[i % words.length]}${VARIANTS[Math.floor(i / words.length) % VARIANTS.length]}`;
      const [lo, hi] = CATALOG.shelfLifeDays[face.temp];
      const d1 = rng.int(lo, Math.max(lo, Math.floor((lo + hi) / 2)));
      const d2 = rng.int(d1 + 1, hi + 1);
      const e1 = addDays(baseDate, d1);
      const e2 = addDays(baseDate, d2);
      const lot1 = `L${e1.replace(/-/g, '').slice(2)}-${pad(serial, 4)}`;
      const lot2 = `L${e2.replace(/-/g, '').slice(2)}-${pad(serial, 4)}`;
      skus.push({
        sku,
        name,
        barcode: `880${pad(serial, 10)}`,
        temp: face.temp,
        zone: z,
        floor: face.floor as FloorNo,
        pickFace: face,
        buffer,
        reserve,
        column,
        seed: column.map((loc) => ({
          lot: loc.level <= 2 ? lot1 : lot2,
          expiresAt: loc.level <= 2 ? e1 : e2,
          locationCode: loc.code,
          qty: Math.max(1, Math.round(loc.capacity * fill(loc.level === 1 ? CATALOG.pickFill : CATALOG.reserveFill))),
        })),
      });
    }
  }
  const bySku = new Map(skus.map((s) => [s.sku, s]));
  const byLocation = new Map<string, SkuInfo>();
  for (const s of skus) for (const l of s.column) byLocation.set(l.code, s);
  return { skus, bySku, byLocation };
}
