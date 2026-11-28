import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '20270103000000_hospital_clinical_flow_radiology_telemedicine.sql';
const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', MIGRATION),
  'utf8',
);

describe('hospital clinical flow migration', () => {
  it('adds the queue, acuity, telemedicine and diagnostics columns to patient_visits', () => {
    for (const column of [
      'queue_token',
      'acuity_level',
      'meeting_url',
      'telemedicine_status',
      'telemedicine_started_at',
      'telemedicine_ended_at',
      'telemedicine_notes',
      'has_pending_lab',
      'has_pending_radiology',
      'has_pending_procedure',
      'results_ready_for_review',
      'results_ready_at',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it('widens visit_type and stage without dropping existing values', () => {
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS patient_visits_visit_type_check');
    expect(sql).toContain('ADD CONSTRAINT patient_visits_visit_type_check');
    for (const visitType of [
      'outpatient',
      'emergency',
      'follow_up',
      'routine_checkup',
      'in_person',
      'telemedicine',
      'home_visit',
    ]) {
      expect(sql).toContain(`'${visitType}'`);
    }

    expect(sql).toContain('DROP CONSTRAINT IF EXISTS patient_visits_stage_check');
    for (const stage of [
      'registered',
      'triaged',
      'with_doctor',
      'in_lab',
      'in_radiology',
      'in_diagnostics',
      'results_review',
      'at_pharmacy',
      'in_billing',
      'admitted',
      'completed',
      'cancelled',
    ]) {
      expect(sql).toContain(`'${stage}'`);
    }
  });

  it('defines the four acuity levels and telemedicine lifecycle', () => {
    for (const acuity of ['emergency', 'urgent', 'priority', 'routine']) {
      expect(sql).toContain(`'${acuity}'`);
    }
    for (const status of ['waiting', 'link_sent', 'in_call', 'completed', 'cancelled']) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).toContain('patient_visits_acuity_level_check');
    expect(sql).toContain('patient_visits_telemedicine_status_check');
  });

  it('creates tenant-scoped radiology and procedure tables with RLS', () => {
    for (const table of [
      'radiology_orders',
      'radiology_order_items',
      'clinical_procedure_orders',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`POLICY "${table}_select"`);
      expect(sql).toContain(`POLICY "${table}_write"`);
    }
    expect(
      sql.match(/business_id uuid NOT NULL REFERENCES public\.businesses\(id\)/gi),
    ).toHaveLength(3);
    expect(sql.match(/public\.can_read_financial_data\(business_id\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/public\.can_write_financial_data\(business_id\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('supports every imaging modality and the Q-NNN / RAD-YYYY-XXXX numbering rules', () => {
    for (const modality of ['xray', 'ultrasound', 'ct', 'mri', 'ecg', 'echo', 'mammography', 'other']) {
      expect(sql).toContain(`'${modality}'`);
    }
    expect(sql).toContain('uq_patient_visits_queue_token');
    expect(sql).toContain('(business_id, visit_date, queue_token)');
    expect(sql).toContain('uq_radiology_orders_business_number');
    expect(sql).toContain('idx_patient_visits_results_review');
    expect(sql).toContain('idx_patient_visits_telemedicine');
  });
});
