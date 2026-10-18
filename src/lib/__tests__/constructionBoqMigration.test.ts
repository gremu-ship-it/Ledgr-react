import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261030000000_construction_project_boq.sql', 'utf8');
/**
 * Every object this file declares is GUARDED (IF NOT EXISTS / DROP POLICY IF
 * EXISTS / CREATE OR REPLACE). That is not stylistic: on 2026-10-18 the
 * production deploy died on `relation "projects" already exists` (SQLSTATE
 * 42P07) because the Phase A objects were live on that database while version
 * 20261028000000 was not recorded in supabase_migrations.schema_migrations —
 * they had been applied by hand, which commits the objects and records no
 * version. `db push` then re-applies the file, so an unguarded CREATE is a
 * deploy outage. See tests/database/construction_projects_convergence.test.js.
 */
describe('construction BOQ migration contract', () => {
  it('adds the nullable forward-compatible project lock and RLS-protected lines', () => {
    expect(sql).toContain('ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS boq_locked_at timestamptz');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.project_boq_lines');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('construction_procurement_capabilities_for(p.business_id)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS project_boq_lines_order ON public.project_boq_lines(project_id,sort_order)');
  });

  it('is safe to re-apply on a database that already carries its objects', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS project_boq_lines_member_grants ON public.project_boq_lines');
    expect(sql).not.toMatch(/^CREATE TABLE public\./m);
    expect(sql).not.toMatch(/^CREATE INDEX (?!IF NOT EXISTS)/m);
    expect(sql).not.toMatch(/^CREATE FUNCTION public\./m);
    expect(sql).not.toMatch(/^ALTER TABLE public\.[a-z_]+ ADD COLUMN (?!IF NOT EXISTS)/m);
  });
  it('defines batch operations, calculated totals, aggregate summary and lock checks for all writes', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.bulk_upsert_boq_lines');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_boq_summary');
    expect(sql).toContain('round(v_qty*v_rate,2)');
    for (const rpc of ['create_boq_line','update_boq_line','delete_boq_line','reorder_boq_lines','bulk_upsert_boq_lines']) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${rpc}`);
      const end = sql.indexOf('$$;', start);
      expect(sql.slice(start, end)).toContain("BOQ is locked and cannot be edited");
      expect(sql.slice(start, end)).toContain('_ledgr_construction_actor');
    }
  });
});
