import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit cover for the quick-save RPC wrappers.
 *
 * The critical integrity property: ONLY a missing function (migration not
 * applied) may trigger a legacy fallback. Every other error is a real
 * failure where the atomic RPC has committed NOTHING — it must surface to
 * the user, never silently downgrade to the multi-request path (which could
 * half-save what the RPC refused to save at all).
 */

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
  isAbortError: (err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    const name = (err as { name?: string }).name;
    const msg = (err as { message?: string }).message ?? '';
    return name === 'AbortError' || name === 'TimeoutError' || /signal is aborted|timed out|The operation was aborted/i.test(msg);
  },
}));

import {
  saveQuickExpenseViaRpc,
  saveQuickSaleViaRpc,
  isMissingFunctionError,
  newSaveClientKey,
} from '../quickSaveService';

const validResult = {
  id: '11111111-1111-1111-1111-111111111111',
  number: 'EXP-0042',
  journal_entry_id: '22222222-2222-2222-2222-222222222222',
  idempotent: false,
};

const payload = {
  business_id: '33333333-3333-3333-3333-333333333333',
  client_key: '44444444-4444-4444-4444-444444444444',
  expense: { total_amount: 1000 },
  lines: [{ line_number: 1 }],
  allocations: [{ account_id: '55555555-5555-5555-5555-555555555555', amount: 1000 }],
  vat_amount: 0,
  stock_lines: [],
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe('isMissingFunctionError', () => {
  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function public.save_quick_expense' }],
    [{ code: '404', message: 'Not found' }],
    [{ status: 404, message: 'Not found' }],
    [{ message: 'Could not find the function public.save_quick_expense(jsonb) in the schema cache' }],
    [{ message: 'function public.save_quick_expense(jsonb) does not exist' }],
  ])('recognises missing-function error %j', (err) => {
    expect(isMissingFunctionError(err)).toBe(true);
  });

  it.each([
    [{ code: '42501', message: 'You do not have permission to record expenses for this business.' }],
    [{ code: 'P0001', message: 'Enter a valid amount.' }],
    [{ message: 'Journal entry does not balance in functional currency' }],
    [{ message: 'fetch failed' }],
    [null],
    ['string error'],
  ])('treats %j as a REAL failure, not a missing function', (err) => {
    expect(isMissingFunctionError(err)).toBe(false);
  });
});

describe('saveQuickExpenseViaRpc', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls save_quick_expense with the payload under p_payload and returns the result', async () => {
    rpcMock.mockResolvedValueOnce({ data: validResult, error: null });
    const result = await saveQuickExpenseViaRpc(payload);
    expect(rpcMock).toHaveBeenCalledWith('save_quick_expense', { p_payload: payload });
    expect(result).toEqual(validResult);
    expect(result.idempotent).toBe(false);
  });

  it('surfaces RPC errors verbatim (nothing was saved)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'Monthly transaction limit reached (50).' },
    });
    await expect(saveQuickExpenseViaRpc(payload)).rejects.toThrow(/transaction limit/);
    // Non-transient errors must NOT trigger a retry.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed success payload rather than returning it', async () => {
    rpcMock.mockResolvedValueOnce({ data: { unexpected: true }, error: null });
    await expect(saveQuickExpenseViaRpc(payload)).rejects.toThrow(/unexpected response/);
  });

  it('automatically retries ONCE on abort/timeout using the same payload (idempotent replay)', async () => {
    // First call aborts (the user's observed failure); second call returns
    // the already-committed document thanks to client_key.
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    rpcMock
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce({ data: { ...validResult, idempotent: true }, error: null });

    const resultPromise = saveQuickExpenseViaRpc(payload);
    // Flush the retry delay.
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(rpcMock).toHaveBeenCalledTimes(2);
    // Same fn, same args (same client_key) — guarantees idempotent replay.
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'save_quick_expense', { p_payload: payload });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'save_quick_expense', { p_payload: payload });
    expect(result.number).toBe('EXP-0042');
    expect(result.idempotent).toBe(true);
  });

  it('does NOT retry on a missing-function error (legacy fallback path)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.save_quick_expense' },
    });
    await expect(saveQuickExpenseViaRpc(payload)).rejects.toThrow(/Could not find the function/);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe('saveQuickSaleViaRpc', () => {
  it('calls save_quick_sale with the payload under p_payload', async () => {
    rpcMock.mockResolvedValueOnce({ data: validResult, error: null });
    const result = await saveQuickSaleViaRpc({
      business_id: payload.business_id,
      client_key: payload.client_key,
      invoice: { total_amount: 500 },
      lines: [{ line_number: 1 }],
      subtotal: 500,
      vat_amount: 0,
      stock_lines: [],
    });
    expect(rpcMock).toHaveBeenCalledWith('save_quick_sale', {
      p_payload: expect.objectContaining({ business_id: payload.business_id, subtotal: 500 }),
    });
    expect(result.number).toBe('EXP-0042');
  });

  it('propagates the idempotent replay flag', async () => {
    rpcMock.mockResolvedValueOnce({ data: { ...validResult, idempotent: true }, error: null });
    const result = await saveQuickSaleViaRpc({
      business_id: payload.business_id,
      client_key: payload.client_key,
      invoice: {},
      lines: [],
      subtotal: 0,
      vat_amount: 0,
      stock_lines: [],
    });
    expect(result.idempotent).toBe(true);
  });
});

describe('newSaveClientKey', () => {
  it('returns uuid-v4-shaped keys', () => {
    const key = newSaveClientKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newSaveClientKey()).not.toEqual(key);
  });
});
