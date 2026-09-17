// @vitest-environment jsdom
/**
 * End-to-end check that the *real* data layer works against the demo books.
 *
 * The unit tests prove the query builder implements PostgREST semantics; this
 * file proves the thing that actually matters — that the repositories, the
 * dashboard hooks' query bodies and the financial statements return sensible
 * numbers when they run against the seeded tenant. If a demo visitor opens the
 * dashboard and sees zeros or an unbalanced balance sheet, the demo has failed
 * no matter how correct the individual pieces look.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { BusinessRepository } from '@/dal/repositories/BusinessRepository';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { saveQuickSaleViaRpc, newSaveClientKey } from '@/services/quickSaveService';
import { enterDemoMode, exitDemoMode } from '@/lib/demo/session';
import { clearDemoData } from '@/lib/demo/store';
import { DEMO_BUSINESS_ID, DEMO_USER_ID } from '@/lib/demo/constants';

const businessRepo = new BusinessRepository(supabase);
const statements = new FinancialStatementRepository(supabase);

/** Mirrors fetchLatestRecordDate() in src/hooks/useDashboardData.ts. */
async function latestRecordDate(): Promise<string> {
  const [invoices, expenses] = await Promise.all([
    repos.income.findByDateRange(DEMO_BUSINESS_ID, '2000-01-01', '2099-12-31'),
    repos.expense.findByDateRange(DEMO_BUSINESS_ID, '2000-01-01', '2099-12-31'),
  ]);
  const dates = [invoices[0]?.issue_date, expenses[0]?.expense_date].filter(Boolean) as string[];
  return dates.sort().reverse()[0];
}

function monthRange(anchor: string): { from: string; to: string } {
  const ref = new Date(anchor);
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(to) };
}

beforeEach(async () => {
  exitDemoMode();
  clearDemoData();
  window.localStorage.clear();
  await enterDemoMode();
});

