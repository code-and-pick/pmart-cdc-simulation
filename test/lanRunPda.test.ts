// 실서버 한 건 PDA 모드 — 새 TRF(Wave 없음)를 이어 받아 단계마다 팝업 코드가 맞고, 서버 진행에 맞춰 다음 단계로 넘어가는지(사용자 2026-11-27 "QR·화면 넘어감 완벽해?")
// 가짜 서버: PDA 가 한 단계씩 끝낸 것처럼 진행 값을 올린다.
import { describe, expect, it, vi } from 'vitest';
import { runLanOne, type RunStep } from '../src/backend/http/lanRun';
import { ApiProblem } from '../src/domain/contract';

const TRF = 'TRF-SR-T1';
type Stage = 'ALLOC' | 'WAVE' | 'PICKED' | 'SORTED' | 'INSPECTED' | 'LOADED' | 'DEPARTED';

function fakeServer() {
  let stage: Stage = 'ALLOC';
  let checkedIn = false;
  const calls: string[] = [];
  const lines = [{ sku: 'B-6' }, { sku: 'B-7' }];
  const q = (k: string) => {
    const order: Stage[] = ['ALLOC', 'WAVE', 'PICKED', 'SORTED', 'INSPECTED', 'LOADED', 'DEPARTED'];
    const at = order.indexOf(stage);
    const need = { pickedQty: 2, sortedQty: 3, inspectedQty: 4, loadedQty: 5, departedQty: 6 }[k] ?? 0;
    return at >= need ? 2 : 0;
  };
  const intake = () => ({
    trfId: TRF,
    trfVersion: 1,
    cdcId: 'CDC01',
    mfcId: 'MFC-BJG-01',
    approvalRef: 'SR-T1',
    deadlineMeaning: 'READY',
    dueAt: '2026-11-28T01:00:00Z',
    lines: lines.map((l) => ({ sku: l.sku, approvedQty: 2 })),
    state: stage === 'ALLOC' ? 'ALLOCATED' : stage === 'WAVE' ? 'IN_WAVE' : stage,
    version: 1,
    ...(stage !== 'ALLOC' ? { waveId: 'W1' } : {}),
    progress: lines.map((l) => ({ sku: l.sku, approvedQty: 2, allocatedQty: 2, pickedQty: q('pickedQty'), sortedQty: q('sortedQty'), inspectedQty: q('inspectedQty'), loadedQty: q('loadedQty'), departedQty: q('departedQty') })),
  });
  const tasks = () => [
    {
      taskId: 'K1',
      state: stage === 'WAVE' ? 'IN_PROGRESS' : 'DONE',
      regionCode: 'BUSAN',
      lines: lines.map((l, i) => ({ sku: l.sku, locationCode: `CDC01-A-6-01-01-1-${i + 1}`, plannedQty: 2, pickedQty: stage === 'WAVE' ? 0 : 2, shortQty: 0 })),
    },
  ];
  const lpns = () =>
    stage === 'ALLOC' || stage === 'WAVE' || stage === 'PICKED'
      ? []
      : lines.map((_l, i) => ({ lpn: `BOX-${i + 1}`, inspection: ['INSPECTED', 'LOADED', 'DEPARTED'].includes(stage) ? 'PASSED' : null, loaded: ['LOADED', 'DEPARTED'].includes(stage) }));
  const order = { orderId: 'TO-1', trfIds: [TRF], state: 'DISPATCHED', vehicleId: 'VH-1', dockCode: 'CDC01-A-6-90-01-0-1', version: 1 };
  const gateway = {
    call: async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (path.startsWith('/cdcs/CDC01/transport-requests/')) return { status: 200, body: { shipDate: '2026-11-27', tempClass: 'AMBIENT' } };
      if (path === '/cdcs/CDC01/transport-orders') return { status: 200, body: { items: [] } };
      if (path.endsWith('/generations')) return { status: 200, body: { orders: [{ ...order, state: 'PLANNING' }] } };
      if (path.endsWith('/confirmations')) return { status: 200, body: order };
      if (path.endsWith('/check-ins')) {
        checkedIn = true;
        return { status: 200, body: { state: 'CHECKED_IN' } };
      }
      if (path === '/trips/TO-1') return { status: 200, body: { state: stage === 'LOADED' ? 'LOADED' : stage === 'DEPARTED' ? 'DEPARTED' : checkedIn ? 'CHECKED_IN' : 'SCHEDULED', vehicleId: 'VH-1', plateNo: null } };
      if (path === '/cdcs/CDC01/lpns') return { status: 200, body: { items: lpns() } };
      if (path.endsWith('/departures')) {
        stage = 'DEPARTED';
        return { status: 200, body: { state: 'DEPARTED', departureId: 'DEP-1' } };
      }
      throw new Error(`모르는 호출 ${method} ${path}`);
    },
  };
  const backend = {
    createWave: async (b: { temperatureZone: string }) => {
      calls.push(`wave ${b.temperatureZone}`);
      return { waveId: 'W1', state: 'PLANNED', version: 0 };
    },
    releaseWave: async () => {
      stage = 'WAVE';
      return { status: 'APPLIED' };
    },
    listTasks: async () => tasks(),
  };
  const internal = {
    getTransferIntake: async () => intake(),
    getShipmentManifest: async () => ({ shipmentManifestId: 'MAN-1' }),
    inventory: { call: async () => ({ status: 200, body: { items: [] } }) },
    outbound: {},
  };
  return { deps: { gateway, backend, internal, operatorId: () => 'OP-1' } as never, calls, setStage: (s: Stage) => (stage = s), get stage() {
    return stage;
  } };
}

