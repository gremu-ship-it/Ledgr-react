import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const schema = readFileSync('supabase/migrations/20261120000000_manufacturing_bom_schema.sql', 'utf8');
const commands = readFileSync('supabase/migrations/20261120000001_manufacturing_bom_rpcs.sql', 'utf8');
const workOrder = readFileSync('supabase/migrations/20261120000002_manufacturing_work_order_bom_explosion.sql', 'utf8');

describe('versioned multi-level manufacturing BOM migrations', () => {
  it('uses the requested timestamps after the current main migration history', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.split('_')[0])
      .sort();
    expect(versions).toContain('20261120000000');
    expect(versions).toContain('20261120000001');
    expect(versions).toContain('20261120000002');
    expect(versions.indexOf('20261120000001')).toBe(versions.indexOf('20261120000000') + 1);
    expect(versions.indexOf('20261120000002')).toBe(versions.indexOf('20261120000001') + 1);
    expect(versions.filter((version) => version === '20261120000000')).toHaveLength(1);
    expect(versions.filter((version) => version === '20261120000001')).toHaveLength(1);
    expect(versions.filter((version) => version === '20261120000002')).toHaveLength(1);
    expect(versions[versions.length - 1]).toBe('20261129000000');
  });

  it('extends the existing manufacturing BOM model with an exclusive sub-assembly reference', () => {
    expect(schema).toContain('ALTER TABLE public.manufacturing_bom_lines');
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS component_bom_id uuid');
    expect(schema).toContain('ALTER COLUMN component_product_id DROP NOT NULL');
    expect(schema).toContain('manufacturing_bom_lines_exactly_one_component');
    expect(schema).toContain('(component_product_id IS NOT NULL AND component_bom_id IS NULL)');
    expect(schema).toContain('(component_product_id IS NULL AND component_bom_id IS NOT NULL)');
    expect(schema).toContain('idx_manufacturing_bom_lines_unique_subassembly');
    expect(schema).toContain('exactly ONE unit');
  });

  it('rejects cross-business references and cycles by output product across versions', () => {
    expect(schema).toContain('validate_manufacturing_bom_line');
    expect(schema).toContain('Sub-assembly BOM must belong to the same business');
    expect(schema).toContain('WITH RECURSIVE reachable(product_id, bom_id, path)');
    expect(schema).toContain('v_child_product_id = v_parent_product_id');
    expect(schema).toContain('BOM cycle detected: sub-assembly would create a circular reference');
    expect(schema).toContain('pg_advisory_xact_lock');
    expect(schema).toContain('public._manufacturing_bom_member(business_id)');
    expect(schema).toContain('public._manufacturing_bom_writer(business_id)');
  });

  it('saves and activates versions through authorized RPCs, archiving only on activation', () => {
    expect(commands).toContain('CREATE OR REPLACE FUNCTION public.save_bom_version(');
    expect(commands).toContain('p_business_id uuid');
    expect(commands).toContain('p_bom_id uuid');
    expect(commands).toContain('p_components jsonb');
    expect(commands).toContain("bu.role IN ('owner', 'admin', 'manager')");
    expect(commands).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_bom_new_version');
    expect(commands).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_bom_activate(p_bom_id uuid)');
    expect(commands).toContain('RETURNS void');
    expect(commands).toContain("SET status = 'archived'");
    expect(commands).toContain("SET status = 'active'");
    expect(commands).toContain('REVOKE ALL ON FUNCTION public.save_bom_version');
  });

  it('calculates nested material cost recursively per one output unit', () => {
    expect(commands).toContain('WITH RECURSIVE bom_walk');
    expect(commands).toContain('walk.multiplier * line.quantity * (1 + line.scrap_pct / 100)');
    expect(commands).toContain('line.component_bom_id IS NOT NULL');
    expect(commands).toContain('line.component_product_id IS NOT NULL');
  });

  it('freezes recursively exploded raw-material requirements when a work order is released', () => {
    expect(workOrder).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_release');
    expect(workOrder).toContain('WITH RECURSIVE bom_walk');
    expect(workOrder).toContain('material.quantity) * v_wo.planned_quantity');
    expect(workOrder).toContain('GROUP BY material.component_product_id');
    expect(workOrder).toContain('manufacturing_work_order_lines');
  });
});