describe('demo books through the real repositories', () => {
  it('boots the tenant the way useAuthListener does', async () => {
    const memberships = await businessRepo.findMembershipsWithRole(DEMO_USER_ID);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');
    expect(memberships[0].business?.id).toBe(DEMO_BUSINESS_ID);
    expect(memberships[0].business?.name).toBeTruthy();

    const byUser = await businessRepo.findByUser(DEMO_USER_ID);
    expect(byUser.map((b) => b.id)).toContain(DEMO_BUSINESS_ID);

    const profile = await businessRepo.findUserProfile(DEMO_USER_ID);
    expect(profile).toBeTruthy();
  });

  it('answers the dashboard hooks with real numbers, not zeros', async () => {
    const anchor = await latestRecordDate();
    expect(anchor).toBeTruthy();
    const { from, to } = monthRange(anchor);

    const [income, outstanding, expenseRows, journals, periods, trialBalance] = await Promise.all([
      repos.income.getTotals(DEMO_BUSINESS_ID, from, to),
      repos.income.findOutstanding(DEMO_BUSINESS_ID),
      repos.expense.findByDateRange(DEMO_BUSINESS_ID, from, to),
      repos.journal.findByBusinessAndDateRange(DEMO_BUSINESS_ID, '2020-01-01', '2099-12-31'),
      repos.period.findByBusiness(DEMO_BUSINESS_ID),
      repos.income.findTrialBalance(DEMO_BUSINESS_ID),
    ]);

    // useMonthlyIncome
    expect(income.totalAmount).toBeGreaterThan(0);
    expect(income.vatAmount).toBeGreaterThan(0);
    expect(Math.abs(income.totalAmount - income.amountPaid - income.amountOutstanding)).toBeLessThan(1);

    // useOutstandingInvoices
    expect(outstanding.length).toBeGreaterThan(0);
    expect(outstanding.every((i) => ['sent', 'partially_paid', 'overdue'].includes(String(i.status)))).toBe(true);
    expect(outstanding.every((i) => Number(i.amount_due) > 0)).toBe(true);

    // useMonthlyExpenses / useMonthlyExpenseVat
    const expenses = expenseRows
      .filter((r) => r.status !== 'void' && r.status !== 'draft')
      .reduce((sum, r) => sum + Number(r.functional_amount ?? r.total_amount), 0);
    expect(expenses).toBeGreaterThan(0);

    // useRecentJournalEntries — and the lock detection that goes with it.
    expect(journals.length).toBeGreaterThan(20);
    expect(periods).toHaveLength(12);
    // The months before the ledger cut-over are locked. What matters for the
    // visitor is that nothing the demo seeded sits inside a locked period, and
    // that the month they land in is open — otherwise every document they look
    // at, or try to create, is blocked by the period lock.
    const closed = periods.filter((p) => p.is_closed);
    expect(closed.length).toBeGreaterThan(0);
    for (const entry of journals) {
      const locked = closed.some(
        (p) => String(p.period_start) <= String(entry.entry_date) && String(entry.entry_date) <= String(p.period_end),
      );
      expect(locked, `${String(entry.entry_number)} sits in a locked period`).toBe(false);
    }
    const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    expect(periods.find((p) => String(p.period_start).startsWith(thisMonth))?.is_closed).toBe(false);

    // Trial balance behind the P&L / balance sheet
    const debits = trialBalance.reduce((s, r) => s + Number(r.total_debits ?? 0), 0);
    const credits = trialBalance.reduce((s, r) => s + Number(r.total_credits ?? 0), 0);
    expect(debits).toBeGreaterThan(0);
    expect(Math.abs(debits - credits)).toBeLessThan(0.01);
  });

  it('renders a six-month income/expense trend with data in every bucket', async () => {
    const anchor = await latestRecordDate();
    const ref = new Date(anchor);
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(ref.getFullYear(), ref.getMonth() - (5 - i), 1);
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
      return { from, to };
    });

    const trend = await Promise.all(
      buckets.map(async ({ from, to }) => {
        const [income, expenseRows] = await Promise.all([
          repos.income.getTotals(DEMO_BUSINESS_ID, from, to),
          repos.expense.findByDateRange(DEMO_BUSINESS_ID, from, to),
        ]);
        return {
          income: income.totalAmount,
          expenses: expenseRows.filter((r) => r.status !== 'void').reduce((s, r) => s + Number(r.functional_amount ?? r.total_amount), 0),
        };
      }),
    );

    expect(trend).toHaveLength(6);
    // The chart must not be a flat line of zeros — every month trades.
    expect(trend.every((b) => b.income > 0)).toBe(true);
    expect(trend.every((b) => b.expenses > 0)).toBe(true);
  });

  it('produces a profit and loss with revenue, costs and a profit', async () => {
    const anchor = await latestRecordDate();
    const { from, to } = monthRange(anchor);

    const pl = await statements.getProfitOrLoss(DEMO_BUSINESS_ID, from, to);
    expect(pl.totalRevenue).toBeGreaterThan(0);
    expect(pl.totalOperatingExpenses).toBeGreaterThan(0);
    expect(pl.revenue.lines.length).toBeGreaterThan(0);
    expect(Math.abs(pl.grossProfit - (pl.totalRevenue - pl.totalCostOfSales))).toBeLessThan(0.01);
    expect(Math.abs(pl.profitBeforeTax - (pl.grossProfit + pl.totalOtherIncome - pl.totalOperatingExpenses - pl.totalDepreciationAmortisation - pl.totalFinanceCosts))).toBeLessThan(0.01);

    // The demo has to look like a business that works: a trader's margin on
    // staples, and a profit rather than a loss in the month on show.
    expect(pl.grossProfit / pl.totalRevenue).toBeGreaterThan(0.2);
    expect(pl.grossProfit / pl.totalRevenue).toBeLessThan(0.45);
    expect(pl.netProfit).toBeGreaterThan(0);
  });

  it('produces a balance sheet whose only gap is the unclosed year profit', async () => {
    const anchor = await latestRecordDate();
    const { to } = monthRange(anchor);
    const yearStart = `${new Date(anchor).getFullYear()}-01-01`;

    const sofp = await statements.getSOFP(DEMO_BUSINESS_ID, to);
    const ytd = await statements.getProfitOrLoss(DEMO_BUSINESS_ID, yearStart, to);

    expect(sofp.totalAssets).toBeGreaterThan(0);
    expect(sofp.totalLiabilities).toBeGreaterThan(0);
    expect(sofp.totalEquity).toBeGreaterThan(0);
    expect(Math.abs(sofp.totalAssets - (sofp.totalLiabilities + sofp.netAssets))).toBeLessThan(1);

    // getSOFP reports isBalanced = false whenever the year's profit has not
    // been closed to account 3130 — true of any live business mid-year, and
    // the report says so. What must hold exactly is that the difference IS
    // that profit and nothing else: any other amount means a seeded journal
    // is unbalanced or an account is double-counted.
    expect(Math.abs(sofp.netAssets - sofp.totalEquity - ytd.netProfit)).toBeLessThan(1);
    expect(ytd.netProfit).toBeGreaterThan(0);

    // Fixed assets come from the GL only. Without a posted capitalisation
    // journal, getSOFP's register fallback adds each asset's NBV a second
    // time under "register — pending capitalisation".
    expect(sofp.nonCurrentAssets.lines.every((l) => !l.name.includes('register'))).toBe(true);
    expect(sofp.nonCurrentAssets.subtotal).toBeGreaterThan(0);

    // Solvent: real cash behind the current assets, and stock still positive
    // after six months of COGS.
    expect(await statements.getCashPosition(DEMO_BUSINESS_ID, to)).toBeGreaterThan(0);
    expect(sofp.currentAssets.lines.find((l) => l.code === '1141')?.amount).toBeGreaterThan(0);
  });

  it('reports a cash position for the treasury widget', async () => {
    const anchor = await latestRecordDate();
    const cash = await statements.getCashPosition(DEMO_BUSINESS_ID, anchor);
    expect(Number.isFinite(cash)).toBe(true);
    expect(cash).toBeGreaterThan(0);
  });
});