describe('실서버 한 건 — PDA 모드 단계·팝업 코드', () => {
  it('새 TRF 를 이어 받아 Wave → 배차·입차 → 피킹·분배·검품·상차 팝업이 차례로, 서버 진행에 맞춰 넘어가고 출발까지', async () => {
    vi.useFakeTimers();
    const srv = fakeServer();
    const seen = new Map<string, { label: string; value: string }[]>();
    // PDA 사람 흉내 — 단계 팝업이 뜨면(코드가 있으면) 그 단계를 끝냄
    const next: Record<string, Stage> = { 'PDA 피킹': 'PICKED', 'PDA 분배·패킹': 'SORTED', 'PDA 검품': 'INSPECTED', 'PDA 상차': 'LOADED' };
    const onStep = (st: RunStep[]) => {
      const cur = st.at(-1)!;
      if (cur.state !== 'run' || !cur.scan?.length) return;
      const key = Object.keys(next).find((k) => cur.name.startsWith(k));
      if (!key || seen.has(key)) return;
      seen.set(key, cur.scan);
      srv.setStage(next[key]);
    };
    const p = runLanOne(srv.deps, { mfcId: 'MFC-BJG-01', skus: 2, qty: 2, pda: true, pdaWaitMin: 60, resumeTrfId: TRF }, onStep);
    for (let i = 0; i < 60 && srv.stage !== 'DEPARTED'; i++) await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(15_000);
    const steps = await p;
    vi.useRealTimers();
    const fail = steps.find((s) => s.state === 'fail');
    expect(fail?.detail ?? '').toBe('');
    // 단계 순서
    expect(steps.map((s) => s.name.split(' ')[0] + (s.name.startsWith('PDA') ? ' ' + s.name.split(' ')[1] : ''))).toEqual([
      '이어', 'Wave', 'Wave', '배차', '계획완료', '입차', 'PDA 피킹', 'PDA 분배·패킹', 'PDA 검품', 'PDA 상차', '출차', '결과',
    ]);
    expect(srv.calls).toContain('wave AMBIENT');
    // 팝업 코드 — 단계마다 PDA 가 찍을 것
    const v = (k: string) => seen.get(k)!.map((c) => c.value);
    expect(v('PDA 피킹')).toEqual(['BUSAN', 'CDC01-A-6-01-01-1-1', 'B-6', 'CDC01-A-6-01-01-1-2', 'B-7']);
    // 박스 → 상품 짝으로(PDA 는 박스 먼저)
    const sv = v('PDA 분배·패킹');
    expect(sv.filter((_, i) => i % 2 === 0).every((x) => x.startsWith('BOX-'))).toBe(true);
    expect(sv.filter((_, i) => i % 2 === 1)).toEqual(['B-6', 'B-7']);
    expect(seen.get('PDA 분배·패킹')![0].label).toContain('먼저');
    expect(v('PDA 검품')).toEqual(['CDC01-A-6-91-01-0-1', 'BOX-1', 'BOX-2']);
    expect(v('PDA 상차')).toEqual(['CDC01-A-6-90-01-0-1', 'VH-1', 'BOX-1', 'BOX-2']);
    // 끝난 단계는 코드를 비워 팝업이 닫힘
    for (const s of steps.filter((x) => x.name.startsWith('PDA') && x.name !== 'PDA 상차 — 도크 스캔 → 운행 → 박스 스캔 → 상차완료')) expect(s.scan ?? []).toEqual([]);
    expect(steps.at(-1)!.detail).toContain('DEPARTED');
  });

  it('상차완료됐는데 안 실은 박스가 있으면 출차하지 않음', async () => {
    vi.useFakeTimers();
    const srv = fakeServer();
    const onStep = (st: RunStep[]) => {
      const cur = st.at(-1)!;
      if (cur.state !== 'run' || !cur.scan?.length) return;
      if (cur.name.startsWith('PDA 피킹')) srv.setStage('PICKED');
      else if (cur.name.startsWith('PDA 분배')) srv.setStage('SORTED');
      else if (cur.name.startsWith('PDA 검품')) srv.setStage('INSPECTED');
      else if (cur.name.startsWith('PDA 상차') && srv.stage === 'INSPECTED') {
        // 트립만 LOADED, 박스는 안 실림
        const call = (srv.deps as { gateway: { call: (m: string, p: string) => Promise<unknown> } }).gateway.call;
        (srv.deps as { gateway: { call: unknown } }).gateway.call = async (m: string, p: string) => (p === '/trips/TO-1' ? { status: 200, body: { state: 'LOADED', vehicleId: 'VH-1' } } : call(m, p));
      }
    };
    const p = runLanOne(srv.deps, { mfcId: 'MFC-BJG-01', skus: 2, qty: 2, pda: true, pdaWaitMin: 60, resumeTrfId: TRF }, onStep);
    for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(2100);
    const steps = await p;
    vi.useRealTimers();
    const last = steps.at(-1)!;
    expect(last.state).toBe('fail');
    expect(last.detail).toContain('안 실은 박스 2개');
    expect(steps.some((s) => s.name.startsWith('출차'))).toBe(false);
  });
});

