// 칠곡 DC 배치 데이터 — 코드에 배치를 박지 않고 센터별 데이터로 둔다(ADR-0050, 설계 §3.3).
// 근거: 백엔드 docs/simulator/cdc/chilgok-dc.md CDC-2(R-09 확정 + R-10 사용자 교환 2026-11-24), 설계 docs/design/cdc-design.md §3.2·§4.1.

import { RACK } from '../../config';

export type Temp ='AMBIENT' | 'CHILLED' | 'FROZEN';
export type FloorNo = 5 | 6 | 7;

/** 랙 구역 — 글자는 MFC 시뮬레이터 체계(A 냉동·B 냉장·C~H 상온 계열, 사용자 2026-11-24) */
export interface RackZoneSpec {
  letter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  temp: Temp;
  label: string;
  aisles: number;
  /** 단 수 — 모든 구역 4(1 피킹·2 보충 대기·3~4 리저브) [사용자 2026-11-25 랙 규격] */
  levels: number;
}

/** 랙이 아닌 설비 자리(3D 표현용) — 백엔드와 주고받지 않는다(WMS 0.6, 설계 §5.3) */
export type EquipKind = 'WHEEL_SORTER' | 'DPS' | 'DAS' | 'SPLIT' | 'AUTOSTORE';

export interface FloorSpec {
  floor: FloorNo;
  label: string;
  /** 왼쪽(서쪽)부터 놓을 랙 구역 순서 */
  zones: RackZoneSpec[];
  /** 문서 면적(평) — 배치 면적과 조금 다를 수 있다 [정본 CDC-2] */
  docPyeong: { storage: Record<string, number>; dt: number };
  /** 출고대기(91)·승강기 문(92)에 쓰는 구역 글자 — 그 층 구역 [정본 CDC-5] */
  stagingLetters: ('A' | 'B' | 'C' | 'G')[];
  liftLetter: 'B' | 'C' | 'G';
  /** 남는 폭(랙 동쪽)·도크 띠에 놓을 설비 */
  equipment: { kind: EquipKind; label: string; where: 'band' | 'east' }[];
}

const amb = (letter: RackZoneSpec['letter'], label: string, aisles: number): RackZoneSpec => ({ letter, temp: 'AMBIENT', label, aisles, levels: RACK.levels });

export const CHILGOK_FLOORS: FloorSpec[] = [
  {
    floor: 5,
    label: '5F 상온·냉동',
    zones: [
      amb('C', '상온 C (무거운 상자)', 3),
      amb('D', '상온 D (무거운 상자)', 3),
      amb('E', '상온 E', 3),
      amb('F', '상온 F (인기상품)', 3),
      { letter: 'A', temp: 'FROZEN', label: '냉동 A', aisles: 12, levels: RACK.levels },
    ],
    docPyeong: { storage: { 상온: 1233, 냉동: 1000 }, dt: 633 },
    stagingLetters: ['C', 'A'],
    liftLetter: 'C',
    equipment: [
      { kind: 'WHEEL_SORTER', label: '1차 고속분류기(휠소터)', where: 'band' },
      { kind: 'DPS', label: 'DPS (냉동)', where: 'band' },
      // 백엔드 R-10 회신: E·F 각 01~03 은 오토스토어(R-09 그대로)
      { kind: 'AUTOSTORE', label: '오토스토어 (E·F)', where: 'band' },
    ],
  },
  {
    floor: 6,
    label: '6F 냉장',
    zones: [{ letter: 'B', temp: 'CHILLED', label: '냉장 B', aisles: 18, levels: RACK.levels }],
    docPyeong: { storage: { 냉장: 1700 }, dt: 1167 },
    stagingLetters: ['B'],
    liftLetter: 'B',
    equipment: [
      { kind: 'DAS', label: '라인 (DAS)', where: 'east' },
      { kind: 'SPLIT', label: '분배 (야채 크레이트)', where: 'east' },
    ],
  },
  {
    floor: 7,
    label: '7F 생활용품',
    zones: [amb('G', '생활용품 G', 10), amb('H', '생활용품 H', 10)],
    docPyeong: { storage: { 상온: 2067 }, dt: 800 },
    stagingLetters: ['G'],
    liftLetter: 'G',
    equipment: [{ kind: 'AUTOSTORE', label: '오토스토어 (비식재)', where: 'east' }],
  },
];
