import { describe, expect, it } from 'vitest';
import { DisplayNumbers } from '../src/domain/displayNo';

describe('화면 번호 (사용자 2026-11-26 "글자 + 숫자")', () => {
  it('TRF T+6 · Wave W+4(차면 5) · 작업 K+5 — 무작위·겹치지 않음·바뀌지 않음', () => {
    const n = new DisplayNumbers(7);
    expect(n.assign('TRF', 'TRF-1')).toMatch(/^T\d{6}$/);
    expect(n.assign('WAVE', 'WAV-1')).toMatch(/^W\d{4}$/);
    expect(n.assign('TASK', 'PICK-1')).toMatch(/^K\d{5}$/);
    expect(n.assign('TRF', 'TRF-1')).toBe(n.get('TRF', 'TRF-1'));
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(n.assign('WAVE', `W-${i}`));
    expect(seen.size).toBe(5000);
    expect([...seen].some((s) => s.length === 6)).toBe(true); // 4자리 절반 넘게 차면 5자리
    expect(n.get('TASK', '모르는')).toBeUndefined();
  });
});
