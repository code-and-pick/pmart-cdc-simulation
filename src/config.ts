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

/**
 * 랙 치수 [사용자 2026-11-25 랙 규격표·사진] — 모든 구역 같다.
 * 랙 6m(높이) × 2.6m(가로) × 1m(깊이), 4단. 단 2m × 2.6m × 1m = 5,200L, 단당 하중 2톤.
 * 팔레트 1.1m × 1.1m, 2m 높이로 랙 하나에 8개(단당 2개). 단 1 = 바닥 피킹면, 2·4·6m 빔 위가 2~4단(맨 위 단 짐은 6m 위로 올라간다).
 */
export const RACK = {
  /** 베이(빔) 폭 2.6m [사용자] */
  bayW: 2.6,
  /** 랙 깊이 1m [사용자] — 팔레트 1.1m 가 앞뒤로 조금 나온다 */
  depth: 1.0,
  /** 랙 프레임 높이 6m [사용자] */
  height: 6.0,
  /** 단 수 — 1 피킹면 · 2 보충 대기 · 3~4 리저브 [사용자 4단] */
  levels: 4,
  /** 단 부피(L)·하중(kg) [사용자] */
  levelVolumeL: 5200,
  levelLoadKg: 2000,
  /** 팔레트 [사용자] — 1.1 × 1.1m, 짐 포함 2m */
  pallet: { w: 1.1, d: 1.1, h: 2.0, deckH: 0.14 },
  /** 지게차 통로 폭 3.0m — 처음 3.5m 가정에서 팔레트 18,000칸 이상(CDC-2·백엔드 R-17 회신) 위해 줄임 [사용자 2026-11-25 2안] */
  aisleW: 3.0,
  /** 묶음 한 줄 랙 수 — "1줄에 랙 12개 양면으로 두니까 24개가 간격을 두는 랙 묶음 단위" [사용자 2026-11-25] */
  bundleBays: 12,
  /** 슬롯 — 1 왼쪽 · 2 오른쪽 [개념도] */
  slots: 2,
  /** 단 높이 2m [사용자] */
  levelH: 2.0,
  /** 묶음 앞뒤 가로 통로 — 지게차 통로와 같은 폭 [가정] */
  crossAisle: 3.0,
} as const;

/** 보관 방 안 배치 [가정] — 남북으로 놓는 묶음 줄 수. 피킹 선반·오토스토어는 DT [사용자 2026-11-25 2안] */
export const STORE = { bundleRows: 2 } as const;

/** 묶음 간격 = 묶음 폭(등 맞댄 랙 깊이 × 2) + 지게차 통로 */
export const AISLE_PITCH = RACK.depth * 2 + RACK.aisleW;

/**
 * 층마다 같은 바닥(건물 한 층) [가정]. 폭은 보관이 가장 넓은 층 보관 방 폭, 깊이는 층 면적에서 나온다(layout.sitePlan).
 * 층 면적: 8,600 ÷ 3 → 2,866 · 2,867 · 2,867 [사용자·정본 CDC-2]
 */
export const FLOOR_PYEONG: Record<5 | 6 | 7, number> = { 5: 2866, 6: 2867, 7: 2867 };

/** 화물 승강기 — 층마다 대수 [가정]. 차는 층마다 도크에 대므로 승강기는 층 사이(5F 상온 R/T → 7F 도크)에만 쓴다 */
export const LIFTS_PER_FLOOR = 2;
/**
 * 차량 접안 도크 — 층마다(기사 사진: 도크 문 번호 "4-16"·"4-17" = 층-번호, 문 앞 레벨러) [사용자 2026-11-26 "사진대로", 지하 B1 접안을 바꿈].
 * 온도대마다 그 짐이 있는 층의 북쪽 벽 [가정]: 냉동 5F · 냉장 6F · 상온 7F(5F 상온 R/T 는 승강기로 7F 도크로).
 * 수 [가정] — 같은 시각에 나가는 차가 온도대마다 2대(목포·춘천 01:00, 세종·부산 03:00), 위치 코드 90 DOCK.
 */
