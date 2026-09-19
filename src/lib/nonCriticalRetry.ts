import { withRetry } from '@/lib/errorHandler';

/**
 * Runs a *secondary* write that belongs to an already-committed document
 * (journal entry, stock movement, shift totals, audit trail) with a short
 * retry, and swallows the failure after logging it.
 *
 * Why this exists, and why it is shared:
 *
 * A sale or expense has two halves — the document itself and the accounting
 * it triggers. The document half must be atomic and idempotent (a retry has
 * to be safe), but the accounting half is derived: if it fails, retrying the
 * whole sync pass would re-run the document write, and the *user* cannot fix
 * it from the UI either. So these steps get a couple of quick retries, then
 * a logged warning, and the surrounding item still counts as synced.
 *
 * Consequence worth knowing: a failure here is silent by design — it lands in
 * logs, not in the offline queue. Anything whose loss would corrupt the
 * ledger's relationship to the document must NOT use this helper.
 *
 * Both the sync engine (for queued offline writes) and the POS service (for
 * online sales) use it, so online and offline sales post their accounting
 * with the same retry policy. One copy, one behaviour.
 */
export async function retryNonCritical<T>(
  action: () => Promise<T>,
  context: { module: string; operation: string; businessId?: string },
): Promise<T | null> {
  return withRetry(action, {
    module: context.module,
    operation: context.operation,
    businessId: context.businessId,
    maxAttempts: 2, // Quick retry for transient failures
    initialDelay: 500,
    backoffMultiplier: 2,
  });
}
