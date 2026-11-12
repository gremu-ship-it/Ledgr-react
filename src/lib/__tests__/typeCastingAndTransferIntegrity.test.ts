import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20261224000004_fix_type_casting_and_transfer_integrity.sql');
const lowerMigration = migration.toLowerCase();
const payroll = read('supabase/migrations/20261206000000_payroll_full_cycle.sql');
const payrollTypeFix = read('supabase/migrations/20261223000000_fix_demo_seed_source_id_uuid_types.sql');
const schema = read('supabase/migrations/20250101000000_base_schema.sql');
const profitLoss = read('supabase/migrations/20261130000001_profit_loss_exclude_reversal_pairs.sql');
const budgetRepository = read('src/dal/repositories/BudgetRepository.ts');
const constructionProcurement = read('supabase/migrations/20261021000000_construction_procurement_traceability.sql');
const projectBoq = read('supabase/migrations/20261030000000_construction_project_boq.sql');
const valuations = read('supabase/migrations/20261031000001_construction_progress_valuations.sql');
const manufacturing = read('supabase/migrations/20261219000000_manufacturing_entitlement_and_partner_projection.sql');
const posCommands = read('supabase/migrations/20261014000001_live_uuid_shape_pos_commands.sql');
const posReturns = read('supabase/migrations/20261210000001_pos_return_command.sql');

const functionBody = (name: string) => {
  const start = lowerMigration.search(new RegExp(`create(?: or replace)? function public\\.${name.toLowerCase()}\\b`));
  expect(start, `function ${name} should be in the fix migration`).toBeGreaterThanOrEqual(0);
  const bodyStart = lowerMigration.indexOf('as $$', start);
  const bodyEnd = lowerMigration.indexOf('$$;', bodyStart);
  expect(bodyStart).toBeGreaterThanOrEqual(start);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return lowerMigration.slice(start, bodyEnd + 3);
};

