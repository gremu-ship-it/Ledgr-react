import { describe, it, expect } from 'vitest';
import { expenseStatusFromAmounts, paymentStatusFromAmounts } from '../paymentStatus';

/**
 * Unit tests for the single source of truth behind invoice payment status.
 *
 * Extracted from InvoiceRepository during the payment-reversal remediation
 * (C-02) so the reversal path and the payment path can never drift. The key
 * regression: reversing a payment must recompute status from the post-back-out
 * amount_paid, so a fully-paid invoice that loses its only payment returns to
 * 'sent' (not 'paid' or a stale value), and a partially-paid invoice returns
 * to 'partially_paid'.
 */

describe('paymentStatusFromAmounts', () => {
  it('returns sent when nothing is paid', () => {
    expect(paymentStatusFromAmounts(1000, 0)).toBe('sent');
  });

  it('returns partially_paid for a partial amount', () => {
    expect(paymentStatusFromAmounts(1000, 300)).toBe('partially_paid');
    expect(paymentStatusFromAmounts(1000, 999.99)).toBe('partially_paid');
  });

  it('returns paid at exactly the total', () => {
    expect(paymentStatusFromAmounts(1000, 1000)).toBe('paid');
  });

  it('returns paid when overpaid (tolerance)', () => {
    expect(paymentStatusFromAmounts(1000, 1000.01)).toBe('paid');
  });

  it('treats a negative amount_paid as sent', () => {
    // Defensive: amount_paid should never go negative (the RPC guards it),
    // but the derivation must degrade safely rather than produce a bogus state.
    expect(paymentStatusFromAmounts(1000, -5)).toBe('sent');
  });

  it('recomputes correctly across a full reversal', () => {
    // 1000 paid in full -> remove the 1000 payment -> amount_paid 0 -> sent
    expect(paymentStatusFromAmounts(1000, 1000)).toBe('paid');
    expect(paymentStatusFromAmounts(1000, 1000 - 1000)).toBe('sent');
  });

  it('recomputes correctly across a partial reversal', () => {
    // 1000 paid as 400 + 600 -> reverse the 600 -> 400 remains -> partially_paid
    expect(paymentStatusFromAmounts(1000, 400)).toBe('partially_paid');
  });

  it('is order-independent and total-driven', () => {
    // 1000 total, two payments 400+600; reversing either leaves a partial state
    expect(paymentStatusFromAmounts(1000, 600)).toBe('partially_paid');
    expect(paymentStatusFromAmounts(1000, 0)).toBe('sent');
  });
});

/**
 * The expense lifecycle is separate from the invoice one: `expenses_status_check`
 * allows only draft | approved | paid | void, so an invoice-style
 * `partially_paid` would raise a constraint violation *after* the payment had
 * already committed. Part settlement is carried by `amount_paid` instead.
 */
describe('expenseStatusFromAmounts', () => {
  it('leaves an unpaid bill as an outstanding approved payable', () => {
    expect(expenseStatusFromAmounts(4_000_000, 0)).toBe('approved');
  });

  it('keeps a part-paid bill on approved (status cannot express a part payment)', () => {
    expect(expenseStatusFromAmounts(4_000_000, 1_200_000)).toBe('approved');
    expect(expenseStatusFromAmounts(4_000_000, 3_999_999)).toBe('approved');
  });

  it('marks a bill paid only when it is settled in full', () => {
    expect(expenseStatusFromAmounts(4_000_000, 4_000_000)).toBe('paid');
    // Tolerance matches the cent rounding the RPC applies.
    expect(expenseStatusFromAmounts(4_000_000, 4_000_000.004)).toBe('paid');
  });
});
