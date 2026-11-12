import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = 'supabase/migrations/20261218000000_role_aware_financial_rls.sql';
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Remove comments before assertions so documentation cannot satisfy a contract.
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .toLowerCase();

const policyBlock = (name: string) => {
  const start = CODE.indexOf(`create policy ${name.toLowerCase()}`);
  if (start < 0) return '';
  const end = CODE.indexOf('create policy ', start + 1);
  return CODE.slice(start, end < 0 ? undefined : end);
};

const operations = ['read', 'insert', 'update', 'delete'] as const;
const financialTables = [
  'journal_entries',
  'journal_lines',
  'budgets',
  'budget_lines',
  'bank_statements',
  'bank_statement_lines',
  'fx_revaluations',
  'expenses',
  'expense_lines',
  'expense_payments',
] as const;

describe('role-aware financial RLS migration contract', () => {
  it('uses the requested replay-safe migration and current membership schema', () => {
    expect(MIGRATION_PATH).toBe('supabase/migrations/20261218000000_role_aware_financial_rls.sql');
    expect(CODE).toContain('create or replace function public.can_read_financial_data(p_business_id uuid)');
    expect(CODE).toContain('create or replace function public.can_write_financial_data(p_business_id uuid)');
    expect(CODE).toContain('set search_path = public');
    expect(CODE).toContain('bu.is_active is true');
    expect(CODE).not.toMatch(/bu\.status\s*=\s*'active'/);
    expect(CODE).toContain('drop policy if exists');
    expect(CODE).toContain('from pg_policies');
    expect(CODE).toContain('alter view if exists public.v_trial_balance set (security_invoker = true)');
    expect(CODE).toContain('alter view if exists public.v_ar_ageing set (security_invoker = true)');
  });

  it('pins the read and write helpers to the specified roles and platform-admin override', () => {
    const read = CODE.slice(
      CODE.indexOf('create or replace function public.can_read_financial_data'),
      CODE.indexOf('create or replace function public.can_write_financial_data'),
    );
    const write = CODE.slice(
      CODE.indexOf('create or replace function public.can_write_financial_data'),
      CODE.indexOf('create or replace function public.can_write_sales_invoice_data'),
    );

    for (const helper of [read, write]) {
      expect(helper).toContain('security definer');
      expect(helper).toContain('stable');
      expect(helper).toContain('up.id = v_user_id');
      expect(helper).toContain('up.is_platform_admin is true');
      expect(helper).toContain('bu.user_id = v_user_id');
      expect(helper).toContain('bu.is_active is true');
      expect(helper).toContain('if v_role is null then');
      expect(helper).toContain('return false');
    }

    for (const role of ['owner', 'admin', 'accountant', 'auditor', 'payroll_manager', 'manager', 'board_member']) {
      expect(read).toContain(`'${role}'`);
    }
    for (const role of ['owner', 'admin', 'accountant']) {
      expect(write).toContain(`'${role}'`);
    }
    for (const role of ['cashier', 'stock_clerk', 'warehouse_worker', 'inventory_manager', 'asset_manager']) {
      expect(write).not.toContain(`'${role}'`);
    }
  });

  it('clears prior permissive policy sets before installing the role-bound policies', () => {
    for (const table of [
      ...financialTables,
      'invoices', 'invoice_lines', 'invoice_payments',
    ]) {
      expect(CODE).toContain(`'${table}'`);
      expect(CODE).toContain("where schemaname = 'public'");
      expect(CODE).toContain('execute format(\n        \'drop policy if exists %i on public.%i\'');
    }
    expect(CODE).toContain('alter table public.%i enable row level security');
    expect(CODE).toContain('revoke all on table public.%i from public, anon');
    expect(CODE).toContain('grant select, insert, update, delete on table public.%i to authenticated');
    expect(CODE).toContain('grant all on table public.%i to service_role');
  });

  it('binds every general-ledger, budget, bank-statement, FX and expense operation to financial helpers', () => {
    const expectedTables = [
      'budgets', 'budget_lines', 'bank_statements', 'bank_statement_lines',
      'fx_revaluations', 'expenses', 'expense_lines', 'expense_payments',
    ];

    for (const table of expectedTables) {
      for (const operation of operations) {
        const block = policyBlock(`${table}_financial_${operation}`);
        expect(block, `${table} ${operation} policy exists`).not.toBe('');
        expect(block, `${table} ${operation} policy has authenticated role`).toContain('to authenticated');
        expect(block, `${table} ${operation} policy checks financial authority`).toContain(
          operation === 'read' ? 'can_read_financial_data' : 'can_write_financial_data',
        );
        expect(block, `${table} ${operation} policy has no generic member bypass`).not.toContain(
          'is_business_member',
        );
        expect(block, `${table} ${operation} policy has no generic write bypass`).not.toContain(
          'can_write_business_data',
        );
      }
    }
  });

  it('keeps journal DML command-only while still applying financial-role reads', () => {
    for (const table of ['journal_entries', 'journal_lines']) {
      expect(policyBlock(`${table}_financial_read`)).toContain('can_read_financial_data');
      for (const operation of ['insert', 'update', 'delete'] as const) {
        const block = policyBlock(`${table}_command_${operation}`);
        expect(block, `${table} ${operation} stays command-only`).not.toBe('');
        expect(block).toContain('to authenticated');
        expect(block).toContain('false');
        expect(block).not.toContain('can_write_financial_data');
      }
    }
  });

  it('keeps cashier sales-invoice access separate from ledger, budgets and expenses', () => {
    const invoiceWrite = policyBlock('invoices_financial_or_sales_insert');
    expect(invoiceWrite).toContain('can_write_financial_data');
    expect(invoiceWrite).toContain('can_write_sales_invoice_data');
    expect(invoiceWrite).toContain("invoice_type in ('invoice', 'sales')");

    const salesHelper = CODE.slice(
      CODE.indexOf('create or replace function public.can_write_sales_invoice_data'),
      CODE.indexOf('revoke all on function public.can_read_financial_data'),
    );
    expect(salesHelper).toContain("'cashier'");
    expect(salesHelper).toContain("'sales_clerk'");

    for (const table of ['journal_entries', 'journal_lines', 'budgets', 'budget_lines', 'expenses']) {
      for (const operation of operations) {
        expect(policyBlock(`${table}_financial_${operation}`)).not.toContain(
          'can_write_sales_invoice_data',
        );
      }
    }
  });

  it('keeps child records attached to same-business parents and retains branch checks', () => {
    for (const [table, parent, fk] of [
      ['journal_lines', 'journal_entries', 'journal_entry_id'],
      ['budget_lines', 'budgets', 'budget_id'],
      ['bank_statement_lines', 'bank_statements', 'statement_id'],
      ['invoice_lines', 'invoices', 'invoice_id'],
      ['invoice_payments', 'invoices', 'invoice_id'],
      ['expense_lines', 'expenses', 'expense_id'],
      ['expense_payments', 'expenses', 'expense_id'],
    ] as const) {
      const source = CODE.slice(CODE.indexOf(`create policy ${table}_`), CODE.indexOf('-- ──', CODE.indexOf(`create policy ${table}_`)) < 0 ? undefined : CODE.indexOf('-- ──', CODE.indexOf(`create policy ${table}_`)));
      expect(source).toContain(`from public.${parent}`);
      expect(source).toContain(`.${fk}`);
      expect(source).toContain('.business_id');
    }

    expect(policyBlock('journal_entries_financial_read')).toContain('can_access_branch');
    expect(policyBlock('expenses_financial_read')).toContain('can_access_branch');
    expect(policyBlock('budget_lines_financial_read')).toContain('can_access_branch');
  });
});
