import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the tenant-isolation half of scripts/audit-role-rls.sql — sections 2,
 * 3 and 4, closed by 20260729000000.
 *
 * rlsRoleParity.test.ts covers the failure mode where the database denies a
 * write the UI offered: loud, and someone files a bug. These are the opposite
 * and quieter. A table with `business_id` and RLS disabled, or a view without
 * `security_invoker`, returns OTHER TENANTS' rows to anyone who edits the
 * business_id in a request. Nothing errors, so nothing gets reported.
 *
 * Four reporting views were reachable this way — v_trial_balance, v_ar_ageing,
 * v_asset_register, v_reorder_alerts — each read by a repository that scopes it
 * with a caller-supplied `.eq('business_id', …)`.
 *
 * These assertions are static: they read the migration, not a database. The
 * behavioural proof (a second tenant reading Acme's trial balance before the
 * migration and zero rows after) was run against Postgres 18 via PGlite while
 * writing it, but that needs a live server and does not belong in the unit
 * suite. What is pinned here is the reasoning that would otherwise be
 * undone by a later edit.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase/migrations');
const AUDIT_MIGRATION = resolve(MIGRATIONS_DIR, '20260729000000_rls_audit_followups.sql');

const sql = () => readFileSync(AUDIT_MIGRATION, 'utf8');