export const DOCKS: { temp: 'FROZEN' | 'CHILLED' | 'AMBIENT'; floor: 5 | 6 | 7; count: number }[] = [
  { temp: 'FROZEN', floor: 5, count: 2 },
  { temp: 'CHILLED', floor: 6, count: 3 },
  { temp: 'AMBIENT', floor: 7, count: 4 },
];
/** 온도대 → 도크 층 */
export const DOCK_FLOOR: Record<'FROZEN' | 'CHILLED' | 'AMBIENT', 5 | 6 | 7> = { FROZEN: 5, CHILLED: 6, AMBIENT: 7 };
/** 도크 문 간격(m) [가정] */
export const DOCK_PITCH = 4.5;
/** 북쪽 띠 출고대기 시작 x(m) — 승강기 4대 시절 자리 그대로, 그 서쪽 빈자리는 도크 [가정] */
export const STAGING_X0 = 23;
/** 층별 출고대기 롤테이너 자리(91) — 개념도 PPC-01~30 [개념도], 01~05 는 MFC 기본 배정 [정본 CDC-5] */
export const STAGING_SLOTS = 30;

/**
 * 보관 용량 [가정] — 칸마다 유닛을 정하고 총 용량은 칸 용량 합(계산값, layout.capacity). CDC_FACTS.capacityUnits(520만)는 목표로 대조한다.
 */
export const CAPACITY = {
  /** 팔레트 칸 하나 평균 유닛 [가정] — 저온은 짐 높이 1.7m(상온 2.0m)라 덜 들어간다. 총 용량은 이 값으로 계산한다(사용자 2026-11-25 "총 용량을 계산값으로") */
  palletUnits: { AMBIENT: 240, CHILLED: 180, FROZEN: 180 },
  /**
   * 구역별 팔레트 칸 유닛(온도대 값 대신) [가정 — 사용자 2026-11-25 "팔레트당 유닛이 7F 생활용품에 맞는지 재검토"].
   * G 생활용품(휴지·세제·주방 — 부피가 커서 팔레트 하나에 30롤 휴지 약 40팩, 세제 3L 약 200개): 평균 150.
   * H 소형 비식재(칫솔·건전지·문구 — 상자 하나 24~100개 × 팔레트 40상자): 보수적으로 600. 5F 상온 식품은 240 그대로.
   */
  palletUnitsByZone: { G: 150, H: 600 } as Record<string, number>,
  /** 야채 바닥 적치 자리 하나 유닛 [가정] */
  vegLaneUnits: 120,
} as const;

/**
 * 건물·온도 방 기준값 (사용자 2026-11-25 지시문 §1).
 * 천장 8.5~9m → 상온 랙 6m 4단(단 2m·짐 2m) 유지, 5단은 천장 때문에 불가. 냉동·냉장 방은 천장 단열·냉각기로 유효 높이 −0.8m [가정] → 4단 유지, 짐 1.7m [가정].
 */
export const BUILDING = {
  /** 천장 높이(m) [사용자 8.5~9m — 가운데 값] */
  ceilingH: 8.75,
  /** 냉동·냉장 방 유효 높이 감소(m) [가정] */
  coldCeilingLoss: 0.8,
  /** 냉동·냉장 팔레트 짐 높이(m) [가정] — 상온은 RACK.pallet.h 2.0 */
  coldPalletH: 1.7,
  /** 바닥 허용 하중(kg/㎡) [확인 필요] — 층마다 */
  floorLoadKgM2: { 5: 2500, 6: 2500, 7: 2500 } as Record<5 | 6 | 7, number>,
  /** 온도 방 단열 패널 벽 높이(m) [가정 3~4m] · 방 온도 표시 */
  coldWallH: 3.5,
  roomTempLabel: { FROZEN: '냉동 -20°C', CHILLED: '냉장 3°C' },
} as const;

/**
 * SKU 목표 [사용자 2026-11-25 §1] — 총 18,000, 온도대 비율은 MFC 설계 칸 비율 냉동 22 : 냉장 31 : 상온 47(상온에 생활용품 포함).
 * 옛 선반 목표 칸(10,900)은 지움 — SKU 목표는 이것 하나(사용자 2026-11-25 "SKU_TARGET 으로 통일").
 */
export const SKU_TARGET = { total: 18_000, FROZEN: 4_000, CHILLED: 5_500, AMBIENT: 8_500 } as const;

