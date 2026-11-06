import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const migration = readFileSync(
  path.join(repositoryRoot, 'supabase/migrations/20261216000000_revoke_public_grants_from_rpc_only_tables.sql'),
  'utf8',
);

const rpcOnlyTables = [
  'ai_insights_usage', 'api_usage', 'audit_20260927_sent_to_paid',
  'business_terms_acceptances', 'partner_staff', 'phone_accounts',
  'pos_approvals', 'pos_corrections', 'pos_held_orders', 'profiles',
  'subscription_reminders_sent', 'subscriptions', 'support_agent_usage', 'usage_counters',
];

describe('RPC-only table privilege hardening migration', () => {
  it('revokes TRUNCATE from client roles on existing and future public tables', () => {
    expect(migration).toMatch(/REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated/i);
    expect(migration).toContain("rolname IN ('postgres', 'supabase_admin')");
  });

  it('removes all direct client grants from the verified no-policy RPC/service tables', () => {
    for (const table of rpcOnlyTables) expect(migration).toContain(`'${table}'`);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
    expect(migration).not.toMatch(/REVOKE[^;]*\bservice_role\b/is);
  });
});