describe('UUID/TEXT type casting and transfer integrity contract', () => {
  it('keeps transfer JSON IDs UUID-typed and validates both source and destination access', () => {
    const dispatch = functionBody('dispatch_stock_transfer_atomically');
    const receipt = functionBody('confirm_stock_transfer_receipt_atomically');

    expect(dispatch).toContain('source_id::text = p_transfer_id::text');
    expect(dispatch).toContain("nullif(line->>'line_id', '')::uuid");
    expect(dispatch).toContain('public.can_access_location(v_transfer.business_id, v_transfer.from_location_id)');
    expect(dispatch).toContain('public.can_access_location(v_transfer.business_id, v_transfer.to_location_id)');
    expect(dispatch).toContain('if v_uuid_columns then');
    expect(dispatch).not.toContain('source_id = p_transfer_id::text');

    expect(receipt).toContain("nullif(line->>'line_id', '')::uuid");
    expect(receipt).toContain('public.can_access_location(v_transfer.business_id, v_transfer.from_location_id)');
    expect(receipt).toContain('public.can_access_location(v_transfer.business_id, v_transfer.to_location_id)');
    expect(receipt).toContain("received_by = nullif(v_actor, '')::uuid");
    expect(receipt).not.toMatch(/source_id\s*=\s*p_transfer_id::text/);
  });

  it('casts legacy inventory backfill source comparisons on both UUID and TEXT schemas', () => {
    const backfill = functionBody('backfill_and_recalculate_inventory');
    expect(lowerMigration.indexOf('drop function if exists public.backfill_and_recalculate_inventory(uuid)'))
      .toBeLessThan(lowerMigration.indexOf('create function public.backfill_and_recalculate_inventory'));
    expect(backfill).toContain('sm.source_id::text = e.id::text');
    expect(backfill).toContain('sm.source_id::text = i.id::text');
    expect(backfill).not.toMatch(/sm\.source_id\s*=\s*[ei]\.id\b/);
  });

  it('casts JSONB UUID fields or declares UUID recordset columns in active command RPCs', () => {
    expect(constructionProcurement).toContain("public._ledgr_construction_uuid(v_line->>'po_line_id'");
    expect(constructionProcurement).toContain("public._ledgr_construction_uuid(p_payload->>'po_id'");
    expect(projectBoq).toContain("v_id:=nullif(v->>'id','')::uuid");
    expect(valuations).toContain("v_line_id := nullif(v_item->>'boq_line_id', '')::uuid");
    expect(manufacturing).toContain('AS d(product_id uuid, quantity numeric, required_date date)');
    expect(manufacturing).toContain('p_run_id uuid');
    expect(posCommands).toContain("v_shift_id := (p_payload->>'shift_id')::uuid");
    expect(posReturns).toContain("il.id = (v_refund_line->>'invoice_line_id')::uuid");
  });

  it('scopes stock-transfer-line RLS joins by UUID parent ID and matching business', () => {
    expect(lowerMigration).toContain('t.id = stock_transfer_lines.transfer_id');
    expect(lowerMigration).toContain('t.business_id = stock_transfer_lines.business_id');
    expect(lowerMigration).toContain('public.can_access_location(t.business_id, t.from_location_id)');
    expect(lowerMigration).toContain('public.can_access_location(t.business_id, t.to_location_id)');
  });

  it('makes payroll reversal idempotent and marks both source records reversed', () => {
    const reverse = functionBody('reverse_pay_run');
    expect(reverse).toContain("v_run.status::text = 'reversed'");
    expect(reverse).toContain('this pay run has already been reversed.');
    expect(reverse).toContain('p_pay_run_id::text');
    expect(reverse).toContain("set status = 'reversed', reversed_by = v_reversal_je_id");
    expect(reverse).toContain("set status = 'reversed', reversal_journal_entry_id = v_reversal_je_id");
    expect(reverse).toContain('auth.uid()');
    expect(reverse).toContain('v_original_je.reversal_of is not null');
  });

  it('preserves the source ID type and refuses duplicate cash-deposit reversals', () => {
    const voidDeposit = functionBody('void_cash_deposit');
    expect(voidDeposit).toContain('this cash deposit has already been voided.');
    expect(voidDeposit).toContain('v_original.source_id');
    expect(voidDeposit).toContain('v_original.reversed_by is not null');
    expect(voidDeposit).toContain('v_original.reversal_of is not null');
    expect(voidDeposit).toContain('v_actor := auth.uid()');
    expect(voidDeposit).toContain("set status = 'reversed', reversed_by = v_reversal_id");
  });

  it('excludes both reversed originals and reversal entries from P&L and budget actuals', () => {
    expect(profitLoss).toMatch(/je\.status::text\s*=\s*'reversed'\s+or\s+je\.reversal_of\s+is\s+not\s+null/i);
    expect(budgetRepository).toContain(".neq('journal_entries.status', 'reversed')");
    expect(budgetRepository).toContain(".is('journal_entries.reversal_of', null)");
  });

  it('keeps nullable employee department/bank details out of required UUID payroll links', () => {
    expect(schema).toMatch(/department_id uuid\s*-- \[EVIDENCED\] FK/);
    expect(schema).toMatch(/bank_account_number text\s*-- \[CONVENTION\]/);
    expect(payroll).toMatch(/employee_id uuid NOT NULL/);
    expect(payroll).toMatch(/INSERT INTO public\.pay_run_lines \([\s\S]*?employee_id[\s\S]*?\) VALUES \([\s\S]*?v_employee\.id/);
    expect(payroll).toMatch(/CREATE OR REPLACE FUNCTION public\.accrue_leave\([\s\S]*?SELECT e\.id FROM public\.employees/);
    // Payroll posts to a company GL cash account, not an employee bank FK; it
    // fails early with an actionable setup error if that ledger account is absent.
    expect(payrollTypeFix).toMatch(/IF v_bank_account_id IS NULL THEN\s+RAISE EXCEPTION 'Link an active bank account before posting payroll\.'/);
    expect(payrollTypeFix).toMatch(/'payroll', v_run\.id, v_business\.base_currency, 1, 'draft', auth\.uid\(\)/);
  });
});
