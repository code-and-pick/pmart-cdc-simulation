// 업무 문서에 없는 수치는 모두 여기에 근거 태그와 함께 둔다(CLAUDE.md).
// [고정] 사용자가 바꾸지 말라고 한 값 · [정본] 백엔드 결정(chilgok-dc.md CDC-1~6)·계약 · [현장] 실제 DC 자료 · [개념도] 사용자 그림 · [가정]/[시뮬] 이 시뮬레이터가 정한 값
// 설계 전체: docs/design/cdc-design.md

/** [고정] 사용자 2026-11-24 — 절대 바꾸지 않는다. test/facts.test.ts 가 지킨다. */
export const CDC_FACTS = {
  name: '칠곡 중앙물류센터',
  short: '칠곡 DC',
  address: '경상북도 칠곡군 지천면 산단터널로 240',
  areaPyeong: 8600,
  floors: [5, 6, 7] as const,
  capacityUnits: 5_200_000,
} as const;

/** 1평 = 3.3058㎡ [개념도 CDC-01] */
export const PYEONG_M2 = 3.3058;

/** [정본 CDC-1] centerId·위치 코드 첫 구간 */
export const CENTER_ID = 'CDC01';

/** 랙 치수 [개념도 CDC-03·04] [가정] */
export const RACK = {
  /** 베이 폭 — 2.7m 빔에 T11 팔레트 2개 [개념도 CDC-03] */
  bayW: 2.7,
  /** 랙 깊이 [가정] — T11 1.1m */
  depth: 1.1,
  /** 지게차 통로 폭 [가정] */
  aisleW: 3.0,
  /** 통로 한쪽 베이 수 — 양쪽 합 40(좌 홀수 20·우 짝수 20) [개념도 CDC-04] */
  baysPerSide: 20,
  /** 슬롯 — 1 왼쪽 · 2 오른쪽 [개념도] */
  slots: 2,
  /** 단 높이(m) [가정] — 사진의 5단 랙이 약 8m */
  levelH: 1.6,
  /** 통로 앞뒤 가로 통로 [가정] */
  crossAisle: 3.0,
} as const;

/** 통로 한 칸 폭 = 랙 깊이 × 2(등 맞댄 랙) + 통로 */
export const AISLE_PITCH = RACK.depth * 2 + RACK.aisleW;

/**
 * 층마다 같은 바닥(건물 한 층) [가정]. 폭은 가장 통로가 많은 5F(24통로)에 맞추고, 깊이는 층 면적에서 나온다.
 * 층 면적: 8,600 ÷ 3 → 2,866 · 2,867 · 2,867 [사용자·정본 CDC-2]
 */
export const FLOOR_PYEONG: Record<5 | 6 | 7, number> = { 5: 2866, 6: 2867, 7: 2867 };

/** 화물 승강기 — 층마다 대수 [가정], 지하 B1 차량 접안으로 오르내린다 [사용자] */
export const LIFTS_PER_FLOOR = 4;
/** 지하 B1 차량 접안 자리 [가정] — 90 DOCK, 구역 칸 = 차량 온도(A 냉동·B 냉장·C 상온) [정본 CDC-5] */
export const B1_DOCKS: { temp: 'A' | 'B' | 'C'; count: number }[] = [
  { temp: 'A', count: 4 },
  { temp: 'B', count: 4 },
  { temp: 'C', count: 6 },
];
/** 층별 출고대기 롤테이너 자리(91) — 개념도 PPC-01~30 [개념도], 01~05 는 MFC 기본 배정 [정본 CDC-5] */
export const STAGING_SLOTS = 30;

/**
 * 보관 용량 배분 [가정]. 칸 용량 합 = CDC_FACTS.capacityUnits(520만) 이 되게 나눈다.
 * 오토스토어 빈(bin) 몫을 먼저 떼고, 나머지를 팔레트 칸에 무게(상온 1.2 · 저온 1.0)로 나눈다.
 */
export const CAPACITY = {
  /** 오토스토어 빈 수 [가정] — 7F G·H 생활용품(비식재) */
  autostoreBins: 20_000,
  /** 빈 하나 유닛 [가정] */
  unitsPerBin: 30,
  /** 팔레트 칸 무게 [가정] — 상온 박스가 더 많이 들어간다 */
  weight: { AMBIENT: 1.2, CHILLED: 1.0, FROZEN: 1.0 },
} as const;

