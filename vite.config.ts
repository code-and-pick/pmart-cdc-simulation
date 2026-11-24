import react from '@vitejs/plugin-react';
import { simAuthPlugin } from './server/simAuth';
import { Agent } from 'node:http';
import { defineConfig } from 'vitest/config';

// MFC 시뮬레이터(../pmart-mfc-simulation/vite.config.ts)와 같은 틀. 포트만 5182(MFC 5180·라이더 5181 과 겹치지 않게, CLAUDE.md).
// 실서버 모드는 개발 서버가 /api 를 게이트웨이로 넘긴다. 주소는 PMART_GATEWAY 로 바꾼다.
// MFC 의 시험 계정·라벨·실주문 플러그인(server/)은 CDC 계약이 생기면 그때 옮긴다.
const gateway = process.env.PMART_GATEWAY ?? 'http://192.168.0.40:8080';
// 내부 경로(/internal/*)는 게이트웨이를 거치지 않고 LAN 서비스로 직접(백엔드 CDC-9, 사용자 2026-11-25 "LAN 서비스 직접 호출").
// 주소: PC1 백엔드 안내(2026-11-25) — 192.168.0.222, cdc-inventory :8601 · cdc-location :8602 · cdc-outbound :8603(배치 뒤). 직접 호출엔 CORS 가 없어 개발 서버 프록시로.
const svcHost = process.env.PMART_CDC_HOST ?? '192.168.0.222';
const cdcOutbound = process.env.PMART_CDC_OUTBOUND ?? `http://${svcHost}:8603`;
const cdcInventory = process.env.PMART_CDC_INVENTORY ?? `http://${svcHost}:8601`;
const direct = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  agent: new Agent({ family: 4, keepAlive: true }),
  // 서비스는 계약 servers 대로 /api/v1 아래에 있다(2026-11-25 192.168.0.222:8601 로 확인)
  rewrite: (path: string) => path.replace(prefix, '/api/v1'),
  configure: (proxy: { on: (ev: 'proxyReq', fn: (req: { removeHeader: (h: string) => void }) => void) => void }) => {
    proxy.on('proxyReq', (req) => {
      req.removeHeader('origin');
      req.removeHeader('referer');
      // 내부 경로는 토큰 없이 — 신원은 X-Source-System 으로만(ADR-0026)
      req.removeHeader('authorization');
    });
  },
});

export default defineConfig({
  // simAuthPlugin: 개발 서버가 LAN 시험 계정 토큰을 브라우저에 준다(MFC SIM-11 과 같은 자리) — CDC 계정은 R-16 대기
  plugins: [react(), simAuthPlugin()],
  server: {
    port: 5182,
    host: true,
    proxy: {
      '/svc/cdc-outbound': direct(cdcOutbound, /^\/svc\/cdc-outbound/),
      '/svc/cdc-inventory': direct(cdcInventory, /^\/svc\/cdc-inventory/),
      // IPv4 로만, Origin·Referer 는 빼고 넘긴다 — MFC 시뮬레이터에서 겪은 문제(2026-11-20)를 그대로 피한다
      '/api': {
        target: gateway,
        changeOrigin: true,
        agent: new Agent({ family: 4, keepAlive: true }),
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            req.removeHeader('origin');
            req.removeHeader('referer');
          });
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500, // three.js + react-three-fiber 한 덩어리
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
