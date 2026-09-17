import type { PaymentMethod } from '@/dal/types/database';

/** Mobile money providers modelled as distinct payment_method enum values. */
const MOBILE_MONEY_METHODS = new Set<PaymentMethod>(['airtel_money', 'tnm_mpamba']);

/**
 * True when a payment method is mobile money.
 *
 * There is no single `'mobile_money'` value in the DB enum — each operator is
 * its own method (`airtel_money`, `tnm_mpamba`) and the provider is carried
 * separately in `employees.mobile_money_type`. Anything that shows or exports
 * mobile-money details must go through this predicate instead of comparing to a
 * literal: a `=== 'mobile_money'` check typechecks as `any` but is dead code,
 * which is how Airtel Money and TNM Mpamba employees came to be missing from
 * the payroll run table and its CSV export.
 */
export function isMobileMoney(method: PaymentMethod | null | undefined): boolean {
  return method !== null && method !== undefined && MOBILE_MONEY_METHODS.has(method);
}
