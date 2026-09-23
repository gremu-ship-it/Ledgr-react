/**
 * R09.3 Model 3 (P-D3-FINAL) — typed replay exceptions.
 *
 * When an offline replay reaches the server and the server's AUTHORITATIVE
 * answer is a business/policy denial, the item becomes a durable typed
 * exception instead of an anonymous retry-loop failure:
 *
 *   'P0QLT'                     → 'policy-denied'  (R10 quota contract)
 *   '23514' on-hand invariant   → 'stock-denied'   (R06 stock authority)
 *
 * What deliberately does NOT become an exception here:
 *   - Transient/network failures → stay in the ordinary retry path
 *     (status 'failed', no exceptionClass; Part C: temporary failures are
 *     not permanent business exceptions).
 *   - Authority failures (42501/22023) → stay authoritative exactly as R08
 *     defines them (status 'failed', no exceptionClass). They are never
 *     converted into a manager override; reconciliation itself re-runs the
 *     authority checks server-side.
 *   - Other application errors (P0001, unique violations, …) → ordinary
 *     'failed' evidence, unchanged from R09.2/R10 behaviour.
 *
 * Classification is deterministic and ignores nothing it shouldn't: quota
 * uses ONLY the typed SQLSTATE (never message text, per R10); stock uses
 * the 23514 code PLUS the specific on-hand constraint identity, because
 * 23514 is generic CHECK-violation and other constraints share the code.
 */
import type { ExceptionClass, QuarantineReason } from './db';
import { isQuotaDenial } from '@/lib/billing/quotaContract';

/** The R06 constraint whose violation is the stock authority speaking. */
export const STOCK_NONNEG_CONSTRAINT = 'chk_inventory_balances_on_hand_nonneg';

/** Exception classes Model 4 may reconcile — everything else never can be. */
export const RECONCILABLE_EXCEPTION_CLASSES: readonly ExceptionClass[] = [
  'stock-denied',
  'policy-denied',
];

/** R09.2 integrity quarantines + R09.3 tamper class: never reconcilable. */
export const INTEGRITY_QUARANTINE_REASONS: readonly QuarantineReason[] = [
  'actor-mismatch',
  'missing-provenance',
  'legacy',
  'payload-tampered',
];

/**
 * True when the error is the R06 non-negative on-hand invariant refusing
 * a stock release. Narrow by design: generic check_violation (23514) from
 * any OTHER constraint is NOT a stock exception and keeps the ordinary
 * failure path.
 */
export function isStockInvariantDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code !== '23514') return false;
  const text = [e.message, e.details, e.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  return text.includes(STOCK_NONNEG_CONSTRAINT);
}

/**
 * Classify a failed replay attempt. Returns the typed exception class when
 * the denial is an authoritative business/policy denial, else null (the
 * ordinary failure/retry semantics apply untouched).
 */
export function classifyReplayException(error: unknown): ExceptionClass | null {
  // R10: the quota contract is the typed SQLSTATE alone — first, because a
  // quota denial must never read message text and never be confused with
  // stock or transient failures.
  if (isQuotaDenial(error)) return 'policy-denied';
  if (isStockInvariantDenial(error)) return 'stock-denied';
  return null;
}

/** Till-phrased, payload-free detail for the typed exception classes. */
export function exceptionDetails(exceptionClass: ExceptionClass): string {
  switch (exceptionClass) {
    case 'stock-denied':
      return 'The server refused this sale: the shelf does not have enough stock. It will not sync automatically. A manager can reconcile it once stock is available.';
    case 'policy-denied':
      return 'The server refused this change: the monthly plan limit was reached. It will not sync automatically. A manager can reconcile it after the plan allows more documents.';
  }
}

/** True when a queue item currently carries a live Model-3 exception. */
export function hasException(item: { exceptionClass?: ExceptionClass | null }): boolean {
  return item.exceptionClass === 'stock-denied' || item.exceptionClass === 'policy-denied';
}
