/**
 * R10 (P-D2): typed quota-denial contract — client side of the declaration.
 *
 * The contract is declared ONCE at the authoritative server boundary
 * (`_ledgr_assert_usage_limit`, migration 20261001000000): quota denial is
 * SQLSTATE 'P0QLT'. PostgREST/Supabase surfaces server error SQLSTATEs as
 * `error.code`, so any client of an RPC under quota pressure deterministically
 * receives `{ code: 'P0QLT' }`.
 *
 * This module is the single client-side mirror of that constant, plus the
 * classifier the offline sync boundary consumes. It deliberately ignores the
 * human message text.
 */

/** Dedicated SQLSTATE of the quota-denial contract — mirrors the server declaration. */
export const QUOTA_DENIAL_SQLSTATE = 'P0QLT' as const;

/**
 * Client-generated precheck denial: the UsageService look-ahead throws before
 * any RPC when the monthly document limit is already known exceeded. It uses
 * the same discriminator so the offline boundary classifies both server and
 * client-origin quota denials identically — the server remains the final
 * authority (a look-ahead miss still reaches the RPC, which re-raises P0QLT
 * authoritatively).
 */
export class UsageLimitError extends Error {
  readonly code = QUOTA_DENIAL_SQLSTATE;

  constructor(limit: number) {
    super(`Monthly transaction limit reached (${limit}). Please upgrade your plan.`);
    this.name = 'UsageLimitError';
  }
}

/**
 * Deterministic classification (P-D2): is this error the quota-denial
 * contract? Accepts Supabase/PostgREST error objects `{ code }`, PG errors
 * surfaced by the R13 fixture (`{ code }`), and UsageLimitError; rejects
 * unrelated application raises (P0001 et al.), integrity violations
 * (23514/42501/…), aborted/failed network attempts, and unknown shapes —
 * all of which must NOT classify as quota.
 */
export function isQuotaDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof UsageLimitError) return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === QUOTA_DENIAL_SQLSTATE;
}
