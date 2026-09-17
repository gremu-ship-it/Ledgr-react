/**
 * Integrity of the seeded demo books.
 *
 * These are the invariants the real product relies on, re-checked against the
 * local seed: double entry balances, the opening balance sheet balances,
 * invoice/expense arithmetic agrees with their lines and payments, and the
 * computed views match the SQL definitions they stand in for. If a seed edit
 * breaks one of these, the demo would show a visitor a broken trial balance —
 * the exact thing a demo must never do.
 */
import { describe, expect, it } from 'vitest';
import { buildDemoDataset, type DemoRow, type DemoTables } from '@/lib/demo/dataset';
import { computeDemoView } from '@/lib/demo/views';
import { DEMO_BUSINESS_ID, DEMO_USER_ID, isUuidShaped } from '@/lib/demo/constants';

const tables: DemoTables = buildDemoDataset(new Date('2026-09-17T09:00:00Z'));
const num = (row: DemoRow, key: string): number => Number(row[key] ?? 0);
const byId = (rowsList: DemoRow[], id: unknown): DemoRow | undefined =>
  rowsList.find((r) => r.id === id);

describe('demo dataset', () => {
  it('seeds the demo identity the app signs in as', () => {
    expect(isUuidShaped(DEMO_USER_ID)).toBe(true);
    expect(isUuidShaped(DEMO_BUSINESS_ID)).toBe(true);

    const profile = byId(tables.user_profiles ?? [], DEMO_USER_ID);
    expect(profile).toBeTruthy();
    expect(profile?.full_name).toBeTruthy();

    const membership = (tables.business_users ?? []).find((m) => m.user_id === DEMO_USER_ID);
    expect(membership?.business_id).toBe(DEMO_BUSINESS_ID);
    expect(membership?.role).toBe('owner');
    expect(membership?.is_active).toBe(true);

    const business = byId(tables.businesses ?? [], DEMO_BUSINESS_ID);
    expect(business?.is_active).toBe(true);
    expect(business?.deleted_at).toBeNull();
    expect(business?.base_currency).toBe('MWK');
  });

  it('seeds a full chart of accounts with resolvable parents', () => {
    const accounts = tables.accounts ?? [];
    expect(accounts.length).toBeGreaterThan(60);

    const ids = new Set(accounts.map((a) => a.id));
    for (const account of accounts) {
      expect(isUuidShaped(account.id)).toBe(true);
      if (account.parent_id != null) {
        expect(ids.has(String(account.parent_id))).toBe(true);
      }
    }

    const codes = new Set(accounts.map((a) => a.code));
    // Codes the journal service and inventory posting hardcode must exist.
    for (const code of ['1110', '1121', '1131', '1135', '1141', '2111', '2121', '2122', '4110', '5100', '6110']) {
      expect(codes.has(code), `missing account ${code}`).toBe(true);
    }
  });

  it('starts from a balanced opening position (assets = liabilities + equity)', () => {
    const accounts = tables.accounts ?? [];
    const sign = (a: DemoRow) => (a.account_type === 'asset' || a.account_type === 'expense' ? 1 : -1);
    // Opening balances are stored natural-side positive, so subtract the
    // contra side (accumulated depreciation) inside assets.
    const total = accounts.reduce((sum, a) => {
      const opening = num(a, 'opening_balance');
      if (opening === 0) return sum;
      const isContra = String(a.code).startsWith('152'); // accumulated depreciation
      const value = isContra ? -opening : opening;
      return sum + sign(a) * value;
    }, 0);
    expect(Math.abs(total)).toBeLessThan(0.01);
  });

  it('posts only balanced journal entries', () => {
    const entries = tables.journal_entries ?? [];
    const lines = tables.journal_lines ?? [];
    expect(entries.length).toBeGreaterThan(30);

    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of entries) {
      const entryLines = lines.filter((l) => l.journal_entry_id === entry.id);
      expect(entryLines.length, `entry ${String(entry.entry_number)} has no lines`).toBeGreaterThan(0);

      const debits = entryLines.filter((l) => l.is_debit).reduce((s, l) => s + num(l, 'amount_base'), 0);
      const credits = entryLines.filter((l) => !l.is_debit).reduce((s, l) => s + num(l, 'amount_base'), 0);
      expect(Math.abs(debits - credits), `unbalanced entry ${String(entry.entry_number)}`).toBeLessThan(0.01);

      totalDebits += debits;
      totalCredits += credits;

      expect(entry.status).toBe('posted');
      expect(entry.business_id).toBe(DEMO_BUSINESS_ID);
    }

    expect(Math.abs(totalDebits - totalCredits)).toBeLessThan(0.01);
    expect(totalDebits).toBeGreaterThan(0);
  });

  it('keeps invoice arithmetic consistent with lines and payments', () => {
    const invoices = tables.invoices ?? [];
    const lines = tables.invoice_lines ?? [];
    const payments = tables.invoice_payments ?? [];
    expect(invoices.length).toBeGreaterThan(10);

    for (const invoice of invoices) {
      const invoiceLines = lines.filter((l) => l.invoice_id === invoice.id);
      expect(invoiceLines.length).toBeGreaterThan(0);

      const subtotal = invoiceLines.reduce((s, l) => s + num(l, 'line_subtotal'), 0);
      const vat = invoiceLines.reduce((s, l) => s + num(l, 'tax_amount'), 0);
      expect(Math.abs(subtotal - num(invoice, 'subtotal'))).toBeLessThan(0.02);
      expect(Math.abs(vat - num(invoice, 'vat_amount'))).toBeLessThan(0.02);
      expect(Math.abs(num(invoice, 'subtotal') + num(invoice, 'vat_amount') - num(invoice, 'total_amount'))).toBeLessThan(0.02);

      const paid = payments
        .filter((p) => p.invoice_id === invoice.id)
        .reduce((s, p) => s + num(p, 'amount'), 0);
      expect(Math.abs(paid - num(invoice, 'amount_paid'))).toBeLessThan(0.02);
      expect(Math.abs(num(invoice, 'amount_due') - (num(invoice, 'total_amount') - num(invoice, 'amount_paid')))).toBeLessThan(0.02);

      // Status agrees with what has actually been collected.
      const total = num(invoice, 'total_amount');
      if (paid <= 0 && invoice.status !== 'draft') {
        expect(['sent', 'overdue']).toContain(String(invoice.status));
      } else if (paid > 0 && paid < total) {
        expect(invoice.status).toBe('partially_paid');
      } else if (paid >= total && total > 0) {
        expect(invoice.status).toBe('paid');
      }

      // Issued invoices are linked to the journal entry that recognised them;
      // a draft has not been issued yet, so it posts nothing.
      if (invoice.status === 'draft') {
        expect(invoice.journal_entry_id).toBeNull();
      } else {
        expect(invoice.journal_entry_id).toBeTruthy();
        expect(byId(tables.journal_entries ?? [], invoice.journal_entry_id)).toBeTruthy();
      }
    }
  });

  it('keeps expense arithmetic consistent with lines', () => {
    const expenses = tables.expenses ?? [];
    const lines = tables.expense_lines ?? [];
    expect(expenses.length).toBeGreaterThan(10);

    for (const expense of expenses) {
      const expenseLines = lines.filter((l) => l.expense_id === expense.id);
      expect(expenseLines.length).toBeGreaterThan(0);
      const subtotal = expenseLines.reduce((s, l) => s + num(l, 'line_subtotal'), 0);
      expect(Math.abs(subtotal - num(expense, 'subtotal'))).toBeLessThan(0.02);
      expect(Math.abs(num(expense, 'subtotal') + num(expense, 'vat_amount') - num(expense, 'total_amount'))).toBeLessThan(0.02);
      expect(['receipt', 'bill']).toContain(String(expense.expense_type));
      expect(expense.journal_entry_id).toBeTruthy();
    }
  });

  it('runs payroll with PAYE deducted and journalised', () => {
    const runs = tables.payroll_runs ?? [];
    const lines = tables.payroll_employee_lines ?? [];
    // One run per month of the trading window: a business that pays staff only
    // in the last two months would show no salary cost on most of its P&L.
    expect(runs.length).toBe(6);
    expect(new Set(runs.map((r) => r.run_number)).size).toBe(6);
    // The oldest runs are paid and filed; the current month is approved only.
    expect(runs.filter((r) => r.status === 'paid').length).toBe(5);
    expect(runs.filter((r) => r.status === 'approved').length).toBe(1);

    for (const run of runs) {
      const runLines = lines.filter((l) => l.payroll_run_id === run.id);
      expect(runLines.length).toBe(3);

      const gross = runLines.reduce((s, l) => s + num(l, 'gross_pay'), 0);
      const paye = runLines.reduce((s, l) => s + num(l, 'paye_deduction'), 0);
      const net = runLines.reduce((s, l) => s + num(l, 'net_pay'), 0);
      const pensionEmployee = runLines.reduce((s, l) => s + num(l, 'pension_employee'), 0);

      expect(Math.abs(gross - num(run, 'total_gross'))).toBeLessThan(0.02);
      expect(Math.abs(paye - num(run, 'total_paye'))).toBeLessThan(0.02);
      expect(Math.abs(net - num(run, 'total_net'))).toBeLessThan(0.02);
      expect(Math.abs(gross - paye - pensionEmployee - net)).toBeLessThan(0.02);
      expect(paye).toBeGreaterThan(0);
      // calculatePAYE returns a MONTHLY figure for annual gross. A 30%-band
      // team at these salaries sits near 17% of gross — an order-of-magnitude
      // guard against dividing by twelve twice again.
      expect(paye / gross).toBeGreaterThan(0.1);
      expect(paye / gross).toBeLessThan(0.3);
    }

    // The highest earner pays more PAYE than the lowest.
    const byEmployee = new Map<string, number>();
    for (const line of lines) {
      byEmployee.set(String(line.employee_id), Math.max(byEmployee.get(String(line.employee_id)) ?? 0, num(line, 'paye_deduction')));
    }
    const values = [...byEmployee.values()].sort((a, b) => b - a);
    expect(values[0]).toBeGreaterThan(values[values.length - 1]);
  });

  it('spreads six months of trading history ending in the current month', () => {
    const anchor = new Date('2026-09-17T09:00:00Z');
    const currentPeriod = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
    const periods = new Set((tables.invoices ?? []).map((i) => String(i.issue_date).slice(0, 7)));
    expect(periods.size).toBeGreaterThanOrEqual(6);
    expect(periods.has(currentPeriod)).toBe(true);

    // Nothing is dated in the future — a demo visitor should never see a
    // document that has not happened yet.
    const today = currentPeriod + '-31';
    for (const invoice of tables.invoices ?? []) {
      expect(String(invoice.issue_date) <= today).toBe(true);
    }
  });

  it('seeds reference data the tax and inventory screens need', () => {
    expect((tables.tax_configurations ?? []).length).toBeGreaterThan(3);
    expect((tables.paye_bands ?? []).length).toBe(4);
    expect((tables.accounting_periods ?? []).length).toBe(12);
    expect((tables.currencies ?? []).some((c) => c.code === 'MWK' && c.is_primary === true)).toBe(true);
    expect((tables.exchange_rates ?? []).length).toBeGreaterThan(0);
    expect((tables.inventory_locations ?? []).length).toBe(1);
    expect((tables.inventory_balances ?? []).length).toBeGreaterThan(3);
    expect((tables.fixed_assets ?? []).length).toBe(2);
    expect((tables.asset_categories ?? []).length).toBe(3);
    expect((tables.contacts ?? []).length).toBe(10);
    expect((tables.branches ?? []).length).toBe(2);
    expect((tables.departments ?? []).length).toBe(3);
  });

  it('produces a balanced trial balance view', () => {
    const trial = computeDemoView('v_trial_balance', tables);
    expect(trial.length).toBe((tables.accounts ?? []).length);

    const debits = trial.reduce((s, r) => s + num(r, 'total_debits'), 0);
    const credits = trial.reduce((s, r) => s + num(r, 'total_credits'), 0);
    expect(Math.abs(debits - credits)).toBeLessThan(0.01);
    expect(debits).toBeGreaterThan(0);

    const cash = trial.find((r) => r.code === '1110');
    expect(cash).toBeTruthy();
    // Cash on Hand opened at 250,000 and moves with the seeded transactions.
    expect(typeof cash?.balance).toBe('number');
  });

  it('ages open receivables into the right buckets', () => {
    const ageing = computeDemoView('v_ar_ageing', tables, new Date('2026-09-17T09:00:00Z'));
    expect(ageing.length).toBeGreaterThan(0);
    for (const row of ageing) {
      expect(['current', '1-30', '31-60', '61-90', '90+']).toContain(String(row.ageing_bucket));
      expect(row.contact_name).toBeTruthy();
      expect(num(row, 'amount_due')).toBeGreaterThan(0);
    }
    // The seed deliberately leaves at least one overdue invoice to show chasing.
    expect(ageing.some((r) => r.ageing_bucket !== 'current')).toBe(true);
  });

  it('flags low stock and computes the asset register', () => {
    const alerts = computeDemoView('v_reorder_alerts', tables);
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(num(alert, 'quantity_available')).toBeLessThanOrEqual(num(alert, 'reorder_level'));
      expect(alert.product_name).toBeTruthy();
    }

    const register = computeDemoView('v_asset_register', tables);
    expect(register.length).toBe(2);
    for (const asset of register) {
      const nbv = num(asset, 'acquisition_cost') - num(asset, 'accumulated_depreciation');
      expect(Math.abs(nbv - num(asset, 'net_book_value'))).toBeLessThan(0.02);
      expect(asset.category).toBeTruthy();
    }
  });

  it('aggregates monthly cash flow by activity type', () => {
    const cashFlow = computeDemoView('v_cash_flow', tables);
    expect(cashFlow.length).toBeGreaterThan(3);
    for (const row of cashFlow) {
      expect(String(row.period)).toMatch(/^\d{4}-\d{2}$/);
      const net = num(row, 'operating') + num(row, 'investing') + num(row, 'financing');
      expect(Math.abs(net - num(row, 'net_change'))).toBeLessThan(0.01);
    }
    // Trading generates positive operating cash in at least one month.
    expect(cashFlow.some((r) => num(r, 'operating') > 0)).toBe(true);
  });

  it('keeps a solvent balance sheet: positive stock, positive cash, creditors for the current month', () => {
    const accounts = tables.accounts ?? [];
    const lines = tables.journal_lines ?? [];
    /** Balance on the account's natural side, so liabilities read positive. */
    const balanceOf = (code: string): number => {
      const account = accounts.find((a) => a.code === code)!;
      const debitPositive = lines
        .filter((l) => l.account_id === account.id)
        .reduce((sum, l) => sum + (l.is_debit ? num(l, 'amount_base') : -num(l, 'amount_base')), 0);
      const natural = account.normal_balance === 'debit' ? debitPositive : -debitPositive;
      return num(account, 'opening_balance') + natural;
    };

    // COGS credits Trading Stock every time goods are invoiced, so the stock
    // bills that replenish it must exist — otherwise inventory goes negative.
    expect(balanceOf('1141')).toBeGreaterThan(1_000_000);
    expect(balanceOf('1110') + balanceOf('1121') + balanceOf('1125')).toBeGreaterThan(1_000_000);
    expect(balanceOf('1131')).toBeGreaterThan(0); // debtors exist
    expect(balanceOf('2111')).toBeGreaterThan(0); // and so do creditors

    // Only the current month's VAT is still owed; earlier returns are filed
    // and paid, so the payable is roughly one month of output tax.
    const vatPayable = balanceOf('2121');
    expect(vatPayable).toBeGreaterThan(0);
    expect(vatPayable).toBeLessThan(3_000_000);

    // One VAT return per trading month. Each is filed and paid once its MRA
    // deadline (the 20th of the following month) has passed — so the newest
    // one or two are still pending, which is what the tax screen should show.
    const anchorDate = '2026-09-17';
    const returns_ = tables.tax_returns ?? [];
    expect(returns_.length).toBe(6);

    const localDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    let filed = 0;
    for (const r of returns_) {
      const [y, m, day] = String(r.period_end).split('-').map(Number);
      const deadline = localDate(new Date(y, m - 1, day + 20));
      const shouldBeFiled = deadline <= anchorDate && num(r, 'amount_due') > 0;
      expect(r.status, `return ${String(r.period_label)}`).toBe(shouldBeFiled ? 'filed' : 'pending');

      if (shouldBeFiled) {
        filed += 1;
        expect(r.journal_entry_id).toBeTruthy();
        expect(num(r, 'amount_paid')).toBe(num(r, 'amount_due'));
        expect(String(r.filed_ref)).toContain('MRA-VAT-');
      } else {
        expect(r.journal_entry_id).toBeNull();
        expect(num(r, 'amount_paid')).toBe(0);
      }
    }
    expect(filed).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic: two builds from the same instant match', () => {
    const again = buildDemoDataset(new Date('2026-09-17T09:00:00Z'));
    expect(JSON.stringify(again)).toBe(JSON.stringify(tables));
  });
});
