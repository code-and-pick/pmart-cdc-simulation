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
  /**
   * 피킹 선반 칸 수(이상) — MFC 설계 10,900 SKU 에 맞춰 칸 하나 = SKU 하나 [사용자 2026-11-25 "10,900 설계에 맞춰 선반 확장", 백엔드 B-1·CDC-7].
   * 냉동 A 2,180 · 냉장 B 3,270 · 상온 5,450(C~H 를 팔레트 통로 수 비율로 나눔). 통로 하나 240칸이라 통로 단위로 올림.
   */
  targetSlots: { FROZEN: 2180, CHILLED: 3270, AMBIENT: 5450 },
} as const;

/**
 * 작업자 수(층마다) [가정] — 자료에 없음(설계 §6). 일용직은 시작할 때 FC·분배·라인에 배정 [현장].
 * repl = 지게차 선반 보충(주간조 08~17 + 석간 1명 — 부족 재할당분 보충), fc = FC 피커, sort = 분배·라인(DAS·DPS·분류기 앞), jockey = 자키(롤테이너를 출고대기로).
 */
export const WORKFORCE: Record<5 | 6 | 7, { fc: number; sort: number; jockey: number; replDay: number; replEve: number }> = {
  5: { fc: 6, sort: 2, jockey: 2, replDay: 3, replEve: 1 },
  6: { fc: 5, sort: 2, jockey: 2, replDay: 3, replEve: 1 },
  7: { fc: 5, sort: 2, jockey: 2, replDay: 3, replEve: 1 },
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

/** 피킹 Task 크기 [시뮬] — 카트 한 대에 싣는 줄 수(TRF·층·구역 안에서 동선 순으로 자름) */
export const TASK = {
  maxLines: 20,
} as const;

/**
 * 검품·하강·상차·출발 (설계 §5.1 #7~10, §12 ⑥). 차량·기사·배차·멀티드롭은 §12 ⑦ TMS — 그 전까지 MFC 마다 차 한 대를 상온 접안(C)에 둔다 [시뮬].
 * 하루 시간표 [정본 CDC-8, PR #447 — TMS-business-logic 2.1]: 21:30 WMS 출고 작업 완료 · 22:00 PDA R/T 카운팅(박스 스캔 → R/T, 온도대별)
 * · 22:00~22:30 TMS 배차 · 22:30~ 방문 역순 상차 · 23:00~ 첫 출차(이때만 TOUT). 적재 = 롤테이너(R/T), 수량 검증 = 박스 바코드, 간선에 팔레트 없음.
 */
export const OUTBOUND = {
  /** 층마다 검품원(석간) · 지하 상차 작업자(19~23시) 수 [가정] */
  inspectorsPerFloor: 1,
  loaders: 4,
  /** 지하 상차 근무 22:00~다음 날 04:30 [가정] — 노선별 출차(01:50~03:40, TMS 출차 공식) 30분 전부터 싣는다 */
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
  /** 지하: 롤테이너 한 대 싣기(초) */
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
  /** 주행 시간(분) — 'CDC01' 은 칠곡 */
  travelMin: {
    'CDC01>MFC-BJG-01': 110,
    'MFC-BJG-01>MFC-BNG-01': 20,
    'MFC-BNG-01>CDC01': 115,
    'CDC01>MFC-MOKPO-01': 210,
    'MFC-MOKPO-01>CDC01': 210,
    'CDC01>MFC-SEJ-01': 120,
    'MFC-SEJ-01>CDC01': 120,
    'CDC01>MFC-CHC-01': 220,
    'MFC-CHC-01>CDC01': 220,
  } as Record<string, number>,
  /** 첫 MFC 도착 목표(분, D일 0시 기준 — 다음 날 05:30) [가정, TMS §3 첫 도착 05:00~06:00] */
  firstArrivalTarget: 24 * 60 + 5 * 60 + 30,
  /** MFC 하차 30분, 한 MFC 동시 하차 최대 3대 [정본 TMS §3] */
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