void ApiProblem;

describe('실서버 한 건 — 그날 정규차가 이미 떠났으면 용차', () => {
  it('배차 생성에 이 TRF 가 없고 요청서가 HELD ORDER_CLOSED 면 용차(spot-orders → confirmations)로 싣고 이어 감', async () => {
    vi.useFakeTimers();
    const srv = fakeServer();
    const g = (srv.deps as { gateway: { call: (m: string, p: string, o?: { body?: unknown }) => Promise<unknown> } }).gateway;
    const base = g.call;
    const sent: string[] = [];
    g.call = async (m: string, p: string, o?: { body?: unknown }) => {
      if (p.endsWith('/generations')) return { status: 200, body: { orders: [] } };
      if (p.startsWith('/cdcs/CDC01/transport-requests/')) return { status: 200, body: { state: 'HELD', reason: 'ORDER_CLOSED', tempClass: 'AMBIENT', shipDate: '2026-11-27' } };
      if (p === '/vehicles') return { status: 200, body: { items: [{ vehicleId: 'VH-5T-04A' }, { vehicleId: 'VH-5T-07A' }] } };
      if (p.endsWith('/spot-orders')) {
        const b = o?.body as { vehicleId: string };
        sent.push(`spot ${b.vehicleId}`);
        return { status: 201, body: { orderId: b.vehicleId === 'VH-5T-04A' ? 'SPOT-1' : 'TO-1', version: 1, state: 'PLANNING' } };
      }
      if (p === '/cdcs/CDC01/transport-orders/SPOT-1/confirmations') throw new ApiProblem({ status: 409, code: 'VEHICLE_BUSY', title: 'x' } as never);
      if (p.endsWith('/cancellations')) {
        sent.push(`cancel ${p}`);
        return { status: 200, body: {} };
      }
      return base(m, p);
    };
    const onStep = (st: RunStep[]) => {
      const cur = st.at(-1)!;
      if (cur.state !== 'run' || !cur.scan?.length) return;
      if (cur.name.startsWith('PDA 피킹')) srv.setStage('PICKED');
      else if (cur.name.startsWith('PDA 분배')) srv.setStage('SORTED');
      else if (cur.name.startsWith('PDA 검품')) srv.setStage('INSPECTED');
      else if (cur.name.startsWith('PDA 상차')) srv.setStage('LOADED');
    };
    const p = runLanOne(srv.deps, { mfcId: 'MFC-BJG-01', skus: 2, qty: 2, pda: true, pdaWaitMin: 60, resumeTrfId: TRF }, onStep);
    for (let i = 0; i < 60 && srv.stage !== 'DEPARTED'; i++) await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(15_000);
    const steps = await p;
    vi.useRealTimers();
    expect(steps.find((s) => s.state === 'fail')?.detail ?? '').toBe('');
    expect(steps.some((s) => s.name.startsWith('용차 부르기'))).toBe(true);
    // 첫 차는 겹쳐(409) 취소, 다음 차로
    expect(sent).toEqual(['spot VH-5T-04A', 'cancel /cdcs/CDC01/transport-orders/SPOT-1/cancellations', 'spot VH-5T-07A']);
    expect(steps.at(-1)!.detail).toContain('DEPARTED');
  });
});