/**
 * SKU 를 어디에 두나 [가정] — 위치 수가 곧 SKU 자리 수(칸 하나 = SKU 하나).
 * 냉장 5,500 = 피킹 선반(라인 상품) + 야채 바닥 레인. 상온 8,500 = 5F C·D 랙 1단 박스 피킹면 + 5F E·F 선반 + 7F G·H 랙 1단(대용량) + 7F G 선반 + 7F H 오토스토어.
 * 랙 1단 박스 피킹면 SKU 수는 그 구역 1단 칸 수에서 나오고, 7F G 선반 = 상온 목표 − 나머지.
 */
export const SKU_PLACE = {
  /** 6F 야채(바닥 적치 → 분배) SKU [가정] */
  veg: 300,
  /** 5F E·F 선반 SKU(구역마다) [가정] — 5F 띠 공간에 들어가는 만큼 */
  efShelf: 630,
  /**
   * 7F H 오토스토어 SKU [가정] — H 는 소형 비식재 = 오토스토어(설계 §5, 사용자 2026-11-25 "H 소형 = 오토스토어 설계대로").
   * 전엔 1,500 + H 랙 1단 대용량 피킹면 816 이었는데, H 피킹면을 없애고 그 SKU 를 오토스토어로(2,400).
   */
  autostore: 2_400,
  /** 랙 1단이 박스 피킹면(PICK_FACE)인 구역 [가정] — 5F C·D 무거운 상자, 7F G 대용량 생활용품. H 랙은 오토스토어 보충용 보관(RESERVE)만 */
  faceZones: ['A', 'B', 'E'] as readonly string[],
};

/** 6F 냉장 바닥 적치 레인 위치 코드 통로 [가정 — 백엔드 확인 필요] · 레인 모양 */
export const VEG_LANES = { aisle: 93, laneW: 1.2, gap: 1.0, posLen: 1.3 } as const;

/** 6F 가공품 팔레트 랙 통로 출발점(사용자 "출발점은 10통로") — 전체 팔레트 칸 하한(백엔드 R-17 회신, 사용자 결정)을 지키도록 늘린다 */
export const CHILLED_RACK = { startAisles: 10, palletMin: 18_000 } as const;

/**
 * 오토스토어(7F H) [사용자 2026-11-25 §5 — 현실적인 범위]. 설치비는 통·로봇·포트 수에 비례 → 셋 다 설정값.
 * 위치 코드: H-7-{61~}-{베이=통 번호}-{단=쌓은 높이 1~16}-{슬롯=칸 1~compartments} — 칸 하나 = PICK_FACE(백엔드 회신: 유형 따로 안 둠).
 */
export const AUTOSTORE = {
  /** 대상 기준 [사용자] — 통 최대 무게(kg), 통 높이(mm), 하루 출고량 중간 이하 */
  maxBinKg: 30,
  binHeightsMm: [220, 330, 425] as const,
  /** SKU 하나가 쓰는 칸 수(재고 깊이) [가정] · 통 하나 칸 수 [가정 1~4] · 쌓는 단 [사용자 16] */
  compartmentsPerSku: 2,
  compartmentsPerBin: 2,
  stack: 16,
  /** 격자 칸(m) [가정] — 통 약 0.65 × 0.45 */
  cell: { x: 0.7, z: 0.5 },
  /** 칸 하나 유닛 [가정] · 최소 수량(보충 기준) [가정] */
  unitsPerCompartment: 40,
  minQty: 8,
  /** 로봇·포트 [가정 — 설치비 비례] · 포트당 시간당 통 교환 상한 [가정] */
  robots: 10,
  /** 포트 2 [가정] — 2026-11-26 빈 포트 아무 데나·다음 통 미리 줄 세우기로 고친 뒤 3개는 가동 26% 라 2개로 */
  ports: 2,
  portBinsPerHour: 300,
  /** 로봇이 통 하나 가져오는 시간(s) [가정] */
  fetchSec: 40,
  /** 순환 실사 확률 · 세는 시간(s) [가정] */
  cycleCountRate: 0.03,
  cycleCountSec: 20,
  /** 보충: 통당 N초 + 낱개당 M초 [가정] */
  refillBinSec: 25,
  refillPerUnitSec: 0.4,
  /** 16단 쌓았을 때 바닥 하중(kg/㎡) [사용자 약 2,000] */
  floorLoadKgM2: 2000,
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
  /** 피킹면 채움률 [시뮬] — 칸 용량 대비 */
  pickFill: [0.45, 0.85] as const,
  /** 2단 보충 대기·3단~ 리저브 팔레트 채움률 [시뮬] */
  reserveFill: [0.7, 1.0] as const,
  /** 한 칸 시작 재고 합의 최대 채움(칸 용량 대비) [시뮬] — 여러 SKU 가 한 보관 칸을 나눠 써도 넘치지 않게 */
  maxFill: 0.95,
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
  /** MFC 요청 줄 중 잘 나가는 상품 묶음(모든 MFC 가 같이 요청)에서 고르는 몫·그 묶음 크기(SKU 비율) [시뮬 — 라인(DAS)에서 한 상품이 여러 MFC 칸으로 나뉘게] */
  popularShare: 0.35,
  popularPool: 0.02,
  /** MFC 한 곳의 하루 TRF 품목 수 [가정] — 고회전 2,000 SKU 의 30%, 석간 FC 16명이 저녁 내내 집는 양으로 맞춤 */
  linesPerMfc: 600,
  /** 품목당 승인 수량 [가정] */
  qty: [6, 48] as const,
  /** MFC 도착 마감 — 다음 날 09:00 (MFC 오픈) [현장 하루 일정] */
  dueNextDayMin: 9 * 60,
} as const;

