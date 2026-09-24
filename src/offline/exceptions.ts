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
 * P5-A (Q8): where the server can establish branch/terminal semantics,
 *   '42501' branch access denial    → 'branch-denied' (failed, not quarantined)
 *   '22023' terminal authority denial → 'terminal-denied' (failed, not quarantined)
 * What deliberately does NOT become an exception here:
 *   - Transient/network failures → stay in the ordinary retry path
 *     (status 'failed', no exceptionClass; Part C: temporary failures are
 *     not permanent business exceptions).
 *   - Unrelated 42501/22023 (PIN/time/other) → stay ordinary failed,
 *     not branch/terminal. Classification is message-semantic, not code alone.
 *   - Other application errors (P0001, unique violations, …) → ordinary
 *     'failed' evidence, unchanged from R09.2/R10 behaviour.
 *   - Version quarantines (stale-version/unknown-version) are QuarantineReason
 *     via provenance, not ExceptionClass here (P5-A Q1/2).
 *   - clientKey-payload-mismatch is a QuarantineReason (Q10), handled
 *     separately via isClientKeyPayloadMismatch / INTEGRITY_QUARANTINE_REASONS.
 *
 * Classification is deterministic and ignores nothing it shouldn't: quota
 * uses ONLY the typed SQLSTATE (never message text, per R10); stock uses
 * the 23514 code PLUS the specific on-hand constraint identity, because
 * 23514 is generic CHECK-violation and other constraints share the code;
 * branch/terminal use code PLUS branch/terminal semantics in message text.
 */
import type { ExceptionClass, QuarantineReason } from './db';
import { isQuotaDenial } from '@/lib/billing/quotaContract';

/** The R06 constraint whose violation is the stock authority speaking. */
export const STOCK_NONNEG_CONSTRAINT = 'chk_inventory_balances_on_hand_nonneg';

/** Exception classes Model 4 may reconcile — everything else never can be. */
export const RECONCILABLE_EXCEPTION_CLASSES: readonly ExceptionClass[] = [
  'stock-denied',
  'policy-denied',
] as const;
// P5-A Q3/Q11: frozen. Never automatically expanded to branch-denied,
// terminal-denied, stale-version, unknown-version, clientKey-payload-mismatch
// unless a future explicit owner decision changes the contract.

/** R09.2 integrity quarantines + R09.3 tamper class: never reconcilable. */
export const INTEGRITY_QUARANTINE_REASONS: readonly QuarantineReason[] = [
  'actor-mismatch',
  'missing-provenance',
  'legacy',
  'payload-tampered',
  'stale-version',
  'unknown-version',
  'clientKey-payload-mismatch',
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
 * P5-A: branch access denial is 42501 WHERE the server can establish branch
 * semantics (message contains branch, R08). Must not classify unrelated 42501
 * (PIN/time/other) as branch-denied.
 */
export function isBranchAccessDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code !== '42501') return false;
  const text = [e.message, e.details, e.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  // R08 branch denials all contain the word branch (checked via can_access_branch).
  // Generic 42501 like "You do not have permission..." without branch is NOT branch-denied.
  return text.includes('branch');
}

/**
 * P5-A: terminal authority denial is 22023 WHERE the server can establish
 * terminal semantics (message contains terminal, R08). Must not classify
 * unrelated 22023 (e.g. rate limit, journal) as terminal-denied.
 */
export function isTerminalDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code !== '22023') return false;
  const text = [e.message, e.details, e.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  return text.includes('terminal');
}

/**
 * P5-A Q10: same clientKey with materially different payload — server
 * authoritative hash/payload comparison returns 22023 with
 * clientKey-payload-mismatch / payload-tampered marker. Must be quarantined
 * (not failed), never reconcilable.
 */
export function isClientKeyPayloadMismatch(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code !== '22023' && e.code !== 'P9701' && e.code !== '23505') return false;
  const text = [e.message, e.details, e.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  return (
    text.includes('clientkey-payload-mismatch') ||
    text.includes('clientkey payload mismatch') ||
    text.includes('payload-tampered') ||
    text.includes('payload tampered') ||
    (text.includes('client_key') && text.includes('mismatch')) ||
    text.includes('hash mismatch')
  );
}

/**
 * Classify a failed replay attempt. Returns the typed exception class when
 * the denial is an authoritative business/policy denial, else null (the
 * ordinary failure/retry semantics apply untouched).
 *
 * P5-A Q8: branch/terminal are typed but NEVER reconcilable (Q11 D), and
 * are classified only when message semantics can be established.
 * clientKey mismatch is a quarantine, not an exceptionClass — return null
 * here so syncEngine can quarantine instead of failed.
 */
export function classifyReplayException(error: unknown): ExceptionClass | null {
  // R10: the quota contract is the typed SQLSTATE alone — first, because a
  // quota denial must never read message text and never be confused with
  // stock or transient failures.
  if (isQuotaDenial(error)) return 'policy-denied';
  if (isStockInvariantDenial(error)) return 'stock-denied';
  // P5-A branch/terminal: typed failed (not quarantined, not reconcilable)
  if (isBranchAccessDenial(error)) return 'branch-denied';
  if (isTerminalDenial(error)) return 'terminal-denied';
  // clientKey-payload-mismatch is a QuarantineReason, not ExceptionClass
  return null;
}

/** Till-phrased, payload-free detail for the typed exception classes. */
export function exceptionDetails(exceptionClass: ExceptionClass): string {
  switch (exceptionClass) {
    case 'stock-denied':
      return 'The server refused this sale: the shelf does not have enough stock. It will not sync automatically. A manager can reconcile it once stock is available.';
    case 'policy-denied':
      return 'The server refused this change: the monthly plan limit was reached. It will not sync automatically. A manager can reconcile it after the plan allows more documents.';
    case 'branch-denied':
      return 'The server refused this sale: you do not have access to the requested branch. It will not sync automatically and cannot be reconciled here; re-create in an accessible branch if needed.';
    case 'terminal-denied':
      return 'The server refused this sale: terminal authority was denied (unknown, inactive or mismatched terminal/shift). It will not sync automatically and cannot be reconciled here.';
  }
}

/** True when a queue item currently carries a live Model-3 exception. */
export function hasException(item: { exceptionClass?: ExceptionClass | null }): boolean {
  return (
    item.exceptionClass === 'stock-denied' ||
    item.exceptionClass === 'policy-denied' ||
    item.exceptionClass === 'branch-denied' ||
    item.exceptionClass === 'terminal-denied'
  );
}

/** True when a quarantine reason is an integrity/mismatch class (never reconcilable). */
export function isIntegrityQuarantine(reason: QuarantineReason | null | undefined): boolean {
  return (
    reason === 'actor-mismatch' ||
    reason === 'missing-provenance' ||
    reason === 'legacy' ||
    reason === 'payload-tampered' ||
    reason === 'stale-version' ||
    reason === 'unknown-version' ||
    reason === 'clientKey-payload-mismatch'
  );
}
