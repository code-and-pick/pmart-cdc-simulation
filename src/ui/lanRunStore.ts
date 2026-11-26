// 실서버 한 건 돌리기 상태 — 패널(설정 탭) 밖에 둔다. 3D 를 누르면 왼쪽 패널이 구역 탭으로 바뀌며 설정 탭이 닫혀
// 진행 단계·PDA 코드 팝업이 함께 사라지던 것(사용자 2026-11-26 "화면 누르니까 팝업창이 없어졌어"). 돌던 실행은 그대로 이어지고 화면만 다시 붙는다.
import { useSyncExternalStore } from 'react';
import type { RunStep } from '../backend/http/lanRun';

export interface LanRunState {
  steps: RunStep[] | null;
  busy: boolean;
  mfcId: string;
  mode: 'auto' | 'pda';
  /** PDA 코드 팝업을 접었나(단계가 바뀌면 다시 펼침) */
  hideScan: boolean;
  lastStep?: string;
  /** 오른쪽 탭에 흐름을 보일 TRF(실서버) */
  trfId?: string;
}

const KEEP = 'cdc-sim-lan-trf';
const kept = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEEP);
let state: LanRunState = { steps: null, busy: false, mfcId: 'MFC-BJG-01', mode: 'pda', hideScan: false, ...(kept ? { trfId: kept } : {}) };
const subs = new Set<() => void>();

export function setLanRun(p: Partial<LanRunState>) {
  const next = { ...state, ...p };
  const name = next.steps?.at(-1)?.name;
  if (p.steps && name !== state.lastStep) {
    next.lastStep = name;
    next.hideScan = false;
  }
  state = next;
  // 보던 TRF 는 새로고침해도 남김(사용자 2026-11-26 "도착 보내기 단추가 있던 탭이 없어졌어")
  if ('trfId' in p && typeof sessionStorage !== 'undefined') {
    if (next.trfId) sessionStorage.setItem(KEEP, next.trfId);
    else sessionStorage.removeItem(KEEP);
  }
  for (const f of subs) f();
}

export function useLanRun(): LanRunState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}
