import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the critical RLS isolation fix.
 *
 * The post-remediation verification (2026-08-13) found that four tables
 * shipped without Row Level Security and that the remediation claiming to fix
 * them (`20260728000005_enable_rls_on_unprotected_tables.sql`) did not exist
 * on the branch. PostgREST exposes every table to the anon key, so a table
 * with RLS disabled is cross-tenant readable/writable.
 *
 * The real fix is `20260813000000_enable_rls_on_unprotected_tables.sql`.
 * There is no type system spanning SQL and the runtime DB, so this test pins
 * the migration's load-bearing properties statically: each table must be RLS
 * enabled, `api_usage` must have NO client policy (service-role only), and
 * `currencies` must be read-only. It also asserts the dead rate-limiter
 * (`supabase/functions/api/middleware.ts`) stays deleted.
 *
 * Each assertion was mutation-checked during development: removing an
 * `enable row level security`, adding a policy to `api_usage`, or restoring
 * `middleware.ts` fails this suite.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

const MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260813000000_enable_rls_on_unprotected_tables.sql',
);

const AI_CONTEXT_HARDENING = resolve(
  REPO_ROOT,
  'supabase/migrations/20260825000000_phase10_close_ai_context_anon.sql',
);

const DEAD_MIDDLEWARE = resolve(
  REPO_ROOT,
  'supabase/functions/api/middleware.ts',
);

const UNPROTECTED_TABLES = [
  'invoice_delivery_events',
  'recurring_invoices',
  'api_usage',
  'currencies',
];

describe('RLS isolation migration (20260813000000)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('enables row level security on every previously-unprotected table', () => {
    for (const table of UNPROTECTED_TABLES) {
      expect(
        sql,
        `expected "alter table public.${table} enable row level security"`,
      ).toContain(`public.${table} enable row level security`);
    }
  });

  it('scopes tenant tables by business_id via the member/write helpers', () => {
    expect(sql).toContain('is_business_member(business_id)');
    expect(sql).toContain('can_write_business_data(business_id)');
    expect(sql).toContain('can_admin_business_data(business_id)');
  });

  it('gives api_usage no client policy (service-role only, fail closed)', () => {
    // api_usage is rate-limit counters; only consume_api_rate_limit()
    // (service_role) may touch it. Assert no policy is created on it.
    expect(sql).not.toMatch(/create\s+policy\s+\w+\s+on\s+public\.api_usage/);
  });

  it('makes currencies read-only for authenticated users', () => {
    expect(sql).toContain('for select to authenticated using (true)');
  });

  it('keeps the dead api middleware deleted (never import the buggy limiter)', () => {
    expect(existsSync(DEAD_MIDDLEWARE), 'supabase/functions/api/middleware.ts should not exist').toBe(false);
  });
});

describe('ai_context SECURITY DEFINER hardening (20260825000000)', () => {
  const sql = readFileSync(AI_CONTEXT_HARDENING, 'utf8').toLowerCase();

  it('distinguishes service-role execution from anonymous null-uid requests', () => {
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain('auth.uid() is null or not public.is_business_member(p_business_id)');
  });

  it('revokes default public and anon execute before granting explicit roles', () => {
    expect(sql).toContain('revoke all on function public.ai_context(uuid) from public');
    expect(sql).toContain('revoke all on function public.ai_context(uuid) from anon');
    expect(sql).toContain('grant execute on function public.ai_context(uuid) to authenticated, service_role');
  });
});
