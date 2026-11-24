// 실서버 모드에서 시뮬레이터가 쓰는 LAN 시험 계정 — MFC 시뮬레이터 accounts.ts 와 같은 틀.
// 2026-11-25: CDC(칠곡 CDC01) 시험 계정은 아직 없다. 백엔드 R-16 회신(PR #453, pc1-todo)의 **이름 제안**:
//   운영자 claude-cdc-sup · FC cdcw-fc-01~10 · 분배/라인 cdcw-dl-01~05 · 검품 cdcw-qc-01~05 · 상차 cdcw-ld-01~05 · 지게차 cdcw-fk-01~03 (센터 클레임 CDC01)
// PC1 이 실제로 만들고 lan-test-accounts.md 에 적으면 확정 이름·비밀번호 파일 이름을 받아 passwordFileFor 를 연다. 그 전에는 아무 계정도 허락하지 않는다.

/** Keycloak 아이디 = 사내 메일 전체(ADR-0056 결정 7). 짧게 주면 @pmart.com 을 붙인다. */
export function keycloakUsername(account: string): string {
  return account.includes('@') ? account : `${account}@pmart.com`;
}

/** 시뮬레이터가 토큰을 받아도 되는 계정 → 비밀번호 파일 이름. 지금은 없음(R-16). */
export function passwordFileFor(_account: string): string | null {
  return null;
}

/** 실서버 모드 운영자 계정 [제안 — R-16 회신] */
export const CDC_OPERATOR_ACCOUNT = 'claude-cdc-sup';

/** 가상 작업자 계정 이름 [제안 — R-16 회신] — 시뮬레이터 역할 → 계정 */
export const CDC_WORKER_ACCOUNTS = {
  FC: Array.from({ length: 10 }, (_, i) => `cdcw-fc-${String(i + 1).padStart(2, '0')}`),
  SORT: Array.from({ length: 5 }, (_, i) => `cdcw-dl-${String(i + 1).padStart(2, '0')}`),
  INSPECT: Array.from({ length: 5 }, (_, i) => `cdcw-qc-${String(i + 1).padStart(2, '0')}`),
  LOADER: Array.from({ length: 5 }, (_, i) => `cdcw-ld-${String(i + 1).padStart(2, '0')}`),
  REPL: Array.from({ length: 3 }, (_, i) => `cdcw-fk-${String(i + 1).padStart(2, '0')}`),
} as const;

/** POST /sim-auth/tokens 응답 (Vite 개발 서버 → 브라우저). 토큰만 오고 비밀번호는 오지 않는다. */
export interface SimToken {
  account: string;
  operatorId: string;
  accessToken: string;
  /** ISO 시각 */
  accessTokenExpiresAt: string;
}
