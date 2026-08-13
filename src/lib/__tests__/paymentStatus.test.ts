import { describe, it, expect } from 'vitest';
import { paymentStatusFromAmounts } from '../paymentStatus';

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
