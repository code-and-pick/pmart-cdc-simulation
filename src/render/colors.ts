// 색 — MFC 시뮬레이터 render/colors.ts 의 밝은 도면풍 장면 색을 그대로 쓴다(사용자 2026-11-20 MFC 결정).
// 랙은 사진(우아한청년들)과도 같다: 파란 기둥·주황 빔.
import type { Temp } from '../domain/sites/chilgok';

export const ZONE_COLOR: Record<Temp, number> = {
  FROZEN: 0x67a6d6, // 냉동 — 하늘색
  CHILLED: 0x84bd63, // 냉장 — 연두색
  AMBIENT: 0xdcbd52, // 상온 — 노란색
};

export const SCENE = {
  backdrop: 0xe3e6ef,
  /** 건물 바깥 땅 — MFC outside */
  outside: 0xdfe2eb,
  floor: 0xeceef4,
  band: 0xf4f0f7,
  zoneTint: 0.16,
  wall: 0xeaf0fb,
  rackPost: 0x1f73f0,
  rackBeam: 0xff9d2e,
  box: 0xe2b27a,
  pallet: 0xc79a5b,
  lift: 0x9aa3b2,
  liftDoor: 0x5d6675,
  rollContainer: 0x2f6fd6,
  coldCover: 0xc9cfd6,
  conveyor: 0x1f63d0,
  autostore: 0x3a3f4a,
  hazard: 0xf2c200,
  /** 피킹 선반 — MFC 시뮬레이터처럼 회색 철제 선반 */
  shelfPost: 0x5d6675,
  shelfBoard: 0xc9ced8,
  pill: '#5b4fd6',
  selected: 0x8b5cf6,
};

/**
 * 구역 바닥색 — MFC 시뮬레이터 ZONE_FLOOR 와 같은 계열(냉동 옅은 하늘·냉장 옅은 연두, 나머지 밝은 색) + 경계는 흰 실선.
 * DC 에만 있는 구역: 팔레트 보관(MFC 입고창고 자리 — 옅은 나무빛), 승강기·출고대기 띠(옅은 회보라), 설비(옅은 회청) [시뮬].
 */
export const ZONE_FLOOR = {
  FROZEN: 0xd3e2f6,
  CHILLED: 0xdaeacf,
  AMBIENT: 0xeceef4,
  /** 상온 팔레트 보관 랙 구역 */
  AMBIENT_STORE: 0xf1e9d8,
  BAND: 0xe6e3f0,
  EQUIP: 0xdde3ec,
} as const;

/** 구역 이름판(알약) 색 [아래 진하게, 위 밝게] — MFC ZoneNames PILL 그대로 + DC 구역 */
export const ZONE_PILL: Record<string, [string, string]> = {
  FROZEN: ['#2f6fd8', '#5b9bf2'],
  CHILLED: ['#2e9a5c', '#56c286'],
  AMBIENT: ['#d9861c', '#f2a94a'],
  AMBIENT_STORE: ['#1f8f9c', '#3fb6c2'],
  BAND: ['#6d4fd6', '#8f74ee'],
  EQUIP: ['#3d5bd1', '#6a84ec'],
};

/** 선반 상품 상자 색 — MFC zoneBoxColor: 상온 흰 상자, 저온은 구역 바닥색을 조금 진하게 */
export function zoneBoxColor(temp: 'AMBIENT' | 'CHILLED' | 'FROZEN', out: { setHex: (n: number) => { offsetHSL: (h: number, s: number, l: number) => unknown } }) {
  if (temp === 'AMBIENT') return out.setHex(0xffffff);
  return out.setHex(ZONE_FLOOR[temp]).offsetHSL(0, 0.18, -0.1);
}
