import { describe, expect, it } from 'vitest';
import { fitIdempotencyKey } from '../src/backend/http/idemKey';

// 헤더 값은 ISO-8859-1 만 — 한글 키면 fetch 가 요청을 못 만들었다(2026-11-26 "MFC 도착 막힘")
describe('fitIdempotencyKey', () => {
  it('영문 키는 그대로', () => {
    expect(fitIdempotencyKey('sim-lan-arrive-TO-1-1')).toBe('sim-lan-arrive-TO-1-1');
  });
  it('한글이 섞이면 영문만 남기고 해시를 붙임 — 같은 키는 늘 같은 값', () => {
    const a = fitIdempotencyKey('sim-lan-MFC 도착-TO-1-1');
    expect(a).toMatch(/^[\x20-\x7e]+$/);
    expect(a).toBe(fitIdempotencyKey('sim-lan-MFC 도착-TO-1-1'));
    expect(a).not.toBe(fitIdempotencyKey('sim-lan-MFC 출발-TO-1-1'));
  });
});
