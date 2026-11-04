import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261205000000_budget_vs_actual.sql', 'utf8');

describe('budget vs actual migration contract', () => {
  it('adds an explicit budget lifecycle while preserving legacy active state', () => {
    expect(sql).toContain("CASE WHEN is_active THEN 'active' ELSE 'closed' END");
    expect(sql).toContain("status IN ('draft', 'active', 'closed')");
    expect(sql).toContain("ALTER COLUMN status SET DEFAULT 'draft'");
    expect(sql).toContain("OLD.status = 'draft' AND NEW.status = 'active'");
    expect(sql).toContain("OLD.status = 'active' AND NEW.status = 'closed'");
  });

  it('protects draft-only budget changes and restricts lines to tenant income/expense accounts', () => {
    expect(sql).toContain('Only draft budgets may be edited');
    expect(sql).toContain('Budget lines may only be changed while the budget is a draft');
    expect(sql).toContain('Budget lines cannot be moved between budgets or businesses');
    expect(sql).toContain('v_account_type public.account_type');
    expect(sql).toContain("v_account_type NOT IN ('income', 'expense')");
    expect(sql).toContain('v_account_business_id <> NEW.business_id');
  });
});
