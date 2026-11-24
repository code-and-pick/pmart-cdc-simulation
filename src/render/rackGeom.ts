// 팔레트 랙 모양 수치 — 장면(SiteScene)·클릭 판정·칸 번호(Core)가 같이 쓴다. 규격 [사용자 2026-11-25 랙 규격표].
import { RACK } from '../config';

/** 빔 높이 */
export const BEAM_H = 0.12;
/** 빔 중심 높이 — 1단은 사진처럼 바닥 가까운 낮은 빔, 2~4단은 2·4·6m */
export const beamY = (lv: number) => (lv === 1 ? 0.15 : (lv - 1) * RACK.levelH);
/** 팔레트 짐 최대 높이 — 단 2m 에서 빔·여유를 뺀 만큼 */
export const LOAD_MAX = Math.min(RACK.pallet.h, RACK.levelH - 0.3);
