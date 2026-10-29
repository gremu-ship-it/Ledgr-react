import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20261125000000_payment_certificates.sql';
const migration = readFileSync(migrationPath, 'utf8');

describe('construction payment certificates migration', () => {
  it('uses the next migration timestamp and adds only the certificate table', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.split('_')[0])
      .sort();
    expect(versions.at(-1)).toBe('20261126000000');
    expect(migration.match(/CREATE TABLE IF NOT EXISTS public\./g)).toHaveLength(1);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.payment_certificates');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS public.project_valuations');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS public.project_valuation_items');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS public.retention_releases');
    expect(migration).not.toMatch(/ALTER TABLE public\.(project_valuations|project_valuation_lines|project_retention_ledger|construction_projects)/);
  });

  it('keeps the certificate gross amount period-based and reads only submitted or invoiced valuations', () => {
    const create = migration.split('CREATE OR REPLACE FUNCTION public.create_certificate_from_valuation')[1]
      .split('CREATE OR REPLACE FUNCTION public.issue_payment_certificate')[0];
    expect(create).toContain("v_valuation.status NOT IN ('submitted', 'invoiced')");
    expect(create).toContain('v_valuation.gross_amount');
    expect(create).toContain('v_valuation.retention_amount');
    expect(create).toContain('Retention percentage must match the amount withheld on this valuation');
    expect(create).toContain("WHERE c.valuation_id = p_valuation_id AND c.status <> 'cancelled'");
    expect(create).toContain('INSERT INTO public.payment_certificates');
    expect(create).not.toMatch(/UPDATE public\.project_valuations/);
    expect(create).not.toMatch(/UPDATE public\.project_retention_ledger/);
  });

  it('uses the existing project-retention ledger and construction actor policy', () => {
    expect(migration).toContain('public.project_retention_ledger');
    expect(migration).toContain('public._ledgr_project_valuation_actor(');
    expect(migration).toContain("ARRAY['procurement.master.manage']::text[]");
    expect(migration).toContain('public.is_business_member(p.business_id)');
    expect(migration).toContain('public.construction_procurement_capabilities_for(p.business_id)');
    expect(migration).toContain('REVOKE ALL ON public.payment_certificates FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT SELECT ON public.payment_certificates TO authenticated');
  });

  it('exposes command-only issue, payment and cancellation transitions', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.issue_payment_certificate');
    expect(migration).toContain("SET status = 'issued'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.record_payment_certificate_payment');
    expect(migration).toContain("'paid' ELSE 'partially_paid'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.cancel_payment_certificate');
    expect(migration).toContain("SET status = 'cancelled'");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_certificate_from_valuation');
  });
});
