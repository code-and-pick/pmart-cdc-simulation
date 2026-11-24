// Vite 개발 서버 전용: LAN 시험 계정 토큰 발급 경로 POST /sim-auth/tokens — MFC 시뮬레이터 server/simAuth.ts 와 같은 자리.
// 2026-11-25: CDC 시험 계정이 아직 없어(R-16) 비밀번호 파일을 읽지 않고 503 CDC_ACCOUNTS_PENDING 을 돌려준다.
// 계정이 생기면 MFC 시뮬레이터의 Keycloak 로그인 → dev-token-exchange 흐름을 그대로 옮긴다(토큰·비밀번호는 로그에 남기지 않는다).

import type { Plugin } from 'vite';
import { passwordFileFor } from '../src/backend/http/accounts';

export function simAuthPlugin(): Plugin {
  return {
    name: 'pmart-cdc-sim-auth',
    configureServer(server) {
      server.middlewares.use('/sim-auth/tokens', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          let account = '';
          try {
            account = String((JSON.parse(raw || '{}') as { account?: string }).account ?? '');
          } catch {
            /* 빈 본문 */
          }
          res.setHeader('Content-Type', 'application/json');
          if (!passwordFileFor(account)) {
            res.statusCode = 503;
            res.end(JSON.stringify({ code: 'CDC_ACCOUNTS_PENDING', detail: `CDC 시험 계정이 아직 없음(R-16) — ${account || '(계정 없음)'}` }));
            return;
          }
          res.statusCode = 501;
          res.end(JSON.stringify({ code: 'NOT_IMPLEMENTED', detail: '계정이 정해지면 MFC 시뮬레이터 토큰 흐름을 옮긴다' }));
        });
      });
    },
  };
}
