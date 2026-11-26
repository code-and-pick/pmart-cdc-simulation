// 실서버 모드에서 시뮬레이터가 쓰는 LAN 시험 계정 — MFC 시뮬레이터 accounts.ts 와 같은 틀.
// 2026-11-26: 칠곡 CDC01 시험 계정 29개가 생겼다(백엔드 lan-test-accounts.md §2-5) — 센터 관리자 claude-cdc-sup(CDC_SUPERVISOR), 작업자 cdcw-fc·dl·qc·ld·fk(CDC_WORKER, 공용 비밀번호 파일).
// 비밀번호 파일 내용은 개발 서버(server/simAuth.ts)가 실행 중에만 읽는다 — 저장소·로그에 남기지 않는다.

/** Keycloak 아이디 = 사내 메일 전체(ADR-0056 결정 7). 짧게 주면 @pmart.com 을 붙인다. */
export function keycloakUsername(account: string): string {
  return account.includes('@') ? account : `${account}@pmart.com`;
}

/** 시뮬레이터가 토큰을 받아도 되는 계정 → 비밀번호 파일 이름(lan-test-accounts.md §2-5) */
export function passwordFileFor(account: string): string | null {
  const short = account.replace(/@pmart\.com$/, '');
  if (short === 'claude-cdc-sup') return 'keycloak-claude-cdc-sup-password';
  // MFC 센터 관리자(다섯 센터) — 실서버 한 건 돌리기 뒤 MFC 입고 예정·도착 운행 조회용(사용자 2026-11-26 "입고 예정 MFC 계정으로 보면", lan-test-accounts.md)
  if (short === 'claude-mfc-sup') return 'keycloak-claude-mfc-sup-password';
  if (/^cdcw-(fc-(0[1-9]|10)|(dl|qc|ld)-0[1-5]|fk-0[1-3])$/.test(short)) return 'keycloak-cdc-test-workers-password';
  return null;
}

/** 실서버 모드 운영자 계정 [확정 — lan-test-accounts.md §2-5] */
export const CDC_OPERATOR_ACCOUNT = 'claude-cdc-sup';

/** 가상 작업자 계정 이름 [확정 — lan-test-accounts.md §2-5] — 시뮬레이터 역할 → 계정 */
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
