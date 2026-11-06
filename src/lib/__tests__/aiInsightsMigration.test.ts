import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261214000000_ai_insights.sql', 'utf8');

describe('AI anomaly diagnostics migration contract', () => {
  it('scopes persistent findings to businesses and the supported categories/severities', () => {
    expect(migration).toContain('REFERENCES public.businesses(id) ON DELETE CASCADE');
    for (const category of ['duplicate_invoice', 'unallocated_cost_center', 'missing_tax_tag', 'amount_outlier', 'payroll_variance']) {
      expect(migration).toContain(`'${category}'`);
    }
    for (const severity of ['high', 'medium', 'low']) expect(migration).toContain(`'${severity}'`);
    expect(migration).not.toMatch(/organisation_id|organisations/i);
  });

  it('restricts findings to active business members and only allows authenticated resolution', () => {
    expect(migration).toContain('public.is_business_member(business_id)');
    expect(migration).toContain('resolved_by = auth.uid()');
    expect(migration).toContain('GRANT UPDATE (is_resolved, resolved_at, resolved_by)');
    expect(migration).toContain('REVOKE ALL ON public.ai_anomaly_logs FROM PUBLIC, anon');
  });

  it('requires an active Enterprise plan and validates each source row before insert', () => {
    expect(migration).toContain("public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'");
    expect(migration).toContain('public.can_run_ai_anomaly_scan(p_business_id)');
    for (const table of ['expenses', 'expense_lines', 'journal_entries', 'payroll_runs']) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain('ON CONFLICT (business_id, category, source_table, source_id)');
    expect(migration).toContain('DO NOTHING');
  });
});
