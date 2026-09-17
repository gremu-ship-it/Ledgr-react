import { describe, expect, it } from 'vitest';
import { isMobileMoney } from '@/lib/paymentMethod';
import type { PaymentMethod } from '@/dal/types/database';

/**
 * Mobile money is two enum values, not one. The payroll run table and its CSV
 * export used to compare against a 'mobile_money' value that has never existed
 * in the DB enum, so Airtel Money and TNM Mpamba employees silently rendered
 * with no payment details. These tests pin the classification down.
 */

const ALL_METHODS: PaymentMethod[] = [
  'cash',
  'bank_transfer',
  'cheque',
  'airtel_money',
  'tnm_mpamba',
  'card',
  'other',
];

describe('isMobileMoney', () => {
  it('treats both operator-backed methods as mobile money', () => {
    expect(isMobileMoney('airtel_money')).toBe(true);
    expect(isMobileMoney('tnm_mpamba')).toBe(true);
  });

  it('rejects every other payment method', () => {
    for (const method of ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const) {
      expect(isMobileMoney(method)).toBe(false);
    }
  });

  it('rejects the value the old code compared against', () => {
    // Not a PaymentMethod, but it reached the comparison via `any` and is what
    // made the branch dead code. Guarded against reintroduction.
    expect(isMobileMoney('mobile_money' as PaymentMethod)).toBe(false);
  });

  it('is safe on the absent values optional chaining produces', () => {
    expect(isMobileMoney(undefined)).toBe(false);
    expect(isMobileMoney(null)).toBe(false);
  });

  it('classifies exactly two of the methods the enum defines', () => {
    expect(ALL_METHODS.filter(isMobileMoney)).toEqual(['airtel_money', 'tnm_mpamba']);
  });

  it('stays in sync with the DB enum', () => {
    // Record<PaymentMethod, true> stops compiling if the enum gains a member —
    // a new operator then has to be classified here deliberately rather than
    // falling through to "not mobile money" by accident.
    const everyMethod: Record<PaymentMethod, true> = {
      cash: true,
      bank_transfer: true,
      cheque: true,
      airtel_money: true,
      tnm_mpamba: true,
      card: true,
      other: true,
    };
    expect(Object.keys(everyMethod)).toHaveLength(ALL_METHODS.length);
  });
});
