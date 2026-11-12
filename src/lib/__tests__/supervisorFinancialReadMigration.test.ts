import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = 'supabase/migrations/20261224000000_supervisor_financial_read_access.sql';
const SQL = readFileSync(MIGRATION_PATH, 'utf8');
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .toLowerCase();

const FINANCIAL_RLS = readFileSync(
  'supabase/migrations/20261218000000_role_aware_financial_rls.sql',
  'utf8',
).toLowerCase();

describe('supervisor financial read access migration', () => {
  it('adds supervisors to read authority without broadening write authority', () => {
    const readHelper = CODE.slice(
      CODE.indexOf('create or replace function public.can_read_financial_data'),
      CODE.indexOf('comment on function'),
    );
    expect(readHelper).toContain("'supervisor'");
    expect(readHelper).toContain('bu.is_active is true');
    expect(readHelper).toContain('up.is_platform_admin is true');
    expect(readHelper).toContain('if v_role is null then');
    expect(readHelper).toContain('return false');

    // The forward migration replaces only the read helper. The financial
    // write helper and its strict owner/admin/accountant role list stay intact.
    expect(CODE).not.toContain('create or replace function public.can_write_financial_data');
    const writeHelper = FINANCIAL_RLS.slice(
      FINANCIAL_RLS.indexOf('create or replace function public.can_write_financial_data'),
      FINANCIAL_RLS.indexOf('create or replace function public.can_write_sales_invoice_data'),
    );
    expect(writeHelper).toContain("return v_role in ('owner', 'admin', 'accountant')");
    expect(writeHelper).not.toContain("'supervisor'");
  });

  it('preserves branch-scoped invoice and expense RLS while enabling supervisor reads', () => {
    // Invoice and expense SELECT policies call this shared helper and retain
    // their existing branch predicates; no policy bypass is introduced.
    expect(FINANCIAL_RLS).toContain('public.can_read_financial_data(business_id)');
    expect(FINANCIAL_RLS).toContain('public.can_access_branch(business_id, branch_id)');
    expect(CODE).toContain('revoke all on function public.can_read_financial_data(uuid) from public, anon');
    expect(CODE).toContain(
      'grant execute on function public.can_read_financial_data(uuid) to authenticated, service_role',
    );
  });
});
