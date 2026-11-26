// 새 TRF 들어옴 알림 — LAN 에 Wave 없이 새로 인수된 TRF 가 생기면 화면 위쪽에 띄우고, [PDA 로 작업]·[가상 작업자(자동)로] 를 누르면
// "새 TRF 로 시작" 과 같은 과정(할당 확인 → Wave 만들기·배포 → 배차·입차 → 피킹 … 출발)을 그 TRF 로 시작한다(사용자 2026-11-26
// "mfc 백오피스에서 입고신청하면 … 자동으로 새 trf 들어왔다고 … 가상작업자 or pda 로 작업하기"). DC 백오피스는 같은 서버를 읽으니 따로 맞출 것 없음.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, type AppCtx } from '../app/context';
import { MFC_SUP_ACCOUNTS } from '../backend/http/accounts';
import { HttpClient } from '../backend/http/client';
import { runLanOne } from '../backend/http/lanRun';
import { bridgeOnce } from '../backend/http/supplyBridge';
import { TokenSource } from '../backend/http/tokens';
import { MFCS } from '../config';
import { lanRunSnapshot, setLanRun, useLanRun } from './lanRunStore';

type Real = NonNullable<AppCtx['real']>;

/** 한 건 돌리기 시작 — 새 TRF(resumeTrfId 없음) 또는 LAN 에 있는 TRF 를 지금 단계부터 */
export function startLanRun(real: Real, o: { mfcId: string; pda: boolean; resumeTrfId?: string }) {
  if (lanRunSnapshot().busy) return;
  setLanRun({ busy: true, steps: [], mode: o.pda ? 'pda' : 'auto', ...(o.resumeTrfId ? { trfId: o.resumeTrfId } : {}) });
  void runLanOne(
    { gateway: real.backend.client, backend: real.backend, internal: real.internal, operatorId: () => real.tokens.operatorId },
    { mfcId: o.mfcId, skus: 3, qty: 2, pda: o.pda, pdaWaitMin: 60, ...(o.resumeTrfId ? { resumeTrfId: o.resumeTrfId } : {}) },
    (st) => {
      const id = [...st].reverse().find((x) => x.trfId)?.trfId;
      setLanRun({ steps: st, ...(id ? { trfId: id } : {}) });
    },
  ).finally(() => setLanRun({ busy: false }));
}

interface Row {
  trfId: string;
  trfNumber?: string;
  state: string;
  mfcId: string;
  approvedQty?: number;
  lineCount?: number;
  waveId?: string | null;
  createdAt?: string;
}
/** 아직 Wave 에 안 든(새로 들어온) 상태 */
const NEW_STATES = ['RECEIVED', 'ALLOCATING', 'ALLOCATED', 'PARTIALLY_ALLOCATED'];
const SEEN = 'cdc-sim-lan-incoming-seen';
const seen = (): string[] => JSON.parse(sessionStorage.getItem(SEEN) ?? '[]') as string[];

export function LanIncoming() {
  const { real } = useApp();
  const { busy, bridgeOn } = useLanRun();
  // 임시 다리 — 켜져 있으면 10초마다 APPROVED 공급 요청을 TRF 로(MFC 계정으로 읽기)
  useEffect(() => {
    if (!real || !bridgeOn) return;
    let on = true;
    const gw = new Map<string, HttpClient>();
    const mfcGateway = (mfcId: string) => {
      const acc = MFC_SUP_ACCOUNTS[mfcId];
      if (!acc) return null;
      if (!gw.has(mfcId)) {
        const tk = new TokenSource(acc, 90);
        gw.set(mfcId, new HttpClient({ baseUrl: '/api/v1', token: () => tk.get(), sourceSystem: 'pmart-cdc-simulation', now: () => 0, timeoutMs: 8000, retries: 2 }));
      }
      return gw.get(mfcId)!;
    };
    const tick = () =>
      bridgeOnce({ mfcGateway, gateway: real.backend.client, internal: real.internal }, MFCS.filter((m) => !m.id.startsWith('ETC-')).map((m) => m.id))
        .then((r) => on && setLanRun({ bridgeLog: r, bridgeAt: Date.now() }))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 10_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real, bridgeOn]);
  const [rows, setRows] = useState<Row[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!real) return;
    let on = true;
    const load = () =>
      real.backend.client
        .call<{ items?: Row[] }>('GET', '/cdcs/CDC01/transfers', { query: { size: '100' } })
        .then((r) => on && setRows((r.body.items ?? []).filter((x) => NEW_STATES.includes(x.state) && !x.waveId).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real]);
  if (!real) return null;
  const list = rows.filter((x) => !seen().includes(x.trfId));
  if (!list.length) return null;
  const x = list[0];
  const later = () => {
    sessionStorage.setItem(SEEN, JSON.stringify([...seen(), x.trfId]));
    bump((n) => n + 1);
  };
  const go = (pda: boolean) => {
    later();
    startLanRun(real, { mfcId: x.mfcId, pda, resumeTrfId: x.trfId });
  };
  const mfc = MFCS.find((m) => m.id === x.mfcId)?.name ?? x.mfcId;
  return createPortal(
    <div className="lan-in" role="alert">
      <div className="lan-in-h">
        <i>●</i>
        <b>{x.trfId.startsWith('TRF-SR-') ? 'MFC 입고 신청 → 새 TRF' : '새 TRF 들어옴'}</b>
        <span>{list.length > 1 ? `외 ${list.length - 1}건` : ''}</span>
      </div>
      <div className="lan-in-b">
        <b>{x.trfNumber ?? x.trfId}</b> → {mfc}
        <small>
          {x.lineCount ?? '-'}줄 · 승인 {x.approvedQty ?? '-'}개 · {x.state}
        </small>
      </div>
      <div className="lan-in-a">
        <button disabled={busy} onClick={() => go(true)} title={busy ? '지금 도는 실행이 끝나야 함' : undefined}>
          PDA 로 작업
        </button>
        <button disabled={busy} onClick={() => go(false)} title={busy ? '지금 도는 실행이 끝나야 함' : '시뮬레이터가 피킹·분류·검품·상차를 계약 API 로 대신'}>
          가상 작업자(자동)로
        </button>
        <button className="ghost" onClick={later}>
          나중에
        </button>
      </div>
    </div>,
    document.body,
  );
}
