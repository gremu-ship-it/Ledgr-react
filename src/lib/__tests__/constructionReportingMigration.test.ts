import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../supabase/migrations/20261101000000_construction_project_reporting.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

describe('Phase D construction reporting migration contract', () => {
  it('defines all six read-only reporting RPCs as SECURITY DEFINER with search_path = public', () => {
    for (const fn of [
      'get_project_pnl',
      'get_portfolio_summary',
      'get_project_valuation_trend',
      'get_valuation_trend',
      'get_retention_aging',
      'get_dashboard_metrics',
      'get_cost_breakdown_by_project',
    ]) {
      expect(sql).toMatch(
        new RegExp(`create or replace function public\\.${fn}\\(`, 'i'),
      );
      expect(sql).toContain(`'${fn}(`);
    }
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.%s TO authenticated/i,
    );
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
  });

  it('is strictly read-only and does not create new tables, columns, or capability grants', () => {
    expect(sql).not.toMatch(/\bcreate\s+table\b/i);
    expect(sql).not.toMatch(/\balter\s+table\b/i);
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/provision_construction_defaults/i);
  });

  it('enforces construction_procurement_capabilities_for and scopes to invoiced valuations and project-tagged procurement', () => {
    expect(sql).toContain(
      'public.construction_procurement_capabilities_for(v_project.business_id)',
    );
    expect(sql).toContain(
      'public.construction_procurement_capabilities_for(p_business_id)',
    );
    expect(sql).toContain("v.status = 'invoiced'");
    expect(sql).toContain('WHERE o.project_id = p.id');
    expect(sql).toContain('WHERE i.project_id = p.id');
    expect(sql).toContain('WHERE r.project_id = p.id');
  });
});
