// 게이트웨이(/api/v1) 호출 공통 — 계약 _common.yaml 헤더 그대로: Authorization Bearer, Idempotency-Key(≤128), X-Source-System, X-Expected-Version.
// 규칙(CLAUDE.md): 서버가 확정한 결과만 확정으로 본다. 응답이 없으면(시간 초과·연결 끊김·5xx 재시도 가능) 실패로 단정하지 않고
// 같은 Idempotency-Key 로 다시 보낸다. 끝까지 모르면 ResultUnknown — 호출 쪽은 원결과 조회로 해소한다.
// 토큰은 메모리에만(TokenSource) — localStorage 에 쓰지 않는다.

import { ApiProblem, ResultUnknown, type Problem } from '../../domain/contract';
import type { ApiCallRecord, ApiListener } from '../port';
import { fitIdempotencyKey } from './idemKey';

export interface HttpClientOptions {
  /** 기본 '/api/v1' — Vite 개발 서버가 게이트웨이로 넘긴다 */
  baseUrl: string;
  token: () => string | null | Promise<string | null>;
  sourceSystem: string;
  /** 시뮬레이션 시각(초) — 호출 기록용 */
  now: () => number;
  timeoutMs: number;
  /** 응답 불명일 때 같은 키로 다시 보내는 횟수 */
  retries: number;
  fetchImpl?: typeof fetch;
}

export interface CallOptions {
  body?: unknown;
  idempotencyKey?: string;
  expectedVersion?: number;
  query?: Record<string, string | undefined>;
  /** 계약 공백 등 기록 메모 */
  note?: string;
}

export class HttpClient {
  private readonly listeners: ApiListener[] = [];
  constructor(private readonly opt: HttpClientOptions) {}

  onApi(l: ApiListener) {
    this.listeners.push(l);
  }

  async call<T>(method: 'GET' | 'POST', path: string, o: CallOptions = {}): Promise<{ status: number; body: T }> {
    const q = o.query ? Object.entries(o.query).filter(([, v]) => v !== undefined && v !== '') : [];
    const url = `${this.opt.baseUrl}${path}${q.length ? `?${new URLSearchParams(q as [string, string][])}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json, application/problem+json', 'X-Source-System': this.opt.sourceSystem };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencyKey) headers['Idempotency-Key'] = fitIdempotencyKey(o.idempotencyKey);
    if (o.expectedVersion !== undefined) headers['X-Expected-Version'] = String(o.expectedVersion);
    const fetchImpl = this.opt.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    // 조회(GET)와 키가 있는 명령만 다시 보낸다(키 없는 POST 를 다시 보내면 두 번 반영될 수 있다)
    const attempts = method === 'GET' || o.idempotencyKey ? this.opt.retries + 1 : 1;
    let last: unknown = null;
    for (let i = 0; i < attempts; i++) {
      const t0 = Date.now();
      const rec: ApiCallRecord = { at: this.opt.now(), method, path, status: 'ERR', ms: 0, note: o.note };
      const token = await this.opt.token();
      if (token) headers.Authorization = `Bearer ${token}`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.opt.timeoutMs);
      try {
        const res = await fetchImpl(url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ctl.signal });
        clearTimeout(timer);
        rec.status = res.status;
        rec.ms = Date.now() - t0;
        const text = await res.text();
        const body = text ? (JSON.parse(text) as unknown) : undefined;
        if (res.ok) {
          this.emit(rec);
          return { status: res.status, body: body as T };
        }
        const p = (body ?? {}) as Partial<Problem>;
        const problem = new ApiProblem({ status: res.status, code: p.code ?? `HTTP_${res.status}`, title: p.title, detail: p.detail, retryable: p.retryable, details: p.details });
        rec.code = problem.problem.code;
        this.emit(rec);
        // 5xx·재시도 가능 → 결과 불명. 같은 키로 다시. 501(미구현)은 확정 답이라 다시 보내지 않는다
        if ((res.status >= 500 && res.status !== 501) || p.retryable) {
          last = problem;
          continue;
        }
        throw problem;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof ApiProblem) throw e;
        rec.ms = Date.now() - t0;
        rec.code = e instanceof Error && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
        this.emit(rec);
        last = e;
      }
    }
    throw new ResultUnknown(`${method} ${path} 결과 불명 — ${last instanceof Error ? last.message : String(last)} (같은 키로 다시 보내거나 원결과를 조회)`);
  }

  private emit(rec: ApiCallRecord) {
    for (const l of this.listeners) l(rec);
  }
}
