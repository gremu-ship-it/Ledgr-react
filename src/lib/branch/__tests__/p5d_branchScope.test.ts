// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(__dirname, '../../../..', path), 'utf8');

describe('P5-D DEC-03 branch scope remediation', () => {
  it('1. can_access_branch is DEC-03 authoritative (org-wide 5, assigned 8 fail-closed, legacy for others)', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    // Org-wide 5
    expect(sql).toContain("'owner','admin','manager','accountant','auditor'");
    // Assigned 8
    expect(sql).toContain("'cashier','stock_clerk','branch_manager','sales_clerk','sales_manager'");
    expect(sql).toContain("'purchasing_officer','warehouse_worker','customer_service_rep'");
    // Fail closed: assigned requires branch_id is not null and = p_branch_id
    expect(sql).toContain('and bu.branch_id is not null');
    expect(sql).toContain('and bu.branch_id = p_branch_id');
    // Legacy for unlisted roles: branch_id is null or =
    expect(sql).toContain('bu.role::text not in (');
    expect(sql).toContain('bu.branch_id is null or bu.branch_id = p_branch_id');
    // Comment mentions DEC-03
    expect(sql).toContain('DEC-03 matrix');
  });

  it('2. can_access_location helper exists and delegates to can_access_branch via inventory_locations', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    expect(sql).toContain('create or replace function public.can_access_location');
    expect(sql).toContain('inventory_locations where id = p_location_id');
    expect(sql).toContain('can_access_branch');
  });

  it('3. save_quick_* RPCs validate branch scope server-side (DEC-03, caller branch never trusted)', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    // Both RPCs check can_access_branch
    expect(sql).toContain('save_quick_expense');
    expect(sql).toContain('save_quick_sale');
    expect(sql).toContain('can_access_branch(v_business_id, v_branch_id)');
    // Assigned-scope with NULL branch is denied (fail closed)
    expect(sql).toContain('assigned-scope requires branch');
    expect(sql).toContain("using errcode = '42501'");
    // Stock location branch check
    expect(sql).toContain('can_access_location');
  });

  it('4. RLS branch enforcement on core direct-branch tables (invoices, expenses, journals, inventory_locations, departments, branches, employees, fixed_assets, accounts, budget_lines)', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    // Invoices
    expect(sql).toContain('create policy invoices_member_read');
    expect(sql).toContain('can_access_branch(business_id, branch_id)');
    expect(sql).toContain('can_write_sales_data');
    // Expenses
    expect(sql).toContain('expenses_member_read');
    expect(sql).toContain('can_write_expense_data');
    // Journal entries
    expect(sql).toContain('journal_entries_member_read');
    // Inventory locations
    expect(sql).toContain('inventory_locations_member_read');
    // Departments
    expect(sql).toContain('departments_member_read');
    // Branches: id is branch
    expect(sql).toContain('branches_member_read');
    expect(sql).toContain('can_access_branch(business_id, id)');
    // Branches writer is admin only (cross-branch-admin sealed)
    expect(sql).toContain('branches_writer_insert');
    expect(sql).toContain('can_admin_business_data');
    // Employees
    expect(sql).toContain('employees_member_read');
    // Fixed assets
    expect(sql).toContain('fixed_assets_member_read');
    // Accounts (nullable branch)
    expect(sql).toContain('accounts_member_read');
    expect(sql).toContain('branch_id is null or public.can_access_branch');
    // Budget lines
    expect(sql).toContain('budget_lines_member_read');

    // Child tables via parent branch
    expect(sql).toContain('invoice_lines_member_read');
    expect(sql).toContain('select branch_id from public.invoices where id = invoice_id');
    expect(sql).toContain('expense_lines_member_read');
    expect(sql).toContain('select branch_id from public.expenses where id = expense_id');
    expect(sql).toContain('journal_lines_member_read');
  });

  it('5. Location-derived tables enforce via can_access_location (stock_movements, inventory_balances, stock_transfers)', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    expect(sql).toContain('stock_movements_member_read');
    expect(sql).toContain('can_access_location(business_id, location_id)');
    expect(sql).toContain('inventory_balances_member_read');
    expect(sql).toContain('stock_transfers_member_read');
    expect(sql).toContain('from_location_id');
    expect(sql).toContain('to_location_id');
    expect(sql).toContain('stock_transfer_lines_member_read');
  });

  it('6. RLS still has platform_admin read and admin_delete (no regression)', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    expect(sql).toContain('platform_admin_read');
    expect(sql).toContain('admin_delete');
    expect(sql).toContain('is_platform_admin');
  });

  it('7. POS family remains branch-scoped (no policy rewrite needed, predicate updated)', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    expect(sql).toContain('POS family already branch-scoped');
    // Original R08 predicate still exists in earlier migration
    const r08 = source('supabase/migrations/20260930000000_r08_till_context.sql');
    expect(r08).toContain('can_access_branch');
    expect(r08).toContain('open_pos_shift_command');
  });

  it('8. Sanity guard ensures every hardened table has a policy', () => {
    const sql = source('supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql');
    expect(sql).toContain('P5-D RLS incomplete');
    expect(sql).toContain("array['invoices','expenses','journal_entries'");
  });
});
