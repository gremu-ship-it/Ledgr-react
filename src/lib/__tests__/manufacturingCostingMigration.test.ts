import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261227000000_manufacturing_costing_engine.sql',
  'utf8',
);

describe('manufacturing costing migration', () => {
  it('creates the cost sheet table with the financial cost, pricing and breakdown columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_cost_sheets');
    for (const column of [
      'business_id', 'product_id', 'bom_id', 'material_cost_unit', 'labor_cost_unit',
      'overhead_cost_unit', 'total_unit_cost', 'pricing_strategy', 'target_margin_pct',
      'target_markup_pct', 'recommended_price', 'current_catalog_price', 'cost_breakdown',
    ]) {
      expect(sql, `column ${column}`).toContain(column);
    }
  });

  it('indexes by business and product, enables RLS and defines all four policies', () => {
    expect(sql).toMatch(/CREATE INDEX[\s\S]*manufacturing_cost_sheets\(business_id, product_id\)/);
    expect(sql).toContain('ALTER TABLE public.manufacturing_cost_sheets ENABLE ROW LEVEL SECURITY');
    for (const command of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(sql, `${command} policy`).toMatch(
        new RegExp(`CREATE POLICY[\\s\\S]*FOR ${command}[\\s\\S]*public\\.can_(read|write)_financial_data\\(business_id\\)`),
      );
    }
  });

  it('keeps the catalog and POS selling price columns in sync', () => {
    expect(sql).toContain('ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_price');
    expect(sql).toContain('trg_products_sale_unit_price_sync');
  });
});
