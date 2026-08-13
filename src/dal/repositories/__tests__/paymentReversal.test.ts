import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression cover for the payment-reversal bug (POST_REMEDIATION_VERIFICATION
 * C-02):
 *
 *   JournalRepository.reverse() backed out a payment by calling
 *   increment_amount_paid() with a NEGATIVE amount, but the RPC rejected
 *   `p_amount <= 0` and the reverse() code discarded the error object — so the
 *   decrement silently failed, leaving amount_paid at the paid total while
 *   status was recomputed to partially_paid/sent.
 *
 * The fix is split across two places:
 *   1. 20260813000001_fix_increment_amount_paid_backout.sql — the RPC now
 *      accepts a negative back-out, never lets amount_paid go negative, and
 *      enforces tenant ownership (it previously had no ownership check at all).
 *   2. src/dal/repositories/JournalRepository.ts — the back-out now captures
 *      and throws the RPC error and recomputes status from the post-back-out
 *      amount_paid via paymentStatusFromAmounts.
 *
 * There is no runtime database in this environment, so these assertions pin
 * the load-bearing properties statically (mutation-checked during development:
 * restoring the positive-only guard, dropping the ownership check, or
 * swallowing the RPC error again each fails this suite).
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const RPC_MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260813000001_fix_increment_amount_paid_backout.sql',
);
const JOURNAL_REPO = resolve(REPO_ROOT, 'src/dal/repositories/JournalRepository.ts');

describe('payment reversal remediation (C-02)', () => {
  const rpc = readFileSync(RPC_MIGRATION, 'utf8');
  const repo = readFileSync(JOURNAL_REPO, 'utf8');

  it('RPC no longer rejects non-positive amounts outright (allows back-out)', () => {
    // The old guard was `if p_amount <= 0 then raise ... positive`.
    expect(rpc).not.toMatch(/p_amount\s*<=\s*0\s*then/);
    // It still rejects the no-op zero, and documents negative as a back-out.
    expect(rpc).toContain('p_amount = 0');
    expect(rpc).toMatch(/negative[^.]*back[- ]out/i);
  });

  it('RPC prevents amount_paid from going negative', () => {
    expect(rpc).toContain('amount_paid + p_amount >= 0');
  });

  it('RPC enforces tenant ownership (no cross-tenant amount_paid mutation)', () => {
    expect(rpc).toContain('can_write_business_data');
  });

  it('RPC is not left executable by public/anon', () => {
    expect(rpc).toMatch(/revoke all on function public\.increment_amount_paid/);
  });

  it('reverse() passes a negative back-out amount to the RPC', () => {
    expect(repo).toContain('p_amount: -params.amount');
  });

  it('reverse() surfaces an RPC failure instead of swallowing it', () => {
    expect(repo).toMatch(/if \(rpcError\) throw toRepositoryError\(/);
  });

  it('reverse() recomputes status via the shared pure helper', () => {
    expect(repo).toContain('paymentStatusFromAmounts');
  });
});
