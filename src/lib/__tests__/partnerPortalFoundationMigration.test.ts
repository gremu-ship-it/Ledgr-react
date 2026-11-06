import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261212000000_partner_portal_foundation_phase_6f1.sql', 'utf8');

describe('Partner Portal Phase 6F-1 migration contract', () => {
  it('extends the existing partner/business schema without creating parallel tenant tables', () => {
    expect(sql).toContain('ALTER TABLE public.partner_clients');
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public\.(partners|partner_clients|organisations|organizations)\b/i);
    expect(sql).toContain("CHECK (status IN ('active', 'onboarding', 'suspended', 'archived'))");
    expect(sql).toContain('onboarded_at');
  });

  it('keeps usage and activity views explicitly scoped to the signed-in partner admin', () => {
    expect(sql.match(/public\.is_partner_admin\(auth\.uid\(\), pc\.partner_id\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain('CREATE OR REPLACE VIEW public.v_partner_client_usage');
    expect(sql).toContain('public.effective_plan_tier(b.plan_tier, b.plan_expires_at) AS plan_tier');
    expect(sql).toContain('CREATE OR REPLACE VIEW public.v_partner_client_activity');
    expect(sql).toContain('REVOKE ALL ON public.v_partner_client_activity FROM anon');
  });

  it('does not expose ledger amounts or payroll values in the cross-client activity stream', () => {
    const activityView = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.v_partner_client_activity'));
    expect(activityView).not.toMatch(/total_gross|total_net|amount_due|total_amount|debit|credit/i);
    expect(activityView).toContain("'journal_entry'::text");
    expect(activityView).toContain("'invoice'::text");
    expect(activityView).toContain("'pay_run'::text");
  });
});
