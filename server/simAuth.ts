// Vite 개발 서버 전용: LAN 시험 계정 토큰 발급 경로 POST /sim-auth/tokens — MFC 시뮬레이터 server/simAuth.ts 와 같은 흐름.
// 비밀번호 파일을 읽어 Keycloak 비밀번호 로그인(개발 클라이언트 pmart-dev-cli, LAN 전용) → employee-auth-service 시험용 토큰 교환
// (/api/v1/internal/dev-token-exchange) → 브라우저에는 PMart 직원 토큰만 돌려준다. 토큰·비밀번호는 로그에 남기지 않는다.
// 2026-11-26: 칠곡 CDC01 시험 계정 29개가 생겼다(백엔드 lan-test-accounts.md §2-5, R-16).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { keycloakUsername, passwordFileFor, type SimToken } from '../src/backend/http/accounts';

const SECRETS_DIR = process.env.PMART_SECRETS_DIR ?? resolve(process.cwd(), '../pmart-backend/deploy/lan/.secrets');
const KEYCLOAK = process.env.PMART_KEYCLOAK ?? 'http://192.168.0.101:8180';
const EMPLOYEE_AUTH = process.env.PMART_EMPLOYEE_AUTH ?? 'http://192.168.0.101:8511';
const REALM = 'pmart-staff';
/** 만료 이만큼 전이면 새로 받는다(초) */
const REUSE_MARGIN_SEC = 90;

const cache = new Map<string, SimToken>();

class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

async function issue(account: string): Promise<SimToken> {
  const file = passwordFileFor(account);
  if (!file) throw new AuthError(403, 'ACCOUNT_NOT_ALLOWED', `${account} 는 시뮬레이터 계정 목록에 없음`);
  const hit = cache.get(account);
  if (hit && Date.parse(hit.accessTokenExpiresAt) - Date.now() > REUSE_MARGIN_SEC * 1000) return hit;

  let password: string;
  try {
    password = readFileSync(resolve(SECRETS_DIR, file), 'utf-8').trim();
  } catch {
    throw new AuthError(500, 'SECRET_FILE_MISSING', `비밀번호 파일 ${file} 을 ${SECRETS_DIR} 에서 못 읽음 (PMART_SECRETS_DIR)`);
  }

  const kc = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'pmart-dev-cli', username: keycloakUsername(account), password }),
  }).catch(() => null);
  if (!kc) throw new AuthError(502, 'KEYCLOAK_UNREACHABLE', `${KEYCLOAK} 응답 없음`);
  const kcBody = (await kc.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!kc.ok || !kcBody.access_token) throw new AuthError(502, 'KEYCLOAK_LOGIN_FAILED', `Keycloak 로그인 실패 HTTP ${kc.status} ${kcBody.error ?? ''}`);

  const ex = await fetch(`${EMPLOYEE_AUTH}/api/v1/internal/dev-token-exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Source-System': 'cdc-simulator',
      'X-Device-Id': 'cdc-simulator',
    },
    body: JSON.stringify({ keycloakAccessToken: kcBody.access_token }),
  }).catch(() => null);
  if (!ex) throw new AuthError(502, 'EMPLOYEE_AUTH_UNREACHABLE', `${EMPLOYEE_AUTH} 응답 없음`);
  const exBody = (await ex.json().catch(() => ({}))) as { operatorId?: string; code?: string; tokens?: { accessToken: string; accessTokenExpiresAt: string } };
  if (!ex.ok || !exBody.tokens?.accessToken) throw new AuthError(502, 'TOKEN_EXCHANGE_FAILED', `직원 토큰 교환 실패 HTTP ${ex.status} ${exBody.code ?? ''}`);

  const t: SimToken = { account, operatorId: exBody.operatorId ?? '', accessToken: exBody.tokens.accessToken, accessTokenExpiresAt: exBody.tokens.accessTokenExpiresAt };
  cache.set(account, t);
  return t;
}

/**
 * 토큰을 받을 수 있는 브라우저 — 이 PC(loopback) + 사용자가 적은 PC IP 만(사용자 2026-11-26 "다른 pc 에서 쓸 수 있게").
 * 허용 IP 는 저장소 밖에 두지 않고 이 프로젝트의 `.sim-auth-allow`(git 무시, 한 줄에 IP 하나)에 적는다. 요청마다 읽어 개발 서버를 다시 켤 필요 없음.
 * LAN 전체를 열지 않는다 — 적은 IP 만.
 */
function allowedIps(): Set<string> {
  try {
    return new Set(
      readFileSync(resolve(process.cwd(), '.sim-auth-allow'), 'utf-8')
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*/, '').trim())
        .filter((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(l)),
    );
  } catch {
    return new Set();
  }
}
function isLoopback(req: IncomingMessage): boolean {
  const a = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || allowedIps().has(a);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function simAuthPlugin(): Plugin {
  return {
    name: 'pmart-cdc-sim-auth',
    configureServer(server) {
      server.middlewares.use('/sim-auth/tokens', (req, res) => {
        if (!isLoopback(req)) return send(res, 403, { code: 'LOOPBACK_ONLY', detail: `이 PC 와 .sim-auth-allow 에 적은 IP 만 토큰을 받음 — 지금 ${(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')}` });
        if (req.method !== 'POST') return send(res, 405, { code: 'METHOD_NOT_ALLOWED' });
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString('utf-8')));
        req.on('end', () => {
          let account = '';
          try {
            account = String((JSON.parse(raw || '{}') as { account?: unknown }).account ?? '');
          } catch {
            return send(res, 400, { code: 'BAD_JSON' });
          }
          issue(account)
            .then((t) => send(res, 200, t))
            .catch((e: unknown) => {
              if (e instanceof AuthError) {
                server.config.logger.warn(`[sim-auth] ${account}: ${e.code}`);
                return send(res, e.status, { code: e.code, detail: e.message });
              }
              send(res, 500, { code: 'INTERNAL' });
            });
        });
      });
    },
  };
}
