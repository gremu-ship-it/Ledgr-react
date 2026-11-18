import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATION_PATH =
  'supabase/migrations/20261225000000_restore_supervisor_transaction_visibility.sql';
const SQL = readFileSync(MIGRATION_PATH, 'utf8');
// Documentation must never satisfy a contract: assert on code only.
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .toLowerCase();

const readHelper = () => CODE.slice(
  CODE.indexOf('create or replace function public.can_read_financial_data'),
  CODE.indexOf('comment on function'),
);

describe('supervisor transaction visibility migration', () => {
  it('is a forward-only read-tier migration that never touches write authority', () => {
    expect(CODE).toContain('create or replace function public.can_read_financial_data(p_business_id uuid)');
    // Write authority is untouched: supervisors gain visibility, not the ledger.
    // (The helper is named in the function COMMENT; what must not appear is a
    // redefinition of it.)
    expect(CODE).not.toContain('create or replace function public.can_write_financial_data');
    expect(CODE).not.toContain('create or replace function public.can_write_sales_invoice_data');
    expect(CODE).not.toContain('create policy');
    expect(CODE).not.toContain('create table');
  });

  it('keys membership on business_users.is_active, the column this schema has', () => {
    const helper = readHelper();
    // `business_users` has no `status` column; a helper written against
    // `status = 'active'` fails at replay and takes every financial read policy
    // down with it, so both spellings are rejected here.
    expect(helper).toContain('bu.is_active is true');
    expect(helper).not.toMatch(/bu\.status\s*=/);
    expect(helper).not.toMatch(/\bstatus\s*=\s*'active'/);
  });

  it('derives identity from the JWT and fails closed for anonymous and non-members', () => {
    const helper = readHelper();
    expect(helper).toContain('security definer');
    expect(helper).toContain('stable');
    expect(helper).toContain('set search_path = public');
    expect(helper).toContain('v_user_id uuid := auth.uid()');
    expect(helper).toContain('if v_user_id is null or p_business_id is null then');
    expect(helper).toContain('up.id = v_user_id');
    expect(helper).toContain('up.is_platform_admin is true');
    expect(helper).toContain('bu.business_id = p_business_id');
    expect(helper).toContain('bu.user_id = v_user_id');
    expect(helper).toContain('if v_role is null then');
  });

  it('includes supervisors in the read tier without admitting operational roles', () => {
    const helper = readHelper();
    for (const role of [
      'owner', 'admin', 'accountant', 'auditor', 'payroll_manager',
      'manager', 'board_member', 'supervisor', 'site_supervisor',
    ]) {
      expect(helper, `read tier must include ${role}`).toContain(`'${role}'`);
    }
    for (const role of ['cashier', 'stock_clerk', 'sales_clerk', 'data_entry', 'warehouse_worker']) {
      expect(helper, `read tier must exclude ${role}`).not.toContain(`'${role}'`);
    }
  });

  it('re-issues the function grants so anon and PUBLIC stay closed', () => {
    expect(CODE).toContain('revoke all on function public.can_read_financial_data(uuid) from public, anon');
    expect(CODE).toContain(
      'grant execute on function public.can_read_financial_data(uuid) to authenticated, service_role',
    );
  });
});
