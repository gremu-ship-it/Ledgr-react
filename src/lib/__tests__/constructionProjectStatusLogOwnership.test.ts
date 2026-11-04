import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const paths = [
  'supabase/migrations/20261028000000_construction_projects.sql',
  'supabase/migrations/20261028000001_construction_projects_namespace.sql',
];
const files = paths.map((path) => [path, readFileSync(path, 'utf8')] as const);
const guard = (sql: string) => sql.match(/DO \$confirm_project_status_log\$[\s\S]*?\$confirm_project_status_log\$;/)?.[0];

// Fast guardrail only. Real PostgreSQL replays, refusal/no-mutation checks and
// catalog-query execution are in tests/release/construction-project-audit-ownership.test.ts.
describe('project_status_log fail-closed schema guard', () => {
  it('keeps pending Phase A and namespace replays on the same definition', () => {
    expect(guard(files[0][1])).toBeDefined();
    expect(guard(files[0][1])).toEqual(guard(files[1][1]));
  });

  it.each(files)('%s checks before attaching policies, privileges and writes', (_path, sql) => {
    const start = sql.indexOf('DO $confirm_project_status_log$');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(sql.indexOf('CREATE TABLE IF NOT EXISTS public.project_status_log'));
    expect(start).toBeLessThan(sql.indexOf('CREATE INDEX IF NOT EXISTS project_status_log_project'));
    expect(start).toBeLessThan(sql.indexOf('ALTER TABLE public.project_status_log ENABLE ROW LEVEL SECURITY'));
    expect(sql).toContain('GRANT SELECT ON public.construction_projects, public.project_status_log TO authenticated');
  });

  it.each(files)('%s checks defaults and both FK definitions, not just column names', (_path, sql) => {
    const block = guard(sql)!;
    expect(block).toContain("c.relkind IN ('r','p')");
    expect(block).toContain('format_type(a.atttypid, a.atttypmod) <> expected.type_name');
    expect(block).toContain('a.attnotnull IS DISTINCT FROM expected.is_not_null');
    expect(block).toContain('pg_get_expr(d.adbin, d.adrelid)');
    expect(block).toContain("('id', 'uuid', true, 'gen_random_uuid()')");
    expect(block).toContain("('changed_at', 'timestamp with time zone', true, 'now()')");
    expect(block).toContain("('project_id', 'public.construction_projects'::regclass, 'c')");
    expect(block).toContain("('changed_by', 'auth.users'::regclass, 'a')");
    expect(block).toContain('fk.confkey = ARRAY[');
    expect(block).toContain('fk.convalidated AND NOT fk.condeferrable');
  });

  it.each(files)('%s inspects only; never repairs an unconfirmed relation', (_path, sql) => {
    const block = guard(sql)!;
    expect(block).toContain("ERRCODE = '55000'");
    expect(block).toContain('pg_get_userbyid(c.relowner)');
    expect(block).toContain('scripts/database/diagnose-project-status-log.sql');
    expect(block).not.toMatch(/^\s*(ALTER|CREATE|DROP|UPDATE|DELETE|INSERT|GRANT|REVOKE|TRUNCATE)\s+(TABLE|INDEX|INTO|FROM|public\.)/im);
    expect(sql).not.toMatch(/(?:DROP TABLE|ALTER TABLE) public\.project_status_log\s+(?:CASCADE|RENAME|ADD CONSTRAINT)/i);
  });
});
