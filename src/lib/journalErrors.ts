/**
 * Phase 10 A-02 — predicate shared by journalService's discount fallbacks.
 *
 * The journal service may legitimately adjust its posting when a discount
 * account (4130 / 5175 / 4260) does not exist in the business's chart of
 * accounts. That fallback must ONLY trigger for that specific condition —
 * a network failure, RLS denial, or DB error must propagate instead of
 * silently changing the accounting disclosure.
 */
export function isMissingAccountError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /account .* not found/i.test(err.message)
  );
}
