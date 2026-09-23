import { describe, expect, it } from 'vitest';
import {
  classifyReplayException,
  exceptionDetails,
  hasException,
  isStockInvariantDenial,
  STOCK_NONNEG_CONSTRAINT,
} from '@/offline/exceptions';
import { UsageLimitError } from '@/lib/billing/quotaContract';

describe('R09.3 Model 3 replay-exception classification', () => {
  it('classifies the R10 typed quota contract as policy-denied (SQLSTATE only, never message text)', () => {
    expect(classifyReplayException({ code: 'P0QLT', message: 'anything at all' })).toBe('policy-denied');
    expect(classifyReplayException(new UsageLimitError(50))).toBe('policy-denied');
  });

  it('classifies the R06 on-hand invariant (23514 + constraint identity) as stock-denied', () => {
    const pg = {
      code: '23514',
      message: `new row for relation "inventory_balances" violates check constraint "${STOCK_NONNEG_CONSTRAINT}"`,
    };
    expect(isStockInvariantDenial(pg)).toBe(true);
    expect(classifyReplayException(pg)).toBe('stock-denied');
  });

  it('does NOT classify a generic 23514 from another constraint as a stock exception', () => {
    expect(
      isStockInvariantDenial({
        code: '23514',
        message: 'new row for relation "invoices" violates check constraint "chk_invoices_total_positive"',
      }),
    ).toBe(false);
    expect(
      classifyReplayException({
        code: '23514',
        message: 'new row for relation "invoices" violates check constraint "chk_invoices_total_positive"',
      }),
    ).toBeNull();
  });

  it('keeps authority failures (42501/22023), application errors and transient shapes on the ordinary failure path', () => {
    expect(classifyReplayException({ code: '42501', message: 'denied' })).toBeNull();
    expect(classifyReplayException({ code: '22023', message: 'invalid' })).toBeNull();
    expect(classifyReplayException({ code: 'P0001', message: 'malformed' })).toBeNull();
    expect(classifyReplayException(new TypeError('Failed to fetch'))).toBeNull();
    expect(classifyReplayException(null)).toBeNull();
    expect(classifyReplayException(undefined)).toBeNull();
    expect(classifyReplayException('P0QLT')).toBeNull(); // string is not the typed contract
  });

  it('quota wins over any other shape present (R10 precedence, no message-text read)', () => {
    expect(
      classifyReplayException({ code: 'P0QLT', message: `violates check constraint "${STOCK_NONNEG_CONSTRAINT}"` }),
    ).toBe('policy-denied');
  });

  it('exposes till-phrased details and the hasException predicate', () => {
    expect(exceptionDetails('stock-denied')).toMatch(/stock/i);
    expect(exceptionDetails('policy-denied')).toMatch(/plan/i);
    expect(hasException({ exceptionClass: 'stock-denied' })).toBe(true);
    expect(hasException({ exceptionClass: 'policy-denied' })).toBe(true);
    expect(hasException({ exceptionClass: null })).toBe(false);
    expect(hasException({})).toBe(false);
  });
});
