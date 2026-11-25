// 화면 번호(사용자 2026-11-26 "글자 + 숫자", DC 백오피스 ADR-0070·0085 와 같은 꼴) — TRF T+6자리 · Wave W+4자리(차면 5자리) · 작업 K+5자리.
// 무작위·겹치지 않음·한 번 정하면 바뀌지 않음. 번호는 서버(cdc-outbound·cdc-inventory)가 정해 내려준다 — 화면은 만들지 않는다.
// 지금 계약에는 아직 필드가 없다(백엔드 PC1 이 만들 예정, 예상 trfNumber·waveNumber·taskNumber). MOCK 은 서버 흉내로 여기서 정한다 [시뮬].
// 목록·표·패널·로그에는 이 번호만, 시스템 ID(TRF-… · WAV-… · PICK-…)는 상세의 "시스템 번호" 칸에만.

export type NoKind = 'TRF' | 'WAVE' | 'TASK';

const SHAPE: Record<NoKind, { letter: string; digits: number[] }> = {
  TRF: { letter: 'T', digits: [6, 7] },
  WAVE: { letter: 'W', digits: [4, 5, 6] },
  TASK: { letter: 'K', digits: [5, 6, 7] },
};

/** 번호를 모를 때(실서버 옛 기록·필드 없음) 보이는 글 */
export const NO_NUMBER = '번호 없음';

export class DisplayNumbers {
  private readonly byId = new Map<string, string>();
  private readonly used = new Set<string>();
  private readonly count = new Map<string, number>();
  private s: number;

  constructor(seed = 20261126) {
    this.s = seed >>> 0;
  }

  private rand(): number {
    // mulberry32 — 같은 시드면 같은 번호(시험·재현용)
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 서버가 번호를 정하는 자리(MOCK) — 이미 있으면 그대로(바뀌지 않음) */
  assign(kind: NoKind, id: string): string {
    const key = `${kind}:${id}`;
    const had = this.byId.get(key);
    if (had) return had;
    const { letter, digits } = SHAPE[kind];
    for (const d of digits) {
      const lo = 10 ** (d - 1);
      const span = 9 * lo;
      // 이 자릿수가 절반 넘게 차면 다음 자릿수로("차면 5자리")
      if ((this.count.get(`${letter}${d}`) ?? 0) > span / 2) continue;
      for (let tries = 0; tries < 64; tries++) {
        const no = `${letter}${lo + Math.floor(this.rand() * span)}`;
        if (!this.used.has(no)) {
          this.used.add(no);
          this.count.set(`${letter}${d}`, (this.count.get(`${letter}${d}`) ?? 0) + 1);
          this.byId.set(key, no);
          return no;
        }
      }
    }
    throw new Error(`${kind} 화면 번호가 다 참`);
  }

  get(kind: NoKind, id: string): string | undefined {
    return this.byId.get(`${kind}:${id}`);
  }
}