/** Migration text with `--` comments stripped, so prose cannot satisfy a test. */
function sqlBody(): string {
  return sql()
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('RLS audit follow-ups: tenant isolation', () => {
  it('enables RLS on the business-scoped tables that shipped without it', () => {
    // 20260725000001 created both with `business_id uuid not null` and never
    // enabled RLS, so every tenant's invoice delivery history and recurring
    // schedules were world-readable to any authenticated user.
    const body = sqlBody();
    for (const table of ['invoice_delivery_events', 'recurring_invoices']) {
      expect(body, `${table} must have RLS enabled`).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it('keeps invoice_delivery_events read-only for clients', () => {
    // Only Edge Functions write it, all with the service role, which bypasses
    // RLS. An insert policy would widen the surface for no caller.
    const body = sqlBody();
    const section = body.slice(
      body.indexOf('alter table public.invoice_delivery_events'),
      body.indexOf('alter table public.recurring_invoices'),
    );
    expect(section).toContain('for select using (public.is_business_member(business_id))');
    expect(section).not.toMatch(/for\s+(insert|update|delete)/);
  });

  it('gates recurring_invoices writes on the shared capability helpers', () => {
    const body = sqlBody();
    const section = body.slice(body.indexOf('alter table public.recurring_invoices'));
    expect(section).toContain('public.can_write_business_data(business_id)');
    // auto_send means a row here sends mail on a schedule; hard delete stays
    // owner/admin like every other admin-tier table.
    expect(section).toContain('for delete using (public.can_admin_business_data(business_id))');
  });

  it('leaves api_usage with RLS on and no policy', () => {
    // Rate-limit buckets keyed by API key hash. Any client-visible policy would
    // let a caller fill another key's bucket to lock them out, or clear their
    // own to lift the limit. Service role only is the correct end state.
    const body = sqlBody();
    expect(body).toContain('alter table public.api_usage enable row level security');
    expect(body).toContain('revoke all on public.api_usage from anon, authenticated');
    expect(body).not.toMatch(/create policy \w*api_usage/);
  });

  it('never hardcodes a role list — the defect the earlier migrations fixed', () => {
    // Every gate must route through the capability helpers that mirror
    // usePermissions.ts. A literal role list here would re-create exactly the
    // drift that 20260728000008 was written to remove.
    const body = sqlBody();
    const knownRoles = [
      'supervisor',
      'data_entry',
      'sales_clerk',
      'warehouse_worker',
      'branch_manager',
      'accountant',
    ];
    for (const role of knownRoles) {
      expect(body, `role '${role}' is hardcoded; use a capability helper`).not.toContain(
        `'${role}'`,
      );
    }
    expect(body).toContain('public.can_write_business_data');
    expect(body).toContain('public.is_business_member');
  });

  it('routes payroll tables to the payroll helpers, not the member tier', () => {
    // The sweep in section 4 applies to any business-scoped table with RLS off,
    // which could include employees. Using the general member tier there would
    // expose every salary to all 19 roles — the exact trap 20260728000009
    // called out.
    const body = sqlBody();
    const sweep = body.slice(body.indexOf('payroll_tables'));
    expect(sweep).toContain('public.can_view_payroll');
    expect(sweep).toContain('public.can_write_payroll');
    expect(body).toMatch(/payroll_tables\s+constant text\[\]/);
  });

  it('skips tables whose business_id is nullable instead of hiding their rows', () => {
    // Enabling RLS where business_id is NULL-able would make NULL-tenant rows
    // invisible to every client at once, since the helpers return false for
    // NULL. Those get named in a warning for a human to decide on.
    const body = sqlBody();
    expect(body).toContain("col.is_nullable = 'NO'");
    expect(sql()).toMatch(/skipped_nullable/);
  });

  it('does not touch tables that already have RLS enabled', () => {
    // A table with RLS on has policies someone reasoned about. Overwriting them
    // from a blind catalog loop is how the next incident starts.
    expect(sqlBody()).toContain('not c.relrowsecurity');
  });
});

describe('RLS audit follow-ups: view isolation', () => {
  it('flips owner-rights views to security_invoker', () => {
    const body = sqlBody();
    expect(body).toContain('alter view public.%I set (security_invoker = true)');
    // Catalog-driven, not a hardcoded list: the premise of the audit finding is
    // that the repo cannot see every view that exists on the database.
    expect(body).toContain("c.relkind = 'v'");
  });

  it('preserves the one view that must keep owner rights', () => {
    // v_partner_client_usage counts journal_entries / invoices for businesses a
    // partner admin deliberately cannot read. Under invoker rights those counts
    // silently become 0 instead of erroring, so its tenant check lives in the
    // view body (is_partner_admin) — see 20260727000008.
    const body = sqlBody();
    expect(body).toContain("intentional_owner constant text[] := array['v_partner_client_usage']");
    expect(body).toMatch(/not \(c\.relname = any\(intentional_owner\)\)/);
  });

  it('does not blanket-grant select while flipping views', () => {
    // Re-granting inside the sweep would widen access to any view deliberately
    // left ungranted. Only the reloption changes.
    const body = sqlBody();
    const sweep = body.slice(
      body.indexOf('intentional_owner constant'),
      body.indexOf('audit_rls_gaps'),
    );
    expect(sweep).not.toMatch(/grant select on public\.%I to authenticated/);
  });

  it('flips views only after the base tables are protected', () => {
    // security_invoker only isolates a view as far as its base tables' RLS
    // does. Flipping v_trial_balance while `accounts` still had RLS off would
    // look like a fix and change nothing.
    const body = sqlBody();
    const sweepTables = body.indexOf('payroll_tables');
    const sweepViews = body.indexOf('security_invoker = true)');
    expect(sweepTables).toBeGreaterThan(-1);
    expect(sweepViews).toBeGreaterThan(-1);
    expect(sweepTables, 'tables must be secured before views are flipped').toBeLessThan(sweepViews);
  });
});

describe('RLS audit follow-ups: the audit itself', () => {
  it('ships audit_rls_gaps() so the check is a query, not a ritual', () => {
    const body = sqlBody();
    expect(body).toContain('create or replace function public.audit_rls_gaps()');
    // Known-intentional cases must be classified 'ok', so any non-ok row is
    // genuinely actionable rather than noise people learn to scroll past.
    expect(body).toContain("'subscription_reminders_sent'");
    expect(body).toContain("'api_usage'");
  });

  it('restricts the audit function to the service role', () => {
    // It enumerates the security posture of the whole schema — not something to
    // expose to an application session.
    const body = sqlBody();
    expect(body).toContain('revoke all on function public.audit_rls_gaps() from public');
    expect(body).toContain('grant execute on function public.audit_rls_gaps() to service_role');
    expect(body).not.toMatch(/grant execute on function public\.audit_rls_gaps\(\) to authenticated/);
  });

  it('fails the migration if the named tables are left unprotected', () => {
    // A partial run must not look like a success.
    const body = sqlBody();
    expect(body).toMatch(/raise exception\s*\n?\s*'RLS is still disabled on public/);
  });
});

describe('migration hygiene', () => {
  it('is ordered after the migrations whose helpers it depends on', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const audit = files.indexOf('20260729000000_rls_audit_followups.sql');
    const helpers = files.indexOf('20260728000008_role_aware_master_data_rls.sql');
    expect(audit).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(helpers);
  });

  it('checks its dependencies at runtime rather than assuming them', () => {
    const body = sqlBody();
    expect(body).toContain("to_regprocedure('public.can_write_business_data(uuid)') is null");
    // ALTER VIEW ... SET (security_invoker) needs PG15+.
    expect(body).toContain("current_setting('server_version_num')::int < 150000");
  });
});
