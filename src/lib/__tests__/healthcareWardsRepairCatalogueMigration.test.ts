import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '20270104000000_healthcare_wards_repair_and_catalogue.sql';
const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', MIGRATION),
  'utf8',
);

describe('healthcare wards repair and catalogue migration', () => {
  it('is additive and never drops a tenant table', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('repairs the legacy hospital_beds columns the ward board selects', () => {
    for (const column of ['hourly_rate', 'amenities', 'current_admission_id']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(sql).toContain('ALTER COLUMN bed_type DROP NOT NULL');
    expect(sql).toContain("SET status = 'cleaning'");
    expect(sql).toContain('ck_bed_occupancy_state');
  });

  it('creates the missing ADT tables and their tenant guards', () => {
    for (const table of ['patient_admissions', 'bed_allocations', 'inpatient_care_logs']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`POLICY "${table}_select"`);
      expect(sql).toContain(`POLICY "${table}_modify"`);
    }
    expect(sql).toContain('fk_bed_current_admission');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.next_admission_number');
    expect(sql).toContain('pg_advisory_xact_lock');
  });

  it('replaces the legacy blanket ward/bed policies with financial RLS', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "tenant_isolation_hospital_wards"');
    expect(sql).toContain('DROP POLICY IF EXISTS "tenant_isolation_hospital_beds"');
    expect(sql).toContain('public.can_read_financial_data(business_id)');
    expect(sql).toContain('public.can_write_financial_data(business_id)');
  });

  it('extends accommodation claims and the healthcare product vocabulary', () => {
    expect(sql).toContain('bed_daily_cap');
    expect(sql).toContain('room_upgrade_charge_to_patient');
    expect(sql).toContain("'accommodation'");

    for (const column of [
      'healthcare_item_type',
      'is_dispensable',
      'strength',
      'dosage_form',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    for (const kind of ['drug', 'supply', 'service', 'product']) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(sql).toContain('idx_products_healthcare_catalogue');
  });
});