describe('demo writes through the real service layer', () => {
  it('reserves document numbers the way the invoice form does', async () => {
    const first = await businessRepo.reserveNextInvoiceNumber(DEMO_BUSINESS_ID);
    const second = await businessRepo.reserveNextInvoiceNumber(DEMO_BUSINESS_ID);
    expect(first).toMatch(/^INV-\d{4}$/);
    expect(Number(second.slice(4))).toBe(Number(first.slice(4)) + 1);

    const expense = await businessRepo.reserveNextExpenseNumber(DEMO_BUSINESS_ID);
    expect(expense).toMatch(/^EXP-\d{4}$/);
  });

  it('creates an invoice, its lines and a balanced journal via the quick-save RPC', async () => {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('business_id', DEMO_BUSINESS_ID)
      .eq('contact_type', 'customer')
      .limit(1);
    const contactId = String((contact as { id: string }[])[0].id);

    const { data: product } = await supabase
      .from('products')
      .select('id, sale_price')
      .eq('business_id', DEMO_BUSINESS_ID)
      .limit(1);
    const item = (product as { id: string; sale_price: number }[])[0];

    const result = await saveQuickSaleViaRpc({
      business_id: DEMO_BUSINESS_ID,
      client_key: newSaveClientKey(),
      invoice: {
        business_id: DEMO_BUSINESS_ID,
        contact_id: contactId,
        issue_date: '2026-09-17',
        due_date: '2026-10-17',
        status: 'sent',
        notes: 'Created in the demo',
      },
      lines: [
        {
          business_id: DEMO_BUSINESS_ID,
          description: 'Demo quick sale',
          product_id: item.id,
          quantity: 2,
          unit_price: Number(item.sale_price),
          line_subtotal: Number(item.sale_price) * 2,
          tax_amount: Number(item.sale_price) * 2 * 0.175,
          line_total: Number(item.sale_price) * 2 * 1.175,
        },
      ],
      subtotal: Number(item.sale_price) * 2,
      vat_amount: Number(item.sale_price) * 2 * 0.175,
      stock_lines: [],
    });

    expect(result.id).toBeTruthy();
    expect(result.number).toMatch(/^INV-\d{4}$/);
    expect(result.journal_entry_id).toBeTruthy();

    // The new invoice is visible to the repositories the screens use…
    const outstanding = await repos.income.findOutstanding(DEMO_BUSINESS_ID);
    expect(outstanding.some((i) => i.id === result.id)).toBe(true);

    // …and the books are still balanced after the write.
    const trialBalance = await repos.income.findTrialBalance(DEMO_BUSINESS_ID);
    const debits = trialBalance.reduce((s, r) => s + Number(r.total_debits ?? 0), 0);
    const credits = trialBalance.reduce((s, r) => s + Number(r.total_credits ?? 0), 0);
    expect(Math.abs(debits - credits)).toBeLessThan(0.01);

    const { data: entry } = await supabase
      .from('journal_entries')
      .select('entry_number, status, journal_lines(is_debit, amount_base)')
      .eq('id', String(result.journal_entry_id))
      .single();
    const lines = (entry as { journal_lines: { is_debit: boolean; amount_base: number }[] }).journal_lines;
    const debit = lines.filter((l) => l.is_debit).reduce((s, l) => s + Number(l.amount_base), 0);
    const credit = lines.filter((l) => !l.is_debit).reduce((s, l) => s + Number(l.amount_base), 0);
    expect(Math.abs(debit - credit)).toBeLessThan(0.01);
  });

  it('fails loudly, not silently, on operations the demo cannot perform', async () => {
    const { error } = await supabase.rpc('invite_member', {
      p_business_id: DEMO_BUSINESS_ID,
      p_email: 'someone@example.com',
      p_role: 'viewer',
    });
    expect(error).toBeTruthy();
    expect(String(error?.message).toLowerCase()).toContain('demo');
  });
});
