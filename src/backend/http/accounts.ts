// 실서버 모드에서 시뮬레이터가 쓰는 LAN 시험 계정 — MFC 시뮬레이터 accounts.ts 와 같은 틀.
// 2026-11-25: 백엔드 docs/operations/lan-test-accounts.md 에 CDC(칠곡 CDC01) 시험 계정이 아직 없다 → R-16 으로 요청.
// 계정이 정해지기 전에는 아무 계정도 허락하지 않는다(개발 서버가 비밀번호 파일을 읽지 않는다).

/** Keycloak 아이디 = 사내 메일 전체(ADR-0056 결정 7). 짧게 주면 @pmart.com 을 붙인다. */
export function keycloakUsername(account: string): string {
  return account.includes('@') ? account : `${account}@pmart.com`;
}

/** 시뮬레이터가 토큰을 받아도 되는 계정 → 비밀번호 파일 이름. 지금은 없음(R-16). */
export function passwordFileFor(_account: string): string | null {
  return null;
}

/** 실서버 모드 기본 계정 이름 [가정] — R-16 답에 맞춰 바꾼다 */
export const CDC_OPERATOR_ACCOUNT = 'claude-cdc-op';

/** POST /sim-auth/tokens 응답 (Vite 개발 서버 → 브라우저). 토큰만 오고 비밀번호는 오지 않는다. */
export interface SimToken {
  account: string;
  operatorId: string;
  accessToken: string;
  /** ISO 시각 */
  accessTokenExpiresAt: string;
}
