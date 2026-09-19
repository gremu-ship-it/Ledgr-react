/**
 * Test helper for the two POS posting paths.
 *
 * Since stage 2 of docs/database/pos-sale-posting-rpc.md,
 * `commitPosSaleDocuments` calls the `post_pos_sale` RPC first and only falls
 * back to the client-side path when that function does not exist (PGRST202).
 * Tests that are *about* the client-side path must therefore say so explicitly,
 * otherwise they assert against a path that never runs.
 */

/** What PostgREST returns when a function is not in the schema cache. */
export const POST_POS_SALE_MISSING = {
  code: 'PGRST202',
  message:
    'Could not find the function public.post_pos_sale(p_payload) in the schema cache',
} as const;

/**
 * Wraps an rpc mock so `post_pos_sale` behaves as "migration not applied" while
 * every other function keeps whatever behaviour the test needs.
 *
 *   vi.spyOn(supabase, 'rpc').mockImplementation(missingPostPosSale(() => ({ data: null, error: null })));
 */
export function missingPostPosSale(
  otherwise: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown },
) {
  return (fn: string, args: Record<string, unknown>) =>
    Promise.resolve(
      fn === 'post_pos_sale' ? { data: null, error: POST_POS_SALE_MISSING } : otherwise(fn, args),
    );
}

/** A successful `post_pos_sale` response, for tests covering the RPC path. */
export function postedPosSale(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'inv-rpc-1',
      number: 'INV-2026-0001',
      journal_entry_id: 'je-rpc-1',
      idempotent: false,
      ...overrides,
    },
    error: null,
  };
}
