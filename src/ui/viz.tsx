// 패널용 작은 그림 — 글 대신 막대·시간띠로(사용자 2026-11-25 "왼쪽·오른쪽 탭 글이 많아 직관적으로 안 보여").
import type { ReactNode } from 'react';
import { OUTBOUND, SHIFT } from '../config';

/** 가는 막대 — value / max, tone 색 */
export function Meter({ value, max, tone = 'accent', title }: { value: number; max: number; tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'muted'; title?: string }) {
  const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={`meter tone-${tone}`} title={title}>
      <i style={{ width: `${(p * 100).toFixed(1)}%` }} />
    </span>
  );
}

/** 숫자 타일 — 큰 값 + 작은 이름(+ 선택: 막대) */
export function Tile({ v, k, children, tone, onClick, on }: { v: ReactNode; k: string; children?: ReactNode; tone?: 'warn' | 'bad'; onClick?: () => void; on?: boolean }) {
  return (
    <div className={`tile ${tone ? `tone-${tone}` : ''}${onClick ? ' click' : ''}${on ? ' on' : ''}`} onClick={onClick}>
      <b>{v}</b>
      <span>{k}</span>
      {children}
    </div>
  );
}

/** 하루 시간띠 구간 — 07:00 ~ 다음날 06:00 */
const DAY0 = 7 * 60;
const DAY1 = 30 * 60;
const SEGS: { from: number; to: number; label: string; cls: string }[] = [
  { from: SHIFT.day.start, to: SHIFT.evening.start, label: '보충', cls: 'seg-day' },
  { from: SHIFT.evening.start, to: OUTBOUND.lowerFrom, label: '피킹·분류', cls: 'seg-eve' },
  { from: OUTBOUND.lowerFrom, to: OUTBOUND.loadFrom, label: '하강', cls: 'seg-low' },
  { from: OUTBOUND.loadFrom, to: SHIFT.departure + 5 * 60, label: '상차·출차', cls: 'seg-load' },
  { from: SHIFT.departure + 5 * 60, to: DAY1, label: '운송', cls: 'seg-run' },
];

/** 하루 시간띠 — 구간 색 + 지금 위치 표시. nowMin = 0시 기준 분(다음날은 24h 넘게) */
export function DayTimeline({ nowMin }: { nowMin: number }) {
  const x = (m: number) => ((Math.max(DAY0, Math.min(DAY1, m)) - DAY0) / (DAY1 - DAY0)) * 100;
  const ticks = [8, 13, 18, 22, 26];
  return (
    <div className="dayline" aria-label="하루 시간띠">
      <div className="dayline-bar">
        {SEGS.map((s) => (
          <span key={s.label} className={s.cls} style={{ left: `${x(s.from)}%`, width: `${x(s.to) - x(s.from)}%` }} title={`${s.label} ${hm(s.from)}~${hm(s.to)}`}>
            {s.label}
          </span>
        ))}
        <em style={{ left: `${x(nowMin)}%` }} />
      </div>
      <div className="dayline-ticks">
        {ticks.map((h) => (
          <span key={h} style={{ left: `${x(h * 60)}%` }}>
            {String(h % 24).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}

export const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
