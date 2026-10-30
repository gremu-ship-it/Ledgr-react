import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20261124000000_manufacturing_mrp.sql';
const migration = readFileSync(migrationPath, 'utf8');

describe('manufacturing MRP migration', () => {
  it('adds only the run and recommendation tables after the existing manufacturing history', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.split('_')[0])
      .sort();
    expect(versions.at(-1)).toBe('20261128000000');
    expect(migration.match(/CREATE TABLE IF NOT EXISTS public\.manufacturing_mrp_/g)).toHaveLength(2);
    expect(migration).toContain('public.manufacturing_mrp_runs');
    expect(migration).toContain('public.manufacturing_mrp_recommendations');
    expect(migration).not.toMatch(/ALTER TABLE public\.(manufacturing_boms|manufacturing_bom_lines|manufacturing_work_orders|manufacturing_work_order_lines|routings|work_centres|manufacturing_production_runs)/);
    expect(migration).not.toMatch(/ALTER TABLE public\.construction_/);
  });

  it('time-phases input and outstanding production demand, then nets inventory and active work orders', () => {
    expect(migration).toContain('p_horizon_start date');
    expect(migration).toContain('p_horizon_end date');
    expect(migration).toContain('p_demand_inputs jsonb');
    expect(migration).toContain("wo.status IN ('released', 'in_progress')");
    expect(migration).toContain('wol.planned_quantity - wol.actual_quantity_consumed');
    expect(migration).toContain('wo.planned_quantity - wo.completed_quantity');
    expect(migration).toContain('GREATEST(0, b.quantity_on_hand - b.quantity_reserved)');
    expect(migration).toContain('s.supply_date <= v_need_date');
    expect(migration).toContain('approved_supply_quantity');
  });

  it('explodes per-unit BOM quantities with scrap and never creates orders during a run', () => {
    const runFunction = migration.split('CREATE OR REPLACE FUNCTION public.run_mrp')[1]
      .split('CREATE OR REPLACE FUNCTION public.convert_mrp_recommendation')[0];
    expect(runFunction).toContain('line.quantity * (1 + line.scrap_pct / 100)');
    expect(runFunction).toContain('round(v_net * line.quantity');
    expect(runFunction).toContain('v_group.depth > 20');
    expect(runFunction).toContain("CASE WHEN v_bom_id IS NULL THEN 'buy' ELSE 'make' END");
    expect(runFunction).not.toContain('create_work_order_from_bom');
  });

  it('converts only an open make suggestion through the existing work-order RPC', () => {
    const conversion = migration.split('CREATE OR REPLACE FUNCTION public.convert_mrp_recommendation')[1];
    expect(conversion).toContain("v_rec.recommendation_type <> 'make' OR v_rec.status <> 'open'");
    expect(conversion).toContain("b.status = 'active'");
    expect(conversion).toContain('public.create_work_order_from_bom(');
    expect(conversion).toContain("SET status = 'converted', converted_work_order_id = v_work_order_id");
  });

  it('scopes reads and writes to existing manufacturing membership and role checks', () => {
    expect(migration).toContain('public._manufacturing_bom_member(business_id)');
    expect(migration).toContain('public._manufacturing_bom_writer(business_id)');
    expect(migration).toContain("public._mfg_wo_writer(p_business_id, 'run MRP')");
    expect(migration).toContain("public._mfg_wo_writer(v_rec.business_id, 'convert an MRP recommendation')");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.run_mrp');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.convert_mrp_recommendation');
  });
});
