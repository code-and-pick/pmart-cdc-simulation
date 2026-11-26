import { describe, expect, it } from 'vitest';
import { bridgeOnce, trfIdForSupply } from '../src/backend/http/supplyBridge';
import { ApiProblem } from '../src/domain/contract';

// 임시 다리 — 같은 공급 요청은 늘 같은 TRF, 이미 있으면 다시 만들지 않음(2026-11-26 mfc 시뮬 부탁)
describe('공급 요청 → TRF 다리', () => {
  it('trfId 는 공급 요청 ID 에서 정해짐(64자 안)', () => {
    expect(trfIdForSupply('SR-1')).toBe('TRF-SR-1');
    expect(trfIdForSupply('x'.repeat(100)).length).toBe(64);
  });
  it('APPROVED 요청을 한 번만 인수 — 승인 0 줄은 뺌, 있으면 EXISTS', async () => {
    const intakes: { body: { trfId: string; lines: unknown[] }; key: string }[] = [];
    const made = new Set<string>();
    const notFound = () => new ApiProblem({ status: 404, code: 'NOT_FOUND', title: 'x' } as never);
    const deps = {
      mfcGateway: () => ({ call: async () => ({ status: 200, body: { items: [{ supplyRequestId: 'SR-1', mfcId: 'MFC-BJG-01', state: 'APPROVED', approvedLines: [{ sku: 'A', requestedQty: 3, approvedQty: 2 }, { sku: 'B', requestedQty: 1, approvedQty: 0 }] }] } }) }),
      gateway: { call: async () => ({ status: 200, body: { items: [] } }) },
      internal: {
        inventory: { call: async () => ({ status: 200, body: { items: [{ sku: 'A', lots: [{ locations: [{ locationCode: 'CDC01-G-5-01-01-1-1' }] }] }] } }) },
        getTransferIntake: async (id: string) => {
          if (!made.has(id)) throw notFound();
          return {};
        },
        intakeTransfer: async (body: { trfId: string; lines: unknown[] }, key: string) => {
          intakes.push({ body, key });
          made.add(body.trfId);
          return {};
        },
      },
    } as never;
    const r1 = await bridgeOnce(deps, ['MFC-BJG-01']);
    const r2 = await bridgeOnce(deps, ['MFC-BJG-01']);
    expect(r1[0].state).toBe('CREATED');
    expect(r1[0].detail).toContain('CHILLED');
    expect(r2[0].state).toBe('EXISTS');
    expect(intakes).toHaveLength(1);
    expect(intakes[0].body.lines).toEqual([{ sku: 'A', approvedQty: 2 }]);
    expect(intakes[0].key).toBe('sim-bridge-SR-1');
  });
});

describe('공급 요청 → TRF 다리 — 서버 이관·예전 번호', () => {
  const deps = (req: object, existing: string[]) =>
    ({
      mfcGateway: () => ({ call: async () => ({ status: 200, body: { items: [{ supplyRequestId: 'SR-9', mfcId: 'MFC-BJG-01', state: 'APPROVED', approvedLines: [{ sku: 'A', requestedQty: 1, approvedQty: 1 }], ...req }] } }) }),
      gateway: { call: async () => ({ status: 200, body: { items: [] } }) },
      internal: {
        inventory: { call: async () => ({ status: 200, body: { items: [] } }) },
        getTransferIntake: async (id: string) => {
          if (!existing.includes(id)) throw new ApiProblem({ status: 404, code: 'NOT_FOUND', title: 'x' } as never);
          return {};
        },
        intakeTransfer: async () => {
          throw new Error('만들면 안 됨');
        },
      },
    }) as never;
  it('linkedTrfId 가 있으면 SKIPPED', async () => {
    const r = await bridgeOnce(deps({ linkedTrfId: 'TRF-SR-9' }, []), ['MFC-BJG-01']);
    expect(r[0].state).toBe('SKIPPED');
  });
  it('예전 번호(TRF-SR-…)로 이미 있으면 EXISTS', async () => {
    const r = await bridgeOnce(deps({}, ['TRF-SR-SR-9']), ['MFC-BJG-01']);
    expect(r[0]).toMatchObject({ state: 'EXISTS', trfId: 'TRF-SR-SR-9' });
  });
});
