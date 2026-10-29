import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20261123000000_project_purchase_order_boq_links.sql';
const sql = readFileSync(migrationPath, 'utf8');

describe('project procurement BOQ-link migration contract', () => {
  it('adds one mapping table after the versioned BOQ migration', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.split('_')[0])
      .sort();
    expect(versions.at(-1)).toBe('20261125000000');
    expect(versions.indexOf('20261123000000')).toBe(versions.indexOf('20261122000000') + 1);
    expect(versions.indexOf('20261124000000')).toBe(versions.indexOf('20261123000000') + 1);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.project_purchase_order_boq_links');
    expect(sql).toContain('UNIQUE (business_id, purchase_order_line_id)');
    expect(sql).toContain('REFERENCES public.construction_purchase_order_lines(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES public.boq_items(id) ON DELETE CASCADE');
  });

  it('keeps the mapping tenant-scoped and writes only through a capability-checked RPC', () => {
    expect(sql).toContain('ALTER TABLE public.project_purchase_order_boq_links ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('public.is_business_member(business_id)');
    expect(sql).toContain('public.construction_procurement_capabilities_for(business_id)');
    expect(sql).toContain("public._ledgr_construction_actor(NEW.business_id, 'procurement.po.manage')");
    expect(sql).toContain("public._ledgr_construction_actor(OLD.business_id, 'procurement.po.manage')");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.set_project_purchase_order_boq_link(');
    expect(sql).toContain('GRANT SELECT ON public.project_purchase_order_boq_links TO authenticated');
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT\s*,\s*)?(?:INSERT|UPDATE|DELETE)[^;]*project_purchase_order_boq_links\s+TO\s+authenticated/i);
    expect(sql).toContain("v_po_status <> 'draft'");
    expect(sql).toContain("v_item_status <> 'active'");
    expect(sql).toContain('v_po_product <> v_boq_product');
  });

  it('does not alter protected construction, manufacturing, stock or accounting tables', () => {
    for (const table of [
      'construction_projects',
      'construction_sites',
      'subcontractor_profiles',
      'subcontracts',
      'boq_versions',
      'boq_sections',
      'boq_items',
      'manufacturing_boms',
      'manufacturing_work_orders',
      'stock_movements',
      'journal_entries',
      'journal_lines',
    ]) {
      expect(sql).not.toMatch(new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\.${table}\\b`, 'i'));
    }
    expect(sql).not.toContain('grant_construction_procurement_capability');
    expect(sql).not.toContain('stock_movements');
    expect(sql).not.toContain('journal_entries');
  });
});
