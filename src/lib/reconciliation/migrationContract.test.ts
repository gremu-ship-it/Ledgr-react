import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261110000001_p4b2_bank_reconciliation_matching.sql', import.meta.url),
  'utf8',
);

describe('P4B-2 matching migration contract', () => {
  it('adds server-side match writes, status transitions, and report data functions', () => {
    expect(migration).toContain('CREATE FUNCTION public.create_bank_reconciliation_matches');
    expect(migration).toContain('CREATE FUNCTION public.delete_bank_reconciliation_match');
    expect(migration).toContain('CREATE FUNCTION public.reconcile_bank_statement');
    expect(migration).toContain('CREATE FUNCTION public.unreconcile_bank_statement');
    expect(migration).toContain('CREATE FUNCTION public.get_bank_reconciliation_gl_lines');
    expect(migration).toContain('CREATE FUNCTION public.get_bank_gl_book_balance');
  });

  it('locks match mutations and limits allocations to the remaining bank and GL line amounts', () => {
    expect(migration).toContain('CREATE TRIGGER bank_reconciliation_match_lock_guard');
    expect(migration).toContain('Unreconcile the statement before changing matches');
    expect(migration).toContain('Match would exceed the remaining amount on a line');
    expect(migration).toContain('v_bank_signed_amount > 0 AND NOT v_journal_is_debit');
  });

  it('uses existing lock metadata and does not alter legacy statement schemas', () => {
    expect(migration).toContain('s.is_locked');
    expect(migration).toContain('s.reconciled_at');
    expect(migration).not.toMatch(/ALTER TABLE public\.(?:bank_statements|bank_statement_lines)\b/i);
    expect(migration).not.toMatch(/v_statement\.status|SET status\s*=/i);
  });
});
