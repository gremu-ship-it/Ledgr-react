import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261202000000_construction_quality_hse.sql',
  'utf8',
);

describe('Construction Quality and HSE migration contract', () => {
  it('creates all five tables with text evidence, checked statuses, and procurement-site references', () => {
    for (const table of [
      'construction_itps',
      'construction_itp_checkpoints',
      'construction_ncrs',
      'construction_hse_incidents',
      'construction_toolbox_talks',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    }
    expect(migration.match(/evidence_reference TEXT/g)).toHaveLength(5);
    expect(migration).toContain('REFERENCES public.construction_procurement_sites(id) ON DELETE SET NULL');
    expect(migration).not.toContain('REFERENCES public.construction_sites');
    expect(migration).toMatch(/status TEXT NOT NULL DEFAULT 'draft'[\s\S]*CHECK \(status IN \('draft', 'active', 'completed', 'cancelled'\)\)/);
    expect(migration).toContain("CHECK (status IN ('pending', 'passed', 'failed', 'waived'))");
    expect(migration).toContain("CHECK (severity IN ('near_miss', 'minor', 'major', 'critical', 'fatality'))");
    expect(migration).not.toMatch(/CREATE TYPE\s+public\./i);
  });

  it('enables membership RLS policies on every table', () => {
    for (const table of [
      'construction_itps',
      'construction_itp_checkpoints',
      'construction_ncrs',
      'construction_hse_incidents',
      'construction_toolbox_talks',
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration.match(/public\.is_business_member\(business_id\)/g)?.length).toBeGreaterThanOrEqual(15);
    expect(migration).toContain('public._construction_quality_hse_entitled(business_id)');
    expect(migration).toContain("public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'");
    expect(migration).toContain("'PROJECT_BASED' = ANY(COALESCE(b.operating_models, ARRAY[]::TEXT[]))");
  });

  it('defines membership-checked status RPCs as security definer with a fixed search path', () => {
    for (const functionName of ['transition_itp_status', 'transition_ncr_status', 'transition_hse_incident_status']) {
      const start = migration.indexOf(`FUNCTION public.${functionName}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const definition = migration.slice(start, migration.indexOf('$$;', start) + 3);
      expect(definition).toMatch(/SECURITY DEFINER/i);
      expect(definition).toMatch(/SET search_path = public/i);
      expect(definition).toContain('public.is_business_member(v_bid)');
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${functionName}`);
    }
  });
});
