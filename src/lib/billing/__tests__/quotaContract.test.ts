import { describe, expect, it } from 'vitest';
import {
  QUOTA_DENIAL_SQLSTATE,
  UsageLimitError,
  isQuotaDenial,
} from '@/lib/billing/quotaContract';

describe('R10 P-D2 typed quota-denial contract — client classifier', () => {
  it('quota denial has the dedicated deterministic discriminator (PostgREST error shape)', () => {
    // Exact shape Supabase/PostgREST returns for a SQL RAISE ... USING errcode.
    const postgrestError = {
      code: 'P0QLT',
      message: 'Monthly transaction limit reached (50). Please upgrade your plan.',
      details: 'quota_denial plan_limit=50 documents_used=50 period_start=2026-09-01',
      hint: 'Policy denial (monthly document quota) — not a transient failure. Do not retry without a plan change.',
    };
    expect(isQuotaDenial(postgrestError)).toBe(true);
    expect(QUOTA_DENIAL_SQLSTATE).toBe('P0QLT');
  });

  it('client look-ahead UsageLimitError carries the same discriminator without English matching', () => {
    const err = new UsageLimitError(50);
    expect(err.code).toBe(QUOTA_DENIAL_SQLSTATE);
    expect(isQuotaDenial(err)).toBe(true);
    expect(err.message).toBe('Monthly transaction limit reached (50). Please upgrade your plan.');
  });

  it('unrelated application exceptions do NOT classify as quota', () => {
    // Same SQLSTATE class as the pre-contract quota raise (generic raise):
    expect(isQuotaDenial({ code: 'P0001', message: 'Some other application error' })).toBe(false);
    expect(isQuotaDenial({ code: 'P0001', message: 'caught helper raise; do not match' })).toBe(false);
  });

  it('integrity/RLS/stock denials do NOT classify as quota', () => {
    expect(isQuotaDenial({ code: '23514' })).toBe(false); // chk_inventory_balances_on_hand_nonneg
    expect(isQuotaDenial({ code: '42501' })).toBe(false); // RLS / R08 denials
    expect(isQuotaDenial({ code: '23505' })).toBe(false); // unique_violation
  });

  it('network/transient failures do NOT classify as quota', () => {
    expect(isQuotaDenial(new Error('Failed to fetch'))).toBe(false);
    const aborted = new Error('signal aborted'); aborted.name = 'AbortError';
    expect(isQuotaDenial(aborted)).toBe(false);
    expect(isQuotaDenial({ message: 'NetworkError when attempting to fetch resource.' })).toBe(false);
    expect(isQuotaDenial('Monthly transaction limit reached (50)' as unknown)).toBe(false);
    expect(isQuotaDenial(null)).toBe(false);
    expect(isQuotaDenial(undefined)).toBe(false);
  });
});
