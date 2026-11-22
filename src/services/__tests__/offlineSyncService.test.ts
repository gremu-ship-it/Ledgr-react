// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalEntity,
  getPendingSyncItems,
} from '../../lib/offline/indexedDbStore';
import { drainSyncQueue, recordLocalMutation } from '../offlineSyncService';
import {
  storeLocalLease,
  type SubscriptionLease,
} from '../subscriptionLeaseService';

const { mockUpsert, mockDeleteEq, mockRpc } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockDeleteEq: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: mockUpsert,
      delete: vi.fn(() => ({
        eq: mockDeleteEq,
      })),
    })),
    rpc: mockRpc,
  },
}));

const BUSINESS_ID = 'biz-offline-001';

function createLease(nowEpoch: number, daysValid = 14, daysGrace = 3): SubscriptionLease {
  const validUntil = nowEpoch + daysValid * 86400;
  const graceUntil = validUntil + daysGrace * 86400;
  return {
    payload: {
      business_id: BUSINESS_ID,
      issued_to_user: 'user-offline-001',
      plan: 'growth',
      operating_models: ['PRODUCT_SALES'],
      issued_at: nowEpoch,
      valid_until: validUntil,
      grace_until: graceUntil,
    },
    signature: 'deadbeefcafebabe',
    algorithm: 'HMAC-SHA256',
  };
}

describe('offlineSyncService', () => {
  let currentNowMs = new Date('2026-11-22T12:00:00Z').getTime();

  beforeEach(() => {
    localStorage.clear();
    currentNowMs = new Date('2026-11-22T12:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => currentNowMs);
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    mockUpsert.mockResolvedValue({ error: null });
    mockDeleteEq.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('recordLocalMutation succeeds when lease is ACTIVE', async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    storeLocalLease(BUSINESS_ID, createLease(nowEpoch));

    await recordLocalMutation(
      BUSINESS_ID,
      'invoices',
      'inv-001',
      { total: 1500, status: 'draft' },
      'INSERT'
    );

    const entity = await getLocalEntity(BUSINESS_ID, 'invoices', 'inv-001');
    expect(entity).not.toBeNull();
    expect(entity?.data).toEqual({ total: 1500, status: 'draft' });

    const pending = await getPendingSyncItems(BUSINESS_ID);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.some((item) => item.table_name === 'invoices' && item.payload.id === 'inv-001')).toBe(true);
  });

  it('recordLocalMutation throws an error when lease is EXPIRED', async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    storeLocalLease(BUSINESS_ID, createLease(nowEpoch));

    // Advance 18 days past 14 + 3 grace
    currentNowMs += 18 * 86400 * 1000;

    await expect(
      recordLocalMutation(BUSINESS_ID, 'invoices', 'inv-002', { total: 500 }, 'INSERT')
    ).rejects.toThrow(/Write rejected: Subscription lease is invalid or expired \(Status: EXPIRED\)/);
  });

  it('recordLocalMutation throws an error when CLOCK_TAMPERED', async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    storeLocalLease(BUSINESS_ID, createLease(nowEpoch));

    // Roll back clock by 1 day
    currentNowMs -= 86400 * 1000;

    await expect(
      recordLocalMutation(BUSINESS_ID, 'invoices', 'inv-003', { total: 500 }, 'INSERT')
    ).rejects.toThrow(/Write rejected: Subscription lease is invalid or expired \(Status: CLOCK_TAMPERED\)/);
  });

  it('drainSyncQueue processes pending items and removes them from the queue', async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    storeLocalLease(BUSINESS_ID, createLease(nowEpoch));

    await recordLocalMutation(
      BUSINESS_ID,
      'customers',
      'cust-001',
      { name: 'Acme Ltd' },
      'INSERT'
    );

    const beforePending = await getPendingSyncItems(BUSINESS_ID);
    expect(beforePending.length).toBeGreaterThanOrEqual(1);

    const result = await drainSyncQueue(BUSINESS_ID);
    expect(result.synced).toBe(beforePending.length);
    expect(result.failed).toBe(0);

    const afterPending = await getPendingSyncItems(BUSINESS_ID);
    expect(afterPending).toHaveLength(0);
    expect(mockUpsert).toHaveBeenCalled();
  });
});
