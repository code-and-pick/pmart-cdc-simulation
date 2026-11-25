// MFC 시뮬레이터 src/ui/scanView.ts 그대로 복사(2026-11-25 사용자 지시문 §6 — 바코드 메뉴)
// 스캔 판 표시 상태: QR/1차원 바코드 전환, "크게" 보기. 여러 패널·오버레이가 같이 본다(React 상태 밖 작은 저장소).
import { useSyncExternalStore } from 'react';

export type ScanCodeMode = 'qr' | 'bar';
export interface ZoomCode {
  value: string;
  /** gs1 = 늘 GS1-128 1차원(LOT 라벨, value 는 괄호 꼴). 그 밖은 QR/바코드 전환을 따른다 */
  kind: 'code128' | 'ean13' | 'gs1';
  caption?: string;
}

let mode: ScanCodeMode = 'qr';
let zoom: ZoomCode | null = null;
let ver = 0;
const subs = new Set<() => void>();
const emit = () => {
  ver++;
  subs.forEach((f) => f());
};

export const scanView = {
  get mode() {
    return mode;
  },
  get zoom() {
    return zoom;
  },
  setMode(m: ScanCodeMode) {
    mode = m;
    emit();
  },
  open(z: ZoomCode) {
    zoom = z;
    emit();
  },
  close() {
    zoom = null;
    emit();
  },
};

export function useScanView() {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ver,
  );
  return scanView;
}
