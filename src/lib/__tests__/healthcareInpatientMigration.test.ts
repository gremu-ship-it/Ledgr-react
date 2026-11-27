import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '20270102000000_healthcare_inpatient_and_wards.sql';
const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', MIGRATION),
  'utf8',
);

describe('healthcare inpatient migration', () => {
  it('creates the five tenant-scoped ADT tables', () => {
    for (const table of [
      'hospital_wards',
      'hospital_beds',
      'patient_admissions',
      'bed_allocations',
      'inpatient_care_logs',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql.match(/business_id UUID NOT NULL REFERENCES public\.businesses\(id\)/g)).toHaveLength(
      5,
    );
  });

  it('wires the circular bed current-admission reference safely', () => {
    expect(sql).toContain('FOREIGN KEY (current_admission_id)');
    expect(sql).toContain('REFERENCES public.patient_admissions(id) ON DELETE SET NULL');
    expect(sql).toContain('ck_bed_occupancy_state');
    expect(sql).toContain("(status = 'occupied') = (current_admission_id IS NOT NULL)");
  });

  it('defines every bed, admission, discharge and care-log state', () => {
    for (const status of ['available', 'occupied', 'cleaning', 'maintenance', 'reserved']) {
      expect(sql).toContain(`'${status}'`);
    }
    for (const status of ['admitted', 'discharged', 'transferred', 'cancelled']) {
      expect(sql).toContain(`'${status}'`);
    }
    for (const condition of [
      'recovered',
      'improved',
      'stable',
      'referred',
      'discharged_against_medical_advice',
      'deceased',
    ]) {
      expect(sql).toContain(`'${condition}'`);
    }
    for (const logType of [
      'doctor_round',
      'nurse_note',
      'dietary',
      'physiotherapy',
      'incident',
    ]) {
      expect(sql).toContain(`'${logType}'`);
    }
  });

  it('adds the requested indexes and one open allocation per admission', () => {
    for (const index of [
      'idx_beds_ward',
      'idx_admissions_patient',
      'idx_allocations_admission',
      'idx_care_logs_admission',
    ]) {
      expect(sql).toContain(index);
    }
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_active_bed_allocation');
    expect(sql).toContain('WHERE released_at IS NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_active_patient_admission');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_bed_current_admission');
  });

  it('publishes select and modify policies on every table', () => {
    for (const table of [
      'hospital_wards',
      'hospital_beds',
      'patient_admissions',
      'bed_allocations',
      'inpatient_care_logs',
    ]) {
      expect(sql).toContain(`POLICY "${table}_select"`);
      expect(sql).toContain(`POLICY "${table}_modify"`);
    }
    expect(sql.match(/public\.can_read_financial_data\(business_id\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql.match(/public\.can_write_financial_data\(business_id\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.next_admission_number(uuid) FROM PUBLIC');
  });

  it('extends payer accommodation policy and the claim category', () => {
    expect(sql).toContain('bed_daily_cap NUMERIC(12,2)');
    expect(sql).toContain('room_upgrade_charge_to_patient BOOLEAN NOT NULL DEFAULT true');
    expect(sql).toContain("'accommodation'");
    expect(sql).toContain('insurance_claim_items_service_category_check');
  });

  it('allocates ADM-YYYY-NNNN under an advisory lock', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.next_admission_number');
    expect(sql).toContain("v_prefix text := 'ADM-'");
    expect(sql).toContain('pg_advisory_xact_lock');
  });
});