/** [정본 CDC-6] 공급 대상 MFC 와 지역(PDA 지역 바코드 단위). 출고대기 91 기본 자리. */
export const MFCS = [
  { id: 'MFC-BJG-01', name: '1호점 부산진구', region: '부산권', staging: 1 },
  { id: 'MFC-BNG-01', name: '5호점 부산남구', region: '부산권', staging: 2 },
  { id: 'MFC-MOKPO-01', name: '2호점 목포', region: '호남권', staging: 3 },
  { id: 'MFC-SEJ-01', name: '3호점 세종', region: '충청권', staging: 4 },
  { id: 'MFC-CHC-01', name: '4호점 춘천', region: '강원권', staging: 5 },
] as const;

/** 하루 시간표(분, 0시 기준) [현장] 알바몬 후기·우아한청년들 하루 일정 / [가정] 주간조 */
export const SHIFT = {
  day: { start: 8 * 60, end: 17 * 60 }, // [가정] 사용자 2026-11-24 주간조 넣음, 08:00 입고 시작 [현장]
  evening: { start: 13 * 60, end: 22 * 60 }, // [현장] 13:00~22:00
  breaks: [
    { start: 15 * 60 + 30, end: 15 * 60 + 45 },
    { start: 18 * 60, end: 19 * 60 },
    { start: 20 * 60 + 30, end: 20 * 60 + 45 },
  ], // [현장]
  departure: 23 * 60, // [현장] "11:00 PM 출발"
} as const;

/** 배속 — MFC 시뮬레이터와 같다 */
export const SPEEDS = [0, 1, 5, 15, 30, 60, 120] as const;

/**
 * 가짜 상품 마스터·시작 재고 [시뮬] (scope S-3: 입고 안 함 → 시작 재고는 시드, 설계 §4.3·§5.1 #0).
 * 고회전 2,000 SKU 가 팔레트 랙 1단 피킹면에 있다 [개념도 CDC-03]. 저회전 8,000 SKU(오토스토어·DPS·경량 선반)는 다음 단계.
 */
export const CATALOG = {
  seed: 20261125,
  /** [개념도 CDC-03] 고회전 SKU 수 */
  skus: 2000,
  /** 피킹면 채움률 [시뮬] — 칸 용량 대비 */
  pickFill: [0.45, 0.85] as const,
  /** 2단 보충 대기·3단~ 리저브 팔레트 채움률 [시뮬] */
  reserveFill: [0.7, 1.0] as const,
  /** 유통기한(일) 범위 [가정] — 시작일 기준, 피킹면 LOT 이 리저브 LOT 보다 먼저 끝난다(FEFO 가 피킹면부터 고르게) */
  shelfLifeDays: { FROZEN: [120, 360], CHILLED: [6, 25], AMBIENT: [60, 540] } as const,
} as const;

/** 할당 정책 [시뮬] — 실서버는 cdc-inventory 정책값. 시뮬레이터가 정한 값(docs/backend-requests.md) */
export const ALLOCATION = {
  /** FEFO 최소 잔여일수 — 온도대별 [가정] */
  minRemainingDays: { FROZEN: 30, CHILLED: 3, AMBIENT: 14 } as const,
  /** 안전량 S — MOCK 은 0 으로 둔다(정책 NOT_SET 은 0 이 아니다 — 실서버는 CONFIG_REQUIRED) */
  safetyQty: 0,
} as const;

/** MFC 보충 요청(TRF) 만들기 — MOCK 에서 시뮬레이터가 replenishment 역할 [가정] (설계 §5.1 #1) */
export const SUPPLY = {
  /** MFC 한 곳의 하루 TRF 품목 수 [가정] */
  linesPerMfc: 40,
  /** 품목당 승인 수량 [가정] */
  qty: [6, 48] as const,
  /** MFC 도착 마감 — 다음 날 09:00 (MFC 오픈) [현장 하루 일정] */
  dueNextDayMin: 9 * 60,
} as const;
