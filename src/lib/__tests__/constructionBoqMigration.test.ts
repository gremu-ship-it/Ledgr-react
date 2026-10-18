import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261030000000_construction_project_boq.sql', 'utf8');
describe('construction BOQ migration contract', () => {
  it('adds the nullable forward-compatible project lock and RLS-protected lines', () => {
    expect(sql).toContain(
      'ALTER TABLE public.construction_projects ADD COLUMN IF NOT EXISTS boq_locked_at timestamptz',
    );
    expect(sql).toContain('CREATE TABLE public.project_boq_lines');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('construction_procurement_capabilities_for(p.business_id)');
    expect(sql).toContain('CREATE INDEX project_boq_lines_order ON public.project_boq_lines(project_id,sort_order)');
  });
  it('defines batch operations, calculated totals, aggregate summary and lock checks for all writes', () => {
    expect(sql).toContain('CREATE FUNCTION public.bulk_upsert_boq_lines');
    expect(sql).toContain('CREATE FUNCTION public.get_boq_summary');
    expect(sql).toContain('round(v_qty*v_rate,2)');
    for (const rpc of ['create_boq_line','update_boq_line','delete_boq_line','reorder_boq_lines','bulk_upsert_boq_lines']) {
      const start = sql.indexOf(`CREATE FUNCTION public.${rpc}`);
      const end = sql.indexOf('$$;', start);
      expect(sql.slice(start, end)).toContain("BOQ is locked and cannot be edited");
      expect(sql.slice(start, end)).toContain('_ledgr_construction_actor');
    }
  });
});
