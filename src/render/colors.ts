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
  pill: '#5b4fd6',
  selected: 0x8b5cf6,
};
