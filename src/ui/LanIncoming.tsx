// 새 TRF 들어옴 알림 — LAN 에 Wave 없이 새로 인수된 TRF 가 생기면 화면 위쪽에 띄우고, [PDA 로 작업]·[가상 작업자(자동)로] 를 누르면
// "새 TRF 로 시작" 과 같은 과정(할당 확인 → Wave 만들기·배포 → 배차·입차 → 피킹 … 출발)을 그 TRF 로 시작한다(사용자 2026-11-26
// R-27(2026-11-27 LAN 배포, mfc-inbound 0.23.0): MFC 공급 요청 승인 → 서버가 DC TRF(TRF-{요청 ID}) 인수 — 시뮬레이터 임시 다리는 지움.
// "mfc 백오피스에서 입고신청하면 … 자동으로 새 trf 들어왔다고 … 가상작업자 or pda 로 작업하기"). DC 백오피스는 같은 서버를 읽으니 따로 맞출 것 없음.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, type AppCtx } from '../app/context';
import { runLanOne } from '../backend/http/lanRun';
import { MFCS } from '../config';
import { rememberTransfers, setTrfDetailGetter, TrfRef, useTrfDetail, type TrfDetail } from './lanRefs';
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
  const { busy } = useLanRun();
  const [rows, setRows] = useState<Row[]>([]);
  // TRF 상세(상품 이름) 읽는 곳 — 실서버 연결이 있으면 한 번 정함
  useEffect(() => {
    if (real) setTrfDetailGetter((id) => real.backend.client.call<TrfDetail>('GET', `/cdcs/CDC01/transfers/${encodeURIComponent(id)}`).then((r) => r.body));
  }, [real]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!real) return;
    let on = true;
    const load = () =>
      real.backend.client
        .call<{ items?: Row[] }>('GET', '/cdcs/CDC01/transfers', { query: { size: '100' } })
        
        .then((r) => (rememberTransfers(r.body.items ?? []), r))
        .then((r) => on && setRows((r.body.items ?? []).filter((x) => NEW_STATES.includes(x.state) && !x.waveId).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [real]);
  // 지금 이 화면이 돌리고 있는 TRF(새 TRF 로 시작 직후 Wave 만들기 전 1~2초)는 알리지 않음
  const mine = busy ? lanRunSnapshot().trfId : undefined;
  const list = rows.filter((x) => !seen().includes(x.trfId) && x.trfId !== mine);
  const detailOf = useTrfDetail(list[0]?.trfId);
  if (!real) return null;
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
  // 화면 가운데 작업 팝업 — 오른쪽 위 작은 알림은 놓침(사용자 2026-11-27 "자동으로 받아지게 할 거면 작업 팝업이라도 바로 띄워주던가")
  return createPortal(
    <div className="in-pop-back">
      <div className="in-pop" role="alertdialog" aria-label="새 작업">
        <div className="in-pop-h">
          <i>●</i>
          <div>
            <b>새 작업 — {x.trfId.startsWith('TRF-SR-') ? 'MFC 입고 신청' : '새 TRF'}</b>
            <span>
              <TrfRef trfId={x.trfId} {...(x.trfNumber ? { number: x.trfNumber } : {})} /> → {mfc}
              {list.length > 1 ? ` · 기다리는 TRF ${list.length - 1}건 더` : ''}
            </span>
          </div>
        </div>
        <ul className="in-pop-lines">
          {(detailOf?.lines ?? []).map((l) => (
            <li key={l.sku}>
              <b>{l.productName ?? l.sku}</b>
              <span>
                {l.sku} · {l.approvedQty}개
              </span>
            </li>
          ))}
          {!detailOf && (
            <li>
              <span>
                {x.lineCount ?? '-'}줄 · 승인 {x.approvedQty ?? '-'}개
              </span>
            </li>
          )}
        </ul>
        <div className="in-pop-a">
          <button disabled={busy} onClick={() => go(true)} title={busy ? '지금 도는 실행이 끝나야 함' : undefined}>
            PDA 로 작업
            <small>피킹부터 단계마다 찍을 QR</small>
          </button>
          <button disabled={busy} onClick={() => go(false)} title={busy ? '지금 도는 실행이 끝나야 함' : undefined}>
            가상 작업자(자동)로
            <small>시뮬레이터가 출발까지</small>
          </button>
        </div>
        {busy && <p className="in-pop-note">다른 TRF 작업이 도는 중 — 끝나면 누를 수 있어요</p>}
        <button className="in-pop-later" onClick={later}>
          나중에(오른쪽 TRF 카드·설정 탭 목록에서 다시 시작)
        </button>
      </div>
    </div>,
    document.body,
  );
}
