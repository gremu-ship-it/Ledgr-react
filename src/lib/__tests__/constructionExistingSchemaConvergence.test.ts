import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migrations = [
  'supabase/migrations/20261028000000_construction_projects.sql',
  'supabase/migrations/20261028000001_construction_projects_namespace.sql',
].map(path => readFileSync(path, 'utf8'));
const aliasGuard = (sql: string) => sql.match(/DO \$normalize_confirmed_project_lifecycle\$[\s\S]*?\$normalize_confirmed_project_lifecycle\$;/)![0];
const rewrite = (sql: string) => sql.match(/DO \$rewrite_project_rpc_bodies\$[\s\S]*?\$rewrite_project_rpc_bodies\$;/)![0];
const downstream = [
  ['construction_boq', 'supabase/migrations/20261030000000_construction_project_boq.sql', ['project_boq_lines']],
  ['construction_valuations', 'supabase/migrations/20261031000001_construction_progress_valuations.sql',
    ['project_valuations', 'project_valuation_lines', 'project_retention_ledger']],
] as const;

describe('verified construction schema convergence', () => {
  it('uses the same explicit lifecycle variant contract for both pending entry points', () => {
    expect(aliasGuard(migrations[0])).toBeDefined();
    expect(aliasGuard(migrations[0])).toEqual(aliasGuard(migrations[1]));
    for (const sql of migrations) {
      expect(sql.indexOf('DO $normalize_confirmed_project_lifecycle$')).toBeLessThan(
        sql.indexOf('CREATE TABLE IF NOT EXISTS public.construction_projects'),
      );
    }
  });

  it.each(migrations)('verifies ownership, defaults, constraints, audit and typed RPCs before renaming a lifecycle variant', sql => {
    const guard = aliasGuard(sql);
    const rename = guard.indexOf('ALTER TABLE public.projects RENAME COLUMN lifecycle_state TO status;');
    expect(rename).toBeGreaterThan(guard.indexOf('v_spec := $audit_policy$'));
    expect(rename).toBeGreaterThan(guard.indexOf('fk.confrelid = expected.target'));
    expect(rename).toBeGreaterThan(guard.indexOf('p.prorettype <>'));
    expect(guard).toContain("pg_get_userbyid(relowner) = 'postgres'");
    expect(guard).toContain('p.proowner <>');
    expect(guard).toContain('a.attidentity');
    expect(guard).toContain('pg_get_expr(d.adbin,d.adrelid)');
    expect(guard).toContain("p.prosrc ~ '\\mlifecycle_state\\M'");
    expect(guard).toContain("ERRCODE = '55000'");
    expect(guard).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO|DROP TABLE|DROP FUNCTION) public\./);
    expect(guard).not.toMatch(/ALTER TABLE public\.project_status_log.*(?:RENAME|ADD|DROP)/);
  });

  it('rewrites known existing BOQ/valuation/reporting bodies during Phase A, preserving function identities', () => {
    expect(rewrite(migrations[0])).toEqual(rewrite(migrations[1]));
    const block = rewrite(migrations[0]);
    expect(block).toContain("'get_boq_summary'");
    expect(block).toContain("'create_valuation'");
    expect(block).toContain("'get_dashboard_metrics'");
    expect(block).toContain("replace(v_definition, 'public.projects', 'public.construction_projects')");
    expect(block).not.toContain('DROP FUNCTION');
  });

  it.each(downstream)('%s checks pre-existing tables before any DDL or replacement', (name, path, tables) => {
    const sql = readFileSync(path, 'utf8');
    const guard = sql.match(new RegExp(`DO \\$confirm_existing_${name}\\$[\\s\\S]*?\\$confirm_existing_${name}\\$;`))![0];
    expect(guard).toBeDefined();
    for (const table of tables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`DROP POLICY IF EXISTS ${table}_member_grants ON public.${table}`);
    }
    expect(sql.indexOf(guard)).toBeLessThan(sql.indexOf('CREATE TABLE IF NOT EXISTS public.'));
    expect(guard).toContain("v_spec->'constraints'");
    expect(guard).toContain('ix.indisvalid AND ix.indisready');
    expect(guard).toContain("v_index->'columns'");
    expect(guard).toContain('aclexplode');
    expect(guard).toContain('pg_trigger');
    expect(guard).toContain('pg_policy');
    expect(guard).not.toMatch(/^\s*(?:ALTER|CREATE|DROP|UPDATE|DELETE|INSERT|GRANT|REVOKE)\s/m);
    expect(sql).not.toMatch(/DROP (?:TABLE|FUNCTION) public\./);
  });

  it('does not make history repair part of any convergence source', () => {
    for (const sql of [...migrations, ...downstream.map(([, path]) => readFileSync(path, 'utf8'))]) {
      expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+supabase_migrations\./i);
      expect(sql).not.toContain('migration repair --status applied');
    }
  });
});