/**
 * 피킹 선반 [사용자 2026-11-25 "뜯어서 개별 MFC 주문에 맞게 피킹해 패킹하기 위해 MFC 처럼 진열해 놓은 공간"].
 * 팔레트 랙은 공급받은 물량을 입고·적치해 두는 보관 자리, 피킹은 이 선반에서 한다. 선반 모양은 MFC 시뮬레이터(RACK_LEN 1.25 · 깊이 0.45 · 높이 2.1)와 같게.
 * 자리: 각 층 북쪽 띠(승강기·출고대기 남쪽) [가정]. 위치 코드 통로는 61 부터(구역마다 다시 61) [시뮬 — R-13 백엔드에 요청].
 */
export const SHELF = {
  /** 선반 한 칸(유닛) 길이·깊이·높이(m) — MFC 시뮬레이터와 같음 */
  unitLen: 1.25,
  depth: 0.45,
  height: 2.1,
  /** 단·한 단 칸 수 [가정] — 칸 하나 = SKU 하나(MFC 처럼) */
  levels: 5,
  slots: 3,
  /** 선반 사이 걷는 통로 폭 [가정] */
  aisleW: 1.6,
  /** 선반 통로 첫 번호 [시뮬 R-13] — 랙 01~, 비랙 90~ 와 겹치지 않게 */
  aisleBase: 61,
  /** 선반 칸 하나 용량(유닛) [가정] — 박스를 뜯어 낱개로 진열 */
  slotUnits: 80,
  /** 시작 채움률 [시뮬] */
  fill: [0.3, 0.9] as const,
  /** 북쪽 띠에서 승강기·출고대기 줄 깊이(m) — 그 남쪽부터 선반 [가정] */
  northStrip: 7.5,
} as const;

/**
 * 작업자 수(층마다) [가정] — 자료에 없음(설계 §6). 일용직은 시작할 때 FC·분배·라인에 배정 [현장].
 * repl = 지게차 선반 보충(주간조 08~17 + 석간 1명 — 부족 재할당분 보충), fc = FC 피커, sort = 분배·라인(DAS·DPS·분류기 앞), jockey = 자키(롤테이너를 출고대기로).
 */
/**
 * 출고 흐름 [사용자 2026-11-25 §9 — 배민 인천기지 구조: 휠소터 · DAS · DPS · 오토스토어].
 * 어떤 상품이 어디로: 박스째 PPC 1곳 → 휠소터 → PPC 슈트(롤테이너) · 여러 PPC 가 같이(낱개) → DAS · 냉동(PPC 별 다양한 소량) → DPS · 소형 비식재 → 오토스토어.
 */
