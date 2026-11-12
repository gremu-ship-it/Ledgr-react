import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../../supabase/migrations/20261223000000_fix_demo_seed_source_id_uuid_types.sql');
const sql = readFileSync(migrationPath, 'utf8');

describe('demo seeder source_id UUID migration', () => {
  it('posts cash-deposit journal rows with native UUID source and actor values', () => {
    expect(sql).toMatch(/'cash_deposit',\s*p_deposit_id,/);
    expect(sql).not.toMatch(/'cash_deposit',\s*p_deposit_id::text/);
    expect(sql).toMatch(/v_actor text;/);
    expect(sql).toMatch(/v_actor := auth\.uid\(\)::text;/);
    expect(sql).toMatch(/v_currency, 1, 'posted', v_actor::uuid, v_actor::uuid, now\(\)/);
  });

  it('posts manufacturing stock movements with the UUID source id', () => {
    expect(sql).toMatch(/p_source_type,\s*p_source_id,\s*p_reference,\s*p_actor/);
    expect(sql).not.toMatch(/p_source_type,\s*p_source_id::text/);
  });

  it('posts payroll journals with UUID source and actor fields', () => {
    expect(sql).toMatch(/v_run\.id::text,\s*'payroll',\s*v_run\.id,\s*v_business\.base_currency/);
    expect(sql).toMatch(/created_by\s*\)\s*VALUES\s*\([\s\S]*?auth\.uid\(\)\s*\)/i);
    expect(sql).toMatch(/posted_by = auth\.uid\(\)/);
    expect(sql).not.toMatch(/'payroll',\s*v_run\.id::text/);
  });
});
