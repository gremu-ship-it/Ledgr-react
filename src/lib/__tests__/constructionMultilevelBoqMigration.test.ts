import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20261122000000_construction_multilevel_boq.sql';
const sql = readFileSync(migrationPath, 'utf8');

describe('construction multi-level BOQ migration contract', () => {
  it('is the newest additive migration after manufacturing execution', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.split('_')[0])
      .sort();
    expect(versions.at(-1)).toBe('20261123000000');
    expect(versions.indexOf('20261122000000')).toBe(versions.indexOf('20261121000000') + 1);
    expect(versions.indexOf('20261123000000')).toBe(versions.indexOf('20261122000000') + 1);
    expect(versions.filter((version) => version === '20261122000000')).toHaveLength(1);
  });

  it('creates independent, tenant-scoped version, section and item tables with indexes', () => {
    for (const table of ['boq_versions', 'boq_sections', 'boq_items']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`${table}_member_read`);
      expect(sql).toContain(`${table}_member_write`);
    }
    expect(sql).toContain('REFERENCES public.construction_projects(id)');
    expect(sql).toContain('REFERENCES public.boq_versions(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES public.boq_sections(id) ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY (parent_section_id, boq_version_id, business_id)');
    expect(sql).toContain('UNIQUE (project_id, version_number)');
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).toContain('idx_boq_sections_parent');
    expect(sql).toContain('idx_boq_items_section');
    expect(sql.toLowerCase()).not.toContain('manufacturing_bom');
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.(construction_projects|construction_sites|subcontractor_profiles|subcontracts)\b/i);
  });

  it('calculates item amounts and refreshes version roll-ups after item writes', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.calculate_boq_item_amount()');
    expect(sql).toContain('NEW.amount := round(NEW.quantity * NEW.rate, 2)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.recalculate_boq_total(p_boq_version_id uuid)');
    expect(sql).toContain('CREATE TRIGGER boq_items_recalculate_total AFTER INSERT OR UPDATE OR DELETE');
    expect(sql).toContain('CREATE TRIGGER trg_boq_item_amount BEFORE INSERT OR UPDATE ON public.boq_items');
    expect(sql).toContain('sum(i.amount)');
  });

  it('backfills legacy valuation BOQ lines with stable ids and retains the first-valuation lock', () => {
    expect(sql).toContain('INSERT INTO public.project_boq_lines');
    expect(sql).toContain('SELECT i.id, NEW.project_id');
    expect(sql).toContain('IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION');
    expect(sql).toContain('DELETE FROM public.project_boq_lines WHERE project_id = NEW.project_id');
    expect(sql).toContain('Only unlocked draft BOQ sections can be changed.');
    expect(sql).toContain('Only unlocked draft BOQ items can be changed.');
    expect(sql).toContain('Only unlocked draft BOQ versions can be deleted.');
  });
});
