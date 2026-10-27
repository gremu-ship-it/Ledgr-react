import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261108000000_construction_site_lifecycle.sql',
  'utf8',
);
const traceability = readFileSync(
  'supabase/migrations/20261021000000_construction_procurement_traceability.sql',
  'utf8',
);

/**
 * Static contract for the P2-4 construction site lifecycle migration.
 *
 * Guards the phase promises: the project FK is additive and nullable,
 * project_ref survives as display text, the register command / capability
 * grant / append-only trigger are untouched, the lifecycle RPCs reuse the
 * register command's exact marker bypass ('site_upsert') and the house actor
 * gate, and the deactivation guards speak the real schema vocabulary
 * (PO statuses draft/authorized/cancelled; issues/returns are append-only
 * evidence with no lifecycle status, so no vacuous guard exists).
 * Behavioral proofs live in the release-evidence replay suites.
 *
 * Negative assertions run against comment-stripped SQL: the documentary
 * header legitimately NAMES the frozen functions and the absent guard tables.
 */
const code = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('construction site lifecycle migration contract', () => {
  it('is uniquely versioned after client linkage, before the next additive report migration', () => {
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const versions = files.map((f) => f.split('_')[0]);
    expect(versions[versions.length - 1]).toBe('20261110000002');
    expect(versions.filter((v) => v === '20261108000000')).toHaveLength(1);
    expect(versions.indexOf('20261108000000')).toBe(
      versions.indexOf('20261107000000') + 1,
    );
    expect(versions.indexOf('20261109000000')).toBe(
      versions.indexOf('20261108000000') + 1,
    );
  });

  it('adds a nullable project FK with ON DELETE SET NULL, indexed and commented', () => {
    expect(code).toContain('add column if not exists project_id uuid null');
    expect(code).toContain(
      'references public.construction_projects(id) on delete set null',
    );
    expect(code).toContain(
      'create index if not exists idx_construction_procurement_sites_project_id',
    );
    expect(code).toContain(
      'comment on column public.construction_procurement_sites.project_id',
    );
  });

  it('keeps project_ref as required display text and is_active shape-stable', () => {
    expect(code).not.toMatch(/drop\s+column/i);
    expect(code).not.toMatch(/alter\s+column\s+project_ref/i);
    expect(code).not.toMatch(/alter\s+column\s+is_active/i);
    // The verifier pins both columns instead.
    expect(code).toContain(
      "column_name = 'project_ref' and is_nullable = 'NO'",
    );
    expect(code).toContain("column_name = 'is_active' and is_nullable = 'NO'");
    expect(code).toContain("column_default = 'true'");
  });

  it('does not modify the register command, the capability grant, the actor helper or the append-only trigger', () => {
    expect(code).not.toMatch(
      /create or replace function public\.register_construction_procurement_site/i,
    );
    expect(code).not.toMatch(
      /create or replace function public\.grant_construction_procurement_capability/i,
    );
    expect(code).not.toMatch(
      /create or replace function public\._ledgr_construction_append_only/i,
    );
    expect(code).not.toMatch(/create trigger|drop trigger/i);
    expect(code).not.toMatch(/alter\s+table\s+public\.construction_projects\s/i);
    expect(code).not.toMatch(/create policy|enable row level security/i);
    // The register body in the frozen 20261021 file still owns its signature.
    expect(traceability).toContain(
      'create or replace function public.register_construction_procurement_site(',
    );
  });

  it("reuses the register command's marker bypass exactly — the site_upsert token, raised and cleared once per RPC", () => {
    const raises =
      code.split(
        "perform set_config('ledgr.construction_command', 'site_upsert', true)",
      ).length - 1;
    const clears =
      code.split("perform set_config('ledgr.construction_command', '', true)")
        .length - 1;
    expect(raises).toBe(2);
    expect(clears).toBe(2);
    // Byte-identical mechanism to the frozen register command.
    expect(traceability).toContain(
      "perform set_config('ledgr.construction_command', 'site_upsert', true);",
    );
    // No new token is invented anywhere.
    expect(code).not.toContain('site_status_change');
    expect(code).not.toContain('site_update');
  });

  it('gates both RPCs through the house actor on procurement.master.manage', () => {
    // The brief's has_construction_procurement_capability() does not exist in
    // this schema; the house gate is the actor helper used by every command.
    expect(code).not.toContain('has_construction_procurement_capability');
    const actorCalls =
      code.split(
        "public._ledgr_construction_actor(v_site.business_id, 'procurement.master.manage')",
      ).length - 1;
    expect(actorCalls).toBe(2);
  });

  it('guards deactivation with the real schema vocabulary and pins the vacuous-guard decision', () => {
    // PO statuses are exactly draft/authorized/cancelled: open = not cancelled.
    expect(code).toContain("and status <> 'cancelled'");
    expect(code).toContain(
      'Cannot deactivate: % open purchase order(s) reference this site',
    );
    // Same stock guard shape as P2-1 location deactivation: positive units only.
    expect(code).toContain('Cannot deactivate: linked location has % units on hand');
    expect(code).toContain('quantity_on_hand > 0');
    // Material issues/returns have no lifecycle status, so the ONLY mentions
    // in executable SQL are the verifier pins forbidding a vacuous guard.
    expect(code.match(/construction_material_issues/g)).toHaveLength(1);
    expect(code.match(/construction_material_returns/g)).toHaveLength(1);
    expect(code).toContain(
      'a guard would be vacuous and must not appear',
    );
  });

  it('carries explicit unlink intent because COALESCE cannot distinguish null from unset', () => {
    expect(code).toContain('p_set_project boolean default false');
    expect(code).toContain(
      'case when p_set_project then p_project_id else project_id end',
    );
    // Name and reference stay COALESCE-partial and non-empty validated.
    expect(code).toContain('coalesce(v_name, site_name)');
    expect(code).toContain('coalesce(v_project, project_ref)');
    expect(code).toContain(
      "public._ledgr_construction_text(p_site_name, 'The site name')",
    );
    expect(code).toContain(
      "public._ledgr_construction_text(p_project_ref, 'The project reference')",
    );
    // Tenant isolation on the FK target.
    expect(code).toContain(
      'Project not found or does not belong to this business',
    );
  });

  it('keeps the no-op short circuit, FOR UPDATE locking and jsonb receipts', () => {
    expect(code).toContain("'status', 'no_change'");
    expect(code).toContain("'status', 'ok'");
    expect(code.match(/for update;/g)).toHaveLength(2);
    expect(code).toContain("'Site not found: %'");
    expect(code).toContain("errcode = 'P0002'");
    expect(code).toContain("errcode = '55000'");
  });

  it('follows the register ACL house pattern (authenticated + service_role only)', () => {
    expect(code).toContain(
      'revoke all on function public.set_construction_procurement_site_status(uuid, boolean, text) from public, anon;',
    );
    expect(code).toContain(
      'grant execute on function public.set_construction_procurement_site_status(uuid, boolean, text) to authenticated, service_role;',
    );
    expect(code).toContain(
      'revoke all on function public.update_construction_procurement_site(uuid, text, uuid, text, boolean) from public, anon;',
    );
    expect(code).toContain(
      'grant execute on function public.update_construction_procurement_site(uuid, text, uuid, text, boolean) to authenticated, service_role;',
    );
  });

  it('backfills by exact name match, reports instead of guessing, and creates nothing', () => {
    expect(code).toContain('where project_id is null');
    expect(code).toContain(
      'lower(trim(p.name)) = lower(trim(site.project_ref))',
    );
    expect(code).toContain(
      'AMBIGUOUS: site % project_ref "%" matches % projects — skipped',
    );
    expect(code).toContain('NO MATCH: site % project_ref "%" — skipped');
    expect(code).not.toMatch(/insert into public\.construction_projects/i);
    expect(code).not.toMatch(/insert into public\.construction_procurement_sites/i);
    // The backfill writes the FK column only.
    expect(code).toContain('set project_id = matched_id');
  });

  it('ships a replay verifier with balanced named dollar tags', () => {
    expect(code.split('$site_project_backfill$').length - 1).toBe(2);
    expect(code.split('$site_lifecycle_verify$').length - 1).toBe(2);
    // The verifier pins the frozen surfaces and the new guarantees.
    expect(code).toContain("tgname = 'trg_construction_append_only'");
    expect(code).toContain(
      "position('site_upsert' in pg_get_triggerdef(t.oid)) > 0",
    );
    // tgargs carries NUL separators; convert_from on it would raise 22021.
    expect(code).not.toContain('convert_from(tgargs');
    expect(code).toContain(
      "to_regprocedure('public.register_construction_procurement_site(uuid,uuid,uuid,text,text,text)')",
    );
    expect(code).toContain(
      'grant_construction_procurement_capability must survive untouched',
    );
    expect(code).toContain(
      'construction_procurement_sites must keep exactly one user trigger',
    );
    expect(code).toContain(
      "has_function_privilege('authenticated', 'public.set_construction_procurement_site_status(uuid,boolean,text)', 'EXECUTE')",
    );
    expect(code).toContain("v_confdel <> 'n'");
  });
});
