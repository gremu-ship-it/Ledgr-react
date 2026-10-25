import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261109000000_trial_balance_rpc.sql', import.meta.url),
  'utf8',
);

describe('Trial Balance RPC migration', () => {
  it('uses the discovered schema and posted-only MWK amount aggregation', () => {
    expect(migration).toContain('a.code');
    expect(migration).toContain('a.name');
    expect(migration).toContain('a.parent_id');
    expect(migration).toContain("je.status = 'posted'::public.journal_status");
    expect(migration).toContain('jl.amount ELSE 0');
    expect(migration).not.toContain('jl.amount_base');
    expect(migration).toContain('AND je.entry_date >= p_date_from');
    expect(migration).toContain('AND je.entry_date <= p_date_to');
  });

  it('validates business and branch access inside the security-definer RPC', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('public.is_business_member(p_business_id)');
    expect(migration).toContain('public.can_access_branch(p_business_id, p_branch_id)');
    expect(migration).toContain('public.can_access_branch(p_business_id, je.branch_id)');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_trial_balance');
    expect(migration).not.toMatch(/OR\s+je\.branch_id\s+IS\s+NULL/i);
  });
});
