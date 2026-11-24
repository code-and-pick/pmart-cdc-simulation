import react from '@vitejs/plugin-react';
import { Agent } from 'node:http';
import { defineConfig } from 'vitest/config';

// MFC 시뮬레이터(../pmart-mfc-simulation/vite.config.ts)와 같은 틀. 포트만 5182(MFC 5180·라이더 5181 과 겹치지 않게, CLAUDE.md).
// 실서버 모드는 개발 서버가 /api 를 게이트웨이로 넘긴다. 주소는 PMART_GATEWAY 로 바꾼다.
// MFC 의 시험 계정·라벨·실주문 플러그인(server/)은 CDC 계약이 생기면 그때 옮긴다.
const gateway = process.env.PMART_GATEWAY ?? 'http://192.168.0.40:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    host: true,
    proxy: {
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