export const FLOW = {
  /** 이 수 이상의 PPC 가 같은 날 같이 주문하면 DAS [가정] */
  dasMinPpc: 2,
  /** DAS 존 깊이(m) — R/T 한 줄(MFC 마다 1대) + 작업자 통로. MFC 가 늘어 두 줄이 필요하면 8.8 [시뮬, 사용자 2026-11-26 "한 줄 유지"] */
  dasDepth: 4.4,
  /** 컨베이어·휠소터 속도(m/s) · 갈래 나누는 시간(s) [가정] */
  conveyorSpeed: 0.5,
  divertSec: 4,
  /** 층별 DAS 라인 작업자(나머지 분류 인원은 분배) · 한 줄 사람 수 [가정] */
  // 라인(DAS) 작업자 — 5F 상온 DAS 존·6F 냉장 라인·7F 생활용품 DAS 존(기사 "상온·냉장·냉동 모두 휠소터를 이용한 DAS")
  lineWorkers: { 5: 1, 6: 2, 7: 2 } as Record<5 | 6 | 7, number>,
  /** DPS(5F 냉동 전실) — 구역 수 · 구역당 작업자 · 컨베이어 속도(m/s) · 동시에 도는 박스 · 구역에서 박스 미는 시간(s) [가정] */
  dps: { zones: 5, workersPerZone: 1, conveyorSpeed: 0.4, maxBoxes: 20, zoneDwellSec: 3 },
};

export const WORKFORCE: Record<5 | 6 | 7, { fc: number; sort: number; jockey: number; replDay: number; replEve: number }> = {
  // sort = 6F 라인(DAS)·분배 작업자(번호 홀수 라인 · 짝수 분배). 5F·7F 는 피킹 = 분류라 분류대 사람 없이 FC·DPS 로 [사용자 2026-11-25 설계 §5.4]
  // 5F: 상온 FC 6 + DAS 2(냉동은 DPS 구역 작업자 FLOW.dps), 6F: DAS 4 + 분배 2, 7F: FC 7 + DAS 2 [사용자 §9]
  // 2026-11-25 가동률 분석으로 다시 배분(사용자 "유휴 인원 — 병목인지 인원 과다인지"): 5F·6F FC·자키는 가동 5~32%(일이 적음), 7F FC 는 91%(오토스토어 SKU 2,400 으로 늘어 병목) → 5F FC 6→3·자키 3→2, 6F FC 5→4·자키 3→2, 7F FC 7→10·자키 4→3
  // 2026-11-25 다시(사용자 "인원 과다 고쳐"): 상온 DAS 없앰 → 5F·7F 분류 0, 5F FC 3→2 · 6F FC 4→3, 자키 줄임, 6F 라인 2명(+분배 2명, 사용자 "라인 2~3명·분배 2명"). 보충은 13:00 전에 끝나야 해 5명 그대로(3명이면 배포가 늦어 출차 4대 늦음), DPS 도 구역당 2명 그대로(1명이면 마지막 피킹 21:45)
  5: { fc: 2, sort: 1, jockey: 1, replDay: 5, replEve: 1 },
  // 6F: 라인 6명(줄 3개에 2명씩 — 한 줄에서 색으로 내 몫 구분) + 분배 2명, 자키 3명(라인에 상품 박스 공급) [사용자 2026-11-25 "라인 2~3명·분배 2명", "라인 줄 수에 맞게"]
  6: { fc: 3, sort: 4, jockey: 2, replDay: 5, replEve: 1 },
  7: { fc: 7, sort: 2, jockey: 2, replDay: 5, replEve: 1 },
};

