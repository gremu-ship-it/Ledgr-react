// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(__dirname, '../../../..', path), 'utf8');

describe('P5-C Q12/Q13 uniform authoritative P0QLT + dual authority', () => {
  // ── §5.2.1 Billing month / counting semantics ────────────────────────────
  it('1. authoritative count is invoices(issue_date) + expenses(expense_date) + payroll_runs(pay_date) dated this month', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(sql).toContain('from public.invoices');
    expect(sql).toContain('issue_date   >= v_month_start');
    expect(sql).toContain('from public.expenses');
    expect(sql).toContain('expense_date >= v_month_start');
    expect(sql).toContain('from public.payroll_runs');
    expect(sql).toContain('pay_date     >= v_month_start');
    expect(sql).toContain("date_trunc('month', current_date)");
  });

  it('2. cancelled/voided/deleted rows still count (no status/deleted_at filter) — billed as issued', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    const invoiceCount = sql.slice(sql.indexOf('from public.invoices'));
    expect(invoiceCount).not.toMatch(/invoices[^;]*status\s*=/i);
    expect(invoiceCount).not.toMatch(/invoices[^;]*deleted_at/i);
  });

  it('3. non-document types (stock_movement, payments, journals) are NOT counted in the quota sum', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    // Extract only the counting block (the SELECT that sums into v_usage)
    const countBlock = sql.slice(sql.indexOf('into v_usage') - 500, sql.indexOf('into v_usage') + 800);
    expect(countBlock).not.toContain('stock_movements');
    expect(countBlock).not.toContain('invoice_payments');
    expect(countBlock).not.toContain('expense_payments');
    expect(countBlock).toContain('from public.invoices');
    expect(countBlock).toContain('from public.expenses');
    expect(countBlock).toContain('from public.payroll_runs');
    // Guard clause at top references journal_entries only for existence check, not counting
    expect(sql).toContain("to_regclass('public.journal_entries')");
  });

  // ── §5.3.1 Uniform trigger authority ───────────────────────────────────
  it('4. BEFORE INSERT triggers exist for all three billable tables (uniform authority)', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(sql).toContain('trg_invoices_quota');
    expect(sql).toContain('before insert on public.invoices');
    expect(sql).toContain('trg_expenses_quota');
    expect(sql).toContain('before insert on public.expenses');
    expect(sql).toContain('trg_payroll_runs_quota');
    expect(sql).toContain('before insert on public.payroll_runs');
  });

  it('5. trigger functions are SECURITY DEFINER and call the locked assert', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(sql).toContain('_ledgr_before_insert_invoices_quota');
    expect(sql).toContain('_ledgr_before_insert_expenses_quota');
    expect(sql).toContain('_ledgr_before_insert_payroll_runs_quota');
    expect(sql).toContain('security definer');
    expect(sql).toContain('perform public._ledgr_assert_usage_limit(NEW.business_id)');
  });

  it('6. locked assert serializes per-tenant with FOR UPDATE (P2a second-connection race proof)', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(sql).toMatch(/from public\.businesses where id = p_business_id for update/i);
    expect(sql).toContain("using errcode = 'P0QLT'");
    expect(sql).toContain('quota_denial');
    expect(sql).toContain('Policy denial (monthly document quota)');
  });

  it('7. idempotent client_key bypasses quota (replay is not a new billable document)', () => {
    const sql = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(sql).toContain('if NEW.client_key is not null then');
    expect(sql).toContain('client_key = NEW.client_key');
    const invoicesTrigger = sql.slice(sql.indexOf('_ledgr_before_insert_invoices_quota'));
    expect(invoicesTrigger).toContain('if v_exists then');
    expect(invoicesTrigger).toContain('return NEW;');
  });

  it('8. legacy RPCs retain their explicit quota assert (redundant but harmless)', () => {
    const quick = source('supabase/migrations/20260911000001_quick_save_rpc.sql');
    expect(quick).toContain('perform public._ledgr_assert_usage_limit');
    const pos = source('supabase/migrations/20260923000000_post_pos_sale_rpc.sql');
    expect(pos).toContain('perform public._ledgr_assert_usage_limit');
    const p5c = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(p5c).toContain('_ledgr_assert_usage_limit');
  });

  // ── §5.4 Payroll not double-counted ────────────────────────────────────
  it('9. payroll approval is an UPDATE, not a second INSERT — one run counts once', async () => {
    const payrollRepo = source('src/dal/repositories/PayrollRepository.ts');
    expect(payrollRepo).toContain('createWithLines');
    expect(payrollRepo).toContain('async approve(');
    expect(payrollRepo).not.toMatch(/approve[^}]*insert\s+into\s+payroll_runs/i);
    const quota = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(quota).toContain('payroll_runs');
    expect(quota).toContain('pay_date');
  });

  // ── §5.5 Invoice/Expense builder paths now enforce quota (via trigger) ───
  it('10. invoice builder and direct repository inserts are covered by the trigger (no bypass)', async () => {
    const invoiceRepo = source('src/dal/repositories/InvoiceRepository.ts');
    expect(invoiceRepo).toContain('createWithLines');
    const incomePage = source('src/pages/IncomePage.tsx');
    expect(incomePage).toContain('repos.invoice.createWithLines');
    const p5c = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(p5c).toContain('before insert on public.invoices');
    const bizRepo = source('src/dal/repositories/BusinessRepository.ts');
    expect(bizRepo).toContain('reserve_next_document_number');
    expect(bizRepo).not.toContain('_ledgr_assert_usage_limit');
    expect(bizRepo).not.toContain('P0QLT');
  });

  it('11. expense paths (quick expense, manual expense, builder) are all under the same trigger', () => {
    const expenseRepo = source('src/dal/repositories/ExpenseRepository.ts');
    expect(expenseRepo).toContain('createWithLines');
    const expensesPage = source('src/pages/ExpensesPage.tsx');
    expect(expensesPage).toContain('repos.expense.createWithLines');
    const p5c = source('supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql');
    expect(p5c).toContain('before insert on public.expenses');
  });

  // ── §5.7 Capture-time dual authority — queueApi enqueue guard ───────────
  it('12. queueApi imports the billing guard and maps billable operationTypes', () => {
    const queueApi = source('src/offline/queueApi.ts');
    expect(queueApi).toContain('usageService');
    expect(queueApi).toContain('isQuotaDenial');
    expect(queueApi).toContain("operationType === 'expense'");
    expect(queueApi).toContain("operationType === 'payroll_run'");
    expect(queueApi).toContain("operationType === 'income'");
    expect(queueApi).toContain("operationType === 'pos_sale'");
    expect(queueApi).toContain('documentKind');
    expect(queueApi).toContain('const clientKey');
  });

  it('13. queueApi enqueue throws P0QLT immediately when over quota (fail-closed only on quota)', async () => {
    const { offlineDB } = await import('@/offline/db');
    await offlineDB.open();
    await offlineDB.queue.clear();

    const { usageService } = await import('@/lib/billing/UsageService');
    const { UsageLimitError } = await import('@/lib/billing/quotaContract');
    const { enqueue } = await import('@/offline/queueApi');

    const spy = vi.spyOn(usageService, 'assertCanCreateDocument').mockRejectedValue(new UsageLimitError(50));

    await expect(
      enqueue('expense', 'p5c-biz', { expense: { business_id: 'p5c-biz' }, lines: [] } as never),
    ).rejects.toThrow(/Monthly transaction limit reached/);

    expect(await offlineDB.queue.count()).toBe(0);

    // Non-billable type must enqueue even when over quota (not checked)
    spy.mockClear();
    const id2 = await enqueue('stock_movement', 'p5c-biz', { movements: [] } as never);
    expect(typeof id2).toBe('number');
    expect(await offlineDB.queue.count()).toBe(1);
    expect(spy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    await offlineDB.queue.clear();
  });

  it('14. capture-time guard fails OPEN on network/offline (only P0QLT propagates)', async () => {
    const { offlineDB } = await import('@/offline/db');
    await offlineDB.open();
    await offlineDB.queue.clear();

    const { usageService } = await import('@/lib/billing/UsageService');
    vi.spyOn(usageService, 'assertCanCreateDocument').mockRejectedValue(new Error('Failed to fetch'));

    const { enqueue } = await import('@/offline/queueApi');
    const id = await enqueue('invoice', 'p5c-biz-2', { invoice: {}, lines: [] } as never);
    expect(typeof id).toBe('number');
    expect(await offlineDB.queue.count()).toBe(1);

    vi.restoreAllMocks();
    await offlineDB.queue.clear();
  });

  it('15. advisory: plan tier and price parity still hold after P5-C', async () => {
    const { PLANS } = await import('@/lib/billing/plans');
    expect(PLANS.free.transactionLimit).toBe(50);
    expect(PLANS.starter.transactionLimit).toBe(200);
    expect(PLANS.growth.transactionLimit).toBe(500);
    expect(PLANS.pro.transactionLimit).toBe(2000);
    expect(PLANS.enterprise.transactionLimit).toBeNull();
  });
});
