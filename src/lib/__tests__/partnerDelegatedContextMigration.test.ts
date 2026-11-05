import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261213000000_partner_delegated_context_and_billing.sql', 'utf8');

describe('Partner Phase 6F-2 migration contract', () => {
  it('uses existing partner admin identities and businesses for delegated portfolios', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.partner_staff_assignments');
    expect(sql).toContain('REFERENCES public.partner_admins(partner_id, user_id)');
    expect(sql).toContain('REFERENCES public.partner_clients(partner_id, business_id)');
    expect(sql).not.toMatch(/public\.(partner_staff|organisations|organizations)\b/i);
    expect(sql).toContain("pa.role = 'admin'");
  });

  it('allows client access only to partner admins or explicitly assigned staff', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.can_access_partner_client(p_uid uuid, p_partner_id uuid, p_business_id uuid)');
    expect(sql).toContain('a.staff_user_id = p_uid');
    expect(sql).toContain('public.is_partner_manager(p_uid, p_partner_id)');
    expect(sql).toContain('public.can_current_user_access_partner_client(p_partner_id uuid, p_business_id uuid)');
    expect(sql).toContain('WHERE p_uid = auth.uid()');
    expect(sql).toContain('public.can_manage_partner_assignment(auth.uid(), partner_id, business_id)');
    expect(sql).toContain('FOR SELECT USING (public.is_partner_business_admin(id))');
  });

  it('exposes only read-only summaries and adds consolidated billing usage fields', () => {
    expect(sql).toContain('monthly_transaction_count');
    expect(sql).toContain('b.plan_expires_at');
    expect(sql).toContain('public.can_access_partner_client(auth.uid(), pc.partner_id, b.id)');
    const accountingPolicies = sql.slice(sql.indexOf('DO $$'), sql.indexOf('$$;', sql.indexOf('DO $$')));
    expect(accountingPolicies).toContain("'journal_entries'");
    expect(accountingPolicies).not.toMatch(/payroll|employees|pay_runs/i);
    expect(sql).not.toMatch(/CREATE POLICY [^;]+ ON public\.(businesses|journal_entries|invoices)[\s\S]{0,160}FOR (INSERT|UPDATE|DELETE|ALL)/i);
    expect(sql).toContain('REVOKE ALL ON public.v_partner_client_usage FROM anon');
  });
});
