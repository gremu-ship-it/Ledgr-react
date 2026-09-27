import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * IC 2026-09-25 — static contracts for the containment changes that live in
 * workflow/SQL/edge source (their runtime behaviour is proven on real
 * PostgreSQL / the Edge VM in tests/release/ic-containment.test.ts).
 */
const read = (p: string) => readFileSync(p, 'utf8');

describe('P1 repair workflow gate', () => {
  const wf = read('.github/workflows/repair-eagle-nova-double-count.yml');
  const onBlock = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'));
  it('has no automatic (push / schedule / pull_request) trigger', () => {
    expect(onBlock).not.toMatch(/^\s{2}push:/m);
    expect(onBlock).not.toMatch(/^\s{2}schedule:/m);
    expect(onBlock).not.toMatch(/^\s{2}pull_request/m);
    expect(onBlock).toMatch(/^\s{2}workflow_dispatch:/m);
  });
  it('requires main, the repository owner, the enable variable and the confirmation phrase', () => {
    expect(wf).toContain("github.ref == 'refs/heads/main'");
    expect(wf).toContain('github.actor == github.repository_owner');
    expect(wf).toContain("vars.LEDGR_REPAIR_WORKFLOW_ENABLED == 'true'");
    expect(wf).toContain("inputs.confirm == 'I AM THE OWNER AND APPROVE A PRODUCTION DATA REPAIR'");
  });
  it('is a dry run unless dry_run=false is chosen explicitly, and never checks out an arbitrary ref', () => {
    expect(wf).toContain("DRY_RUN: ${{ inputs.dry_run == 'false' && '0' || '1' }}");
    expect(wf).not.toMatch(/inputs\.ref/);
  });
  it('keeps the repair scripts (evidence preserved)', () => {
    expect(read('scripts/repair-eagle-nova-double-count.sql').length).toBeGreaterThan(0);
  });
});

describe('P2 backfill containment', () => {
  const sql = read('supabase/migrations/20261011000000_ic_contain_backfill_execute.sql');
  it('revokes EXECUTE from public, anon and authenticated; only service_role keeps it', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.backfill_and_recalculate_inventory\\(uuid\\) from ${role};`));
    }
    expect(sql).toMatch(/grant execute on function public\.backfill_and_recalculate_inventory\(uuid\) to service_role;/);
    expect(sql).not.toMatch(/^\s*grant[^;]*to authenticated/im);
  });
  it('does not execute, drop or rewrite the function', () => {
    expect(sql).not.toMatch(/select\s+(\*\s+from\s+)?public\.backfill_and_recalculate_inventory/i);
    expect(sql).not.toMatch(/drop function|create (or replace )?function/i);
  });
  it('the Warehouse button is disabled with an explanation', () => {
    const page = read('src/pages/WarehousePage.tsx');
    expect(page).toContain('export const STOCK_SYNC_SUSPENDED = true;');
    expect(page).toContain('disabled={STOCK_SYNC_SUSPENDED || syncMutation.isPending}');
  });
});

describe('P3 ai-chat uses the caller JWT for ai_context', () => {
  const src = read('supabase/functions/ai-chat/index.ts');
  it('never calls ai_context with the service-role client', () => {
    expect(src).not.toMatch(/admin\s*\.rpc\(\s*'ai_context'/);
    expect(src).toMatch(/userClient\.rpc\('ai_context'/);
  });
  it('the user client is built from the ANON key and the caller Authorization header', () => {
    expect(src).toMatch(/createClient\(SUPABASE_URL, ANON_KEY, \{[\s\S]{0,120}Authorization: authHeader/);
  });
});

describe('P5 COGS failure is atomic', () => {
  const sql = read('supabase/migrations/20261011000001_ic_cogs_failure_atomic.sql');
  it('no COGS failure is downgraded to a warning in either redefined function', () => {
    expect(sql).not.toMatch(/raise warning 'COGS posting failed/);
    expect((sql.match(/raise exception 'COGS posting failed for sale/g) ?? []).length).toBe(2);
  });
});

describe('P9 deploy safeguards', () => {
  const wf = read('.github/workflows/deploy.yml');
  for (const env of ['staging', 'production']) {
    it(`${env}: Vercel pre-flight runs before the DB migration; target verified before the frontend; manifest always`, () => {
      const pre = wf.indexOf(`Pre-flight frontend deploy credentials (${env})`);
      const migrate = wf.indexOf(`Link & migrate ${env} database`);
      const verify = wf.indexOf(`Verify DB reached migration target (${env})`);
      const frontend = wf.indexOf(`Deploy frontend to Vercel (${env})`);
      const manifest = wf.indexOf(`Release manifest (${env})`);
      expect(pre).toBeGreaterThan(0);
      expect(migrate).toBeGreaterThan(pre);
      expect(verify).toBeGreaterThan(migrate);
      expect(frontend).toBeGreaterThan(verify);
      expect(manifest).toBeGreaterThan(frontend);
    });
  }
  it('passes the migration target into the frontend build', () => {
    expect((wf.match(/--build-env VITE_MIGRATION_TARGET="\$MIGRATION_TARGET"/g) ?? []).length).toBe(2);
  });
});
