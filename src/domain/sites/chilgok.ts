// 칠곡 DC 배치 데이터 — 코드에 배치를 박지 않고 센터별 데이터로 둔다(ADR-0050, 설계 §3.3).
// 근거: 백엔드 docs/simulator/cdc/chilgok-dc.md CDC-2(R-09 확정 + R-10 사용자 교환 2026-11-24), 설계 docs/design/cdc-design.md §3.2·§4.1.

import { RACK } from '../../config';

export type Temp ='AMBIENT' | 'CHILLED' | 'FROZEN';
export type FloorNo = 5 | 6 | 7;
export type FloorKey = FloorNo;

/** 랙 구역 — 글자는 MFC 시뮬레이터 체계(A 냉동·B 냉장·C~H 상온 계열, 사용자 2026-11-24) */
export interface RackZoneSpec {
  letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  temp: Temp;
  label: string;
  /** 그 온도대 방 안에서 팔레트 통로를 나눌 몫 — 통로 수는 방 면적에서 나온다(layout.sitePlan) [가정] */
  share: number;
  /** 피킹 선반 칸을 같은 온도대끼리 나눌 몫(옛 값 — SKU 목표는 SKU_TARGET) — 없으면 통로 수. 0 이면 SKU 수만큼만 [시뮬] */
  shelfShare?: number;
  /** 피킹 칸이 오토스토어 빈(bin) — 선반을 세우지 않고 작업자 앞 포트로 통이 온다 [사용자 2026-11-25 "7F 비식재만 실제 사용"] */
  bins?: boolean;
  /** 단 수 — 모든 구역 4(1 피킹·2 보충 대기·3~4 리저브) [사용자 2026-11-25 랙 규격] */
  levels: number;
}

/** 랙이 아닌 설비 자리(3D 표현용) — 백엔드와 주고받지 않는다(WMS 0.6, 설계 §5.3) */
export type EquipKind = 'WHEEL_SORTER' | 'DPS' | 'DAS' | 'SPLIT' | 'AUTOSTORE' | 'INBOUND' | 'OFFICE' | 'VEG_LANES';

export interface FloorSpec {
  floor: FloorNo;
  label: string;
  /** 왼쪽(서쪽)부터 놓을 랙 구역 순서 */
  zones: RackZoneSpec[];
  /** 문서 면적(평) — 보관 방은 이 평수 그대로, 나머지가 DT [정본 CDC-2, 사용자 2026-11-25 문서 면적 고정] */
  docPyeong: { storage: Record<string, number>; dt: number };
  /** 출고대기(91)·승강기 문(92)에 쓰는 구역 글자 — 그 층 구역 [정본 CDC-5] */
  stagingLetters: ('A' | 'E' | 'G' | 'H')[];
  liftLetter: 'A' | 'E' | 'G';
  /** 설비 자리(모두 DT) — band 북쪽 띠(선반 동쪽), east 보관 방 동쪽 [사용자 2026-11-25 2안] */
  equipment: { kind: EquipKind; label: string; where: 'band' | 'east'; temp?: Temp; weight?: number; maxW?: number; len?: number }[];
}

const amb = (letter: RackZoneSpec['letter'], label: string, shelfShare?: number): RackZoneSpec => ({ letter, temp: 'AMBIENT', label, share: 1, shelfShare, levels: RACK.levels });

// 층 구성(사용자 2026-11-26 물량 30만 재설계 — "5F 냉장+냉동, 6F·7F 상온", 구역 글자는 그대로 층만 이동):
//  5F 저온 — 냉장 G(서쪽: 랙 · 피킹 선반 · 분배 · 야채 레인 · DAS) + 냉동 H(동쪽 방: 랙 · DPS 전실)
//  6F 상온 A~D(A·B 무거운 상자 · C · D 인기상품) · 7F 생활용품 E·F(오토스토어). 상온 입고 검수·도크는 6F·7F 각각.
// 문서 면적(평, 보관 방 = 랙 방): 5F 냉장 랙 3일치 + 냉동 랙 약 7일치(물량 30만 계산), 6F·7F 상온 2,067 [시뮬 — CDC-2 정본에서 바뀜, 백엔드 요청 R-25]
export const CHILGOK_FLOORS: FloorSpec[] = [
  {
    floor: 5,
    label: '5F 냉장·냉동',
    zones: [
      { letter: 'G', temp: 'CHILLED', label: '냉장 G', share: 1, levels: RACK.levels },
      { letter: 'H', temp: 'FROZEN', label: '냉동 H', share: 1, levels: RACK.levels },
    ],
    // 건물 크기는 그대로(보관 방 합 2,233평 — 예전 5F 상온 1,233 + 냉동 1,000이 건물 폭). 냉장 랙은 3일치 계산, 나머지 냉동 쪽(전실·입고 검수 포함)
    docPyeong: { storage: { 냉장: 640, 냉동: 1593 }, dt: 633 },
    stagingLetters: ['G', 'H'],
    liftLetter: 'G',
    equipment: [
      { kind: 'INBOUND', label: '입고 검수 (냉장)', where: 'band', temp: 'CHILLED', maxW: 14 },
      { kind: 'INBOUND', label: '입고 검수 (냉동)', where: 'band', temp: 'FROZEN', maxW: 14 },
      { kind: 'DAS', label: '라인 (DAS)', where: 'east' },
      { kind: 'SPLIT', label: '분배 (야채 크레이트)', where: 'east' },
      { kind: 'DPS', label: 'DPS 박스 컨베이어 (냉동)', where: 'band', weight: 0.55 },
    ],
  },
  {
    floor: 6,
    label: '6F 상온',
    zones: [amb('A', '상온 A (무거운 상자)', 0), amb('B', '상온 B (무거운 상자)', 0), { ...amb('C', '상온 C (소형 — 오토스토어)', 0), bins: true }, amb('D', '상온 D (인기상품)', 0)],
    // 상온 랙은 건물 폭 끝까지, 묶음 10칸(RACK_BUNDLE_BAYS)이라 남쪽으로 짧아 북쪽 띠가 넓음 — 보관 방 = 건물 폭 × 랙 깊이(사용자 2026-11-26 "건물은 그대로, 상온 팔레트 랙을 남쪽으로 줄이고 북쪽을 늘려")
    docPyeong: { storage: { 상온: 1908 }, dt: 959 },
    stagingLetters: ['A'],
    liftLetter: 'A',
    equipment: [
      { kind: 'WHEEL_SORTER', label: '1차 고속분류기(휠소터) (A·B 박스 → MFC 롤테이너)', where: 'band', weight: 1.3 },
      { kind: 'INBOUND', label: '입고 검수 (상온)', where: 'band', temp: 'AMBIENT', maxW: 14 },
    ],
  },
  {
    floor: 7,
    label: '7F 생활용품',
    zones: [amb('E', '생활용품 E'), { ...amb('F', '생활용품 F (비식재 소형)'), bins: true }],
    docPyeong: { storage: { 상온: 1908 }, dt: 959 },
    stagingLetters: ['E'],
    liftLetter: 'E',
    equipment: [
      { kind: 'AUTOSTORE', label: '오토스토어 (비식재 H)', where: 'band', weight: 2.2 },
      { kind: 'INBOUND', label: '입고 검수 (상온)', where: 'band', temp: 'AMBIENT', maxW: 14 },
      // DC 관리자 사무실(사용자 2026-11-25 "7층에 dc 관리자 사무실") — 보관 방 동쪽 DT
      { kind: 'OFFICE', label: 'DC 관리자 사무실', where: 'east', len: 18 },
    ],
  },
];