/** 작업 시간·속도 [가정] — 라인 1인 하루 약 2만 걸음 [현장] 을 보정 목표로 */
export const WORK = {
  /** 걷기(m/s) — 빈손·카트·지게차 */
  walk: 1.2,
  cart: 1.0,
  forklift: 1.8,
  /** 걸음 길이(m) — 걸음 수 표시 */
  stepLen: 0.7,
  /** FC: 선반 앞에서 지역 바코드·상품 스캔(초) + 낱개 하나 담기(초) */
  pickScan: 8,
  pickPerUnit: 1.5,
  /** FC 결품 확률(줄마다) [시뮬] */
  shortRate: 0.005,
  /** 분류대에 카트 내려놓기(초) */
  cartDrop: 20,
  /** 분배·라인: 박스 하나 시작(초) + 낱개 하나(초) — 상품 스캔 → 불·숫자대로 담기 [현장] */
  /** 라인(DAS): 상품 스캔 · 칸에 하나 넣기(s) · 칸 사이 옮겨 가기 — 분배: 상품 스캔 · 하나 담기 · 지역 바코드 [가정] */
  lineScan: 5,
  linePerUnit: 0.9,
  splitScan: 6,
  splitPerUnit: 1.3,
  regionScan: 4,
  /** 지역 카트에 MFC 작업을 몇 개까지 모으나 [가정] */
  cartMaxTasks: 5,
  /** 6F 라인 작업자 수(나머지 분류 인원은 분배), 한 줄에 몇 명 [가정] */
  lineWorkers: 6,
  perLine: 2,
  /** 무거운 상자(5F C·D) 피킹 시간 배수 [가정 — 현장 "무거운 상자 존"] */
  heavyFactor: 1.8,
  /** 분배 수량 실수 확률 · 다시 세는 시간(s) [가정 — 현장 "자잘한 야채가 많아 수량 실수가 잦다"] */
  splitMistake: 0.04,
  recount: 25,
  /** 작업자 속도 차이(배수 범위) [가정] */
  pace: [0.85, 1.15] as const,
  /** 좁은 선반 통로에 다른 사람이 있으면 기다리는 시간(s) [가정] */
  aisleBlockWait: 6,
  /** 휠소터: 투입 → MFC 롤테이너까지(s) [가정] */
  sorterTravel: 45,
  /** 오토스토어 포트: 로봇이 통을 가져오는 시간(s, 줄마다) [가정] */
  portBin: 12,
  /** 라인 공급: 자키가 모아 가는 기준 — 상품 박스 수 또는 기다린 시간(s) [가정] */
  lineBatch: 10,
  lineWaitMax: 300,
  /** 도크 상차 전 박스 스캔 대조(s/박스) [현장 "박스 작업자들이 확인하고 트럭에 싣고"] */
  loadScan: 3,
  sortStart: 10,
  sortPerUnit: 1.2,
  /** 자키: 롤테이너 싣고 내리기(초), 한 번에 옮기는 박스 수 */
  jockeyHandle: 15,
  jockeyBatch: 6,
  /** 지게차 보충: 팔레트 내리기(초) + 박스 뜯어 진열(초) + 낱개당(초) */
  replPallet: 60,
  replShelf: 30,
  replPerUnit: 0.3,
  /** 일이 없을 때 다시 묻기까지(초) */
  idlePoll: 30,
} as const;

/** 시뮬레이션 시작 시각(초, 0시 기준) — 주간조 시작 직전 */
export const SIM_START = 7 * 3600 + 55 * 60;

/** 피킹 Task 크기 [시뮬] — 서버 설정 pmart.outbound.batch-max-lines 에 해당(서버 기본값 없음 = 자르지 않음). 목은 카트 한 대 분량으로 위치 코드 순으로 자른다 */
export const TASK = {
  maxLines: 20,
} as const;

/**
 * 검품·하강·상차·출발 (설계 §5.1 #7~10, §12 ⑥). 차량·기사·배차·멀티드롭은 §12 ⑦ TMS — 그 전까지 MFC 마다 차 한 대를 상온 접안(C)에 둔다 [시뮬].
 * 하루 시간표 [정본 CDC-8, PR #447 — TMS-business-logic 2.1]: 21:30 WMS 출고 작업 완료 · 22:00 PDA R/T 카운팅(박스 스캔 → R/T, 온도대별)
 * · 22:00~22:30 TMS 배차 · 22:30~ 방문 역순 상차 · 23:00~ 첫 출차(이때만 TOUT). 적재 = 롤테이너(R/T), 수량 검증 = 박스 바코드, 간선에 팔레트 없음.
 */
