import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261130000001_profit_loss_exclude_reversal_pairs.sql'),
  'utf8',
);

describe('P&L reversal-pair RPC migration', () => {
  it('adds a P&L-only RPC without replacing the canonical trial-balance function', () => {
    expect(migration).toContain('create or replace function public.get_profit_loss_trial_balance');
    expect(migration).not.toMatch(/create or replace function public\.get_trial_balance\s*\(/i);
    expect(migration).toContain('public.get_trial_balance(p_business_id, p_date_from, p_date_to, p_branch_id)');
  });

  it('subtracts reversed originals and linked reversal entries from the P&L period totals', () => {
    expect(migration).toMatch(/je\.status::text\s*=\s*'reversed'\s+or\s+je\.reversal_of\s+is\s+not\s+null/i);
    expect(migration).toMatch(/tb\.total_debit\s*-\s*coalesce\(rpt\.debit_total/i);
    expect(migration).toMatch(/tb\.total_credit\s*-\s*coalesce\(rpt\.credit_total/i);
    expect(migration).toMatch(/tb\.balance\s*-\s*\(coalesce\(rpt\.debit_total[\s\S]*-\s*coalesce\(rpt\.credit_total/i);
  });

  it('enforces tenant, branch, date, and authenticated execution boundaries', () => {
    expect(migration).toContain('public.is_business_member(p_business_id)');
    expect(migration).toContain('public.can_access_branch(p_business_id, p_branch_id)');
    expect(migration).toContain('public.can_access_branch(p_business_id, je.branch_id)');
    expect(migration).toContain('je.entry_date >= p_date_from');
    expect(migration).toContain('je.entry_date <= p_date_to');
    expect(migration).toContain('grant execute on function public.get_profit_loss_trial_balance(uuid, date, date, uuid) to authenticated');
  });
});
