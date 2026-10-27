import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261110000000_p4b1_bank_reconciliation_foundation.sql', import.meta.url),
  'utf8',
);

describe('P4B-1 bank reconciliation migration contract', () => {
  it('adds only the new account, metadata, and future match tables', () => {
    expect(migration).toMatch(/CREATE TABLE public\.bank_accounts\s*\(/);
    expect(migration).toMatch(/CREATE TABLE public\.bank_statement_import_metadata\s*\(/);
    expect(migration).toMatch(/CREATE TABLE public\.bank_reconciliation_matches\s*\(/);
    expect(migration).not.toMatch(/ALTER TABLE public\.(?:bank_statements|bank_statement_lines)\b/i);
    expect(migration).not.toMatch(/CREATE TRIGGER .* ON public\.(?:bank_statements|bank_statement_lines)\b/i);
  });

  it('uses business-scoped write/admin helpers and the existing statement idempotency key', () => {
    expect(migration).toContain('can_write_business_data(p_business_id)');
    expect(migration).toContain('can_admin_business_data(p_business_id)');
    expect(migration).toMatch(/ON CONFLICT \(business_id, account_id, statement_date\)/);
    expect(migration).toContain('DELETE FROM public.bank_statement_lines');
    expect(migration).toContain('CREATE FUNCTION public.delete_draft_bank_statement');
  });

  it('queries posted journal entries and excludes both legacy reconciled and matched lines', () => {
    expect(migration).toContain("je.status = 'posted'");
    expect(migration).toContain('jl.reconciled = false');
    expect(migration).toContain('public.bank_reconciliation_matches m');
    expect(migration).toContain('CREATE FUNCTION public.get_unreconciled_gl_lines');
  });
});