export const OUTBOUND = {
  /** 층마다 검품원(석간) · 도크 상차 작업자 수 [가정] */
  inspectorsPerFloor: 1,
  /** 도크 상차 인원(도크 층마다 나눔) — 상차 전 박스 스캔 대조(사용자 2026-11-25)로 4 → 6 [가정] */
  loaders: 6,
  /** 층마다 야간 자키(22:00~ R/T 하강) [가정] */
  nightJockeys: 1,
  /** 도크 상차 근무 22:00~다음 날 04:30 [가정] — 노선별 출차(01:50~03:40, TMS 출차 공식) 30분 전부터 싣는다 */
  loaderShift: { start: 22 * 60, end: 28 * 60 + 30 },
  rtCountAt: 22 * 60,
  loadFrom: 22 * 60 + 30,
  /** 출차 — 23:00 부터, 그 MFC R/T 를 다 실은 차부터. 늦어도 이 시각(분)엔 실은 것만으로 출차 [가정] */
  departLatest: 24 * 60,
  /** MFC 도착 — 마지막 도착 07:30, 하차·인계 완료 08:00 (MFC 08:00 영업) [정본 TMS 2.2, PR #448] — §12 ⑦ 운송에서 쓴다 */
  mfcLastArrival: 7 * 60 + 30,
  mfcHandoverDone: 8 * 60,
  /** 검품: 박스 하나(초) · 불합격 확률 · 재포장 뒤 재검품(초) */
  inspectPerBox: 20,
  inspectFailRate: 0.005,
  rework: 90,
  /** R/T 승강기 하강 — 21:30(WMS 출고 작업 완료 [CDC-8])부터, 그 MFC 의 층 일이 다 끝났으면 더 일찍 */
  lowerFrom: 21 * 60 + 30,
  /** R/T 한 대에 싣는 박스 수 [가정] */
  boxesPerRt: 10,
  /** 분류 박스 하나에 담는 최대 낱개 수 [가정] — 넘으면 박스를 나눈다 */
  boxMaxUnits: 120,
  liftRide: 60,
  /** 도크: 롤테이너 한 대 싣기(초) */
  loadPerRoll: 25,
} as const;

/**
 * TMS — 고정 노선·주행 시간·차량 [정본 TMS 2.2 / 가정] (설계 §12 ⑦).
 * 정규차는 고정 노선 × 온도대로 운송지시서를 만든다(§4.3). 차 한 대 = 온도대 하나(혼적 금지, §4.4). 5톤 기본 20 R/T·5,000kg [가정 TMS].
 * 멀티드롭 최대 3곳, 방문 순서는 노선 마스터, 상차는 방문 역순(§7.4). 출차 = max(23:00, 첫 MFC 도착 목표 − 주행)(§3).
 * 주행 시간: 칠곡→부산진구 110·진구→남구 20·남구→칠곡 115 은 TMS §22 사례 [가정], 나머지는 지도 거리로 잡은 [가정] — 행렬은 미정(§24).
 */
export const TMS = {
  /** 고정 노선 — 4지역(사용자 2026-11-25) 그대로 */
  routes: [
    { routeId: 'RT-BUSAN', region: '부산권', stops: ['MFC-BJG-01', 'MFC-BNG-01'] },
    { routeId: 'RT-HONAM', region: '호남권', stops: ['MFC-MOKPO-01'] },
    { routeId: 'RT-CHUNGCHEONG', region: '충청권', stops: ['MFC-SEJ-01'] },
    { routeId: 'RT-GANGWON', region: '강원권', stops: ['MFC-CHC-01'] },
  ],
  /**
   * 주행 시간(분) — 'CDC01' 은 칠곡 [사용자 2026-11-25 노선표]. 편도 = 칠곡 → 목포 4:30 · 세종 2:30 · 춘천 4:30 · 부산진구 2:30, 부산진구 → 부산남구 0:20.
   * 돌아오는 길은 같은 시간으로 본다(부산남구 → 칠곡 = 칠곡 → 부산진구 2:30) [가정]. 정차마다 하차·인계 30분(부산 통합 노선 작업 1시간 = 30분 × 2).
   */
  travelMin: {
    'CDC01>MFC-BJG-01': 150,
    'MFC-BJG-01>MFC-BNG-01': 20,
    'MFC-BNG-01>CDC01': 150,
    'CDC01>MFC-MOKPO-01': 270,
    'MFC-MOKPO-01>CDC01': 270,
    'CDC01>MFC-SEJ-01': 150,
    'MFC-SEJ-01>CDC01': 150,
    'CDC01>MFC-CHC-01': 270,
    'MFC-CHC-01>CDC01': 270,
  } as Record<string, number>,
  /** 첫 MFC 도착 목표(분, D일 0시 기준 — 다음 날 05:30) [사용자 2026-11-25 "첫 MFC 도착 목표 05:30"] — 출차 = 05:30 − 첫 구간 주행 */
  firstArrivalTarget: 24 * 60 + 5 * 60 + 30,
  /** MFC 하차·인계 30분 [사용자 노선표 작업시간 30분], 한 MFC 동시 하차 최대 3대 [정본 TMS §3] */
  unloadMin: 30,
  unloadBaysPerMfc: 3,
  /** 상차는 노선별 출차 30분 전부터 [정본 TMS §3] */
  loadLeadMin: 30,
  /** 출차가 늦어지면 기다리는 최대(분) — 그 뒤엔 실은 것만으로 출차하고 지연 사고를 남긴다 [가정] */
  maxDepartDelayMin: 60,
  /** 정규차 — 5톤, 20 R/T, 5,000kg [가정 TMS §4.4] */
  vehicle: { vehicleClass: 'TRUCK_5T' as const, maxRt: 20, maxWeightKg: 5000 },
  /** 기사 이름 [시뮬] — 실제 인물 아님 */
  driverNames: ['김기사', '이기사', '박기사', '최기사', '정기사', '강기사', '조기사', '윤기사', '장기사', '임기사', '한기사', '오기사', '서기사', '신기사'],
} as const;

/**
 * 통로 피킹 방식 [시뮬 — cdc-location 0.5.0 aisle-pick-methods(통로별 설정값)를 칠곡 배치로 정함, R-19 ⑤].
 * 방식이 작업 모양을 정한다(cdc-outbound 0.9.0): DPS·방식 없음 → DISCRETE(TRF 하나), BOX_PICK·FC·DISTRIBUTION → REGION_BATCH(지역 묶음), LINE → SKU_BATCH(Wave 안 모든 MFC).
 * - 냉동 선반(A) = DPS · 랙 1단 박스 피킹면 = BOX_PICK · 6F 야채 바닥 레인(93) = DISTRIBUTION · 6F 냉장 선반(B) = LINE(라인 DAS) · 그 밖 선반·오토스토어 = FC.
 */
export const AISLE_PICK_METHOD = {
  frozenShelfZone: 'H',
  lineShelfZone: 'G',
  /** 상온에서 DAS 로 가는 선반 구역(모든 MFC 몫을 SKU 로 묶어 집는 LINE 통로) [가정] — 5F F 인기상품 · 7F G 생활용품 선반 */
  ambientLineZones: ['D', 'E'] as readonly string[],
  vegLaneAisle: 93,
} as const;

/**
 * 지역 ↔ MFC 대응표 처음 값 [확정 — cdc-outbound 0.9.0 `GET /cdcs/{cdcId}/regions` 칠곡 처음 값, chilgok-dc.md CDC-6]. 지역 코드 = PDA 지역 바코드 값.
 */
export const REGIONS: { regionCode: string; regionName: string; mfcIds: string[] }[] = [
  { regionCode: 'BUSAN', regionName: '부산권', mfcIds: ['MFC-BJG-01', 'MFC-BNG-01'] },
  { regionCode: 'CHUNGCHEONG', regionName: '충청권', mfcIds: ['MFC-SEJ-01'] },
  { regionCode: 'GANGWON', regionName: '강원권', mfcIds: ['MFC-CHC-01'] },
  { regionCode: 'HONAM', regionName: '호남권', mfcIds: ['MFC-MOKPO-01'] },
];

/**
 * 입고(화면 흐름만) [시뮬, 사용자 2026-11-26 "검수 구역에 진짜 박스가 들어와야 해. MFC 처럼"].
 * 입고 업무는 범위 밖(scope S-3) — 서버 호출·재고 원장 변동 없이, 아침에 입고 차가 층 도크에 대고 입고 검수원이
 * 팔레트를 핸드자키로 검수 대기 칸 → 검수 → 검수 완료 칸 → 랙 앞(지게차에 넘김)으로 옮기는 모습만 돌린다.
 */
export const INBOUND = {
  /** 층마다 입고 차 대수 · 첫 도착(분) · 간격(분) · 차 한 대 팔레트 수 [가정] */
  trucksPerFloor: 7,
  firstMin: 8 * 60,
  everyMin: 40,
  palletsPerTruck: 6,
  /** 층마다 입고 검수원 수(주간) [가정] */
  workers: 1,
  /** 팔레트 하나 내리기 · 검수 · 랙 앞에 내려놓기(초) [가정] */
  unloadSec: 50,
  inspectSec: 300,
  putawaySec: 40,
} as const;
