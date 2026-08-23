import { describe, expect, it } from 'vitest';
import { advise } from '@/lib/ai/advisor';
import { forecast } from '@/lib/ai/forecast';
import type { AiData, AiKpis, AiMonthlyTrend, DataContext } from '@/lib/ai/types';

const NOW = new Date(2026, 7, 22);

function trendMonth(offset: number, revenue: number, expenses: number, cashOut = expenses): AiMonthlyTrend {
  const d = new Date(2026, 7 + offset, 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return {
    month: key,
    month_start: `${key}-01`,
    revenue,
    expenses,
    profit: revenue - expenses,
    cash_in: revenue,
    cash_out: cashOut,
    net_cash: revenue - cashOut,
    cumulative_cash: 0,
  };
}

function makeKpis(over: Partial<AiKpis> = {}): AiKpis {
  return {
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    revenue_mtd: 10_000_000,
    expenses_mtd: 7_000_000,
    net_profit_mtd: 3_000_000,
    profit_margin_pct: 30,
    cash_balance: 20_000_000,
    receivables_total: 4_000_000,
    overdue_total: 200_000,
    open_invoice_count: 6,
    payables_total: 1_000_000,
    avg_days_to_pay: 34,
    expense_ratio_pct: 70,
    ...over,
  };
}

function makeData(over: Partial<AiData> = {}): AiData {
  return {
    generated_at: '2026-08-22T00:00:00Z',
    company: { id: 'b1', name: 'Kwacha Traders', currency: 'MWK', vat_registered: true, financial_year_start: '01-01' },
    kpis: makeKpis(),
    monthlyTrend: [trendMonth(-3, 9_000_000, 6_000_000), trendMonth(-2, 9_500_000, 6_200_000), trendMonth(-1, 10_000_000, 7_000_000)],
    overdueInvoices: [],
    topExpenses: [{ category: 'Fuel & Transport', account_code: '6300', amount: 2_400_000, document_count: 18, period_days: 90 }],
    topCustomers: [
      { customer: 'Blantyre Traders Ltd', revenue: 12_000_000, invoice_count: 9, last_invoice_date: '2026-08-01', outstanding: 1_000_000, share_pct: 30 },
    ],
    concentration: null,
    anomalies: [],
    upcomingReceivables: [],
    upcomingPayables: [],
    ...over,
  };
}

describe('advise', () => {
  it('handles a brand-new company without crashing or inventing numbers', () => {
    const a = advise({ companyName: 'Fresh Start Ltd', data: makeData({ kpis: null, monthlyTrend: [], topExpenses: [], topCustomers: [] }) }, NOW);
    expect(a.rating).toBe('watch');
    expect(a.headline).toContain('Fresh Start Ltd');
    expect(a.actions.length).toBeGreaterThanOrEqual(2);
    expect(a.insights.join(' ')).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('rates a profitable, liquid business as healthy', () => {
    const a = advise({ data: makeData() }, NOW);
    expect(a.rating).toBe('healthy');
    expect(a.headline).toMatch(/Kwacha Traders is performing well/);
  });

  it('flags a thin margin as danger and quotes the real figures', () => {
    const a = advise(
      { data: makeData({ kpis: makeKpis({ profit_margin_pct: 2, net_profit_mtd: 200_000, expenses_mtd: 9_800_000, expense_ratio_pct: 98 }) }) },
      NOW,
    );
    expect(a.rating).toBe('danger');
    expect(a.insights.join(' ')).toContain('MK 9,800,000');
  });

  it('names the worst overdue customer in an action', () => {
    const a = advise(
      {
        data: makeData({
          kpis: makeKpis({ overdue_total: 3_000_000, receivables_total: 4_000_000 }),
          overdueInvoices: [
            { invoice_id: 'i1', invoice_number: 'INV-0042', customer: 'Lilongwe Foods', amount_outstanding: 2_500_000, issue_date: '2026-05-01', due_date: '2026-06-01', days_overdue: 82 },
            { invoice_id: 'i2', invoice_number: 'INV-0051', customer: 'Mzuzu Retail', amount_outstanding: 500_000, issue_date: '2026-06-01', due_date: '2026-07-01', days_overdue: 52 },
          ],
        }),
      },
      NOW,
    );
    expect(a.rating).toBe('danger');
    expect(a.actions[0]).toContain('Lilongwe Foods');
    expect(a.actions[0]).toContain('INV-0042');
    expect(a.actions[0]).toContain('MK 2,500,000');
  });

  it('flags customer concentration above 40%', () => {
    const a = advise(
      {
        data: makeData({
          concentration: {
            total_revenue: 20_000_000,
            top_customer: 'Blantyre Traders Ltd',
            top_customer_revenue: 12_000_000,
            concentration_pct: 60,
            customer_count: 4,
          },
        }),
      },
      NOW,
    );
    expect(a.rating).toBe('danger');
    expect(a.insights.join(' ')).toContain('Blantyre Traders Ltd');
    expect(a.actions.join(' ')).toContain('Reduce reliance on Blantyre Traders Ltd');
  });

  it('escalates to danger when the forecast dips below zero', () => {
    const data = makeData({
      kpis: makeKpis({ cash_balance: 100_000 }),
      monthlyTrend: [trendMonth(-1, 0, 0, 0)],
      upcomingPayables: [{ source: 'tax', label: 'VAT 2026-08', counterparty: 'MRA', amount: 900_000, due_date: '2026-09-25' }],
    });
    const ctx: DataContext = { data, forecast: forecast(data, 3, NOW) };
    const a = advise(ctx, NOW);
    expect(a.rating).toBe('danger');
    expect(a.actions.join(' ')).toMatch(/shortfall/i);
  });

  it('always returns between 2 and 5 actions', () => {
    for (const ctx of [
      { data: makeData() },
      { data: makeData({ kpis: makeKpis({ cash_balance: 0, profit_margin_pct: -20, net_profit_mtd: -2_000_000 }) }) },
      { data: makeData({ topExpenses: [], topCustomers: [], kpis: makeKpis({ receivables_total: 0 }) }) },
    ]) {
      const a = advise(ctx, NOW);
      expect(a.actions.length).toBeGreaterThanOrEqual(2);
      expect(a.actions.length).toBeLessThanOrEqual(5);
    }
  });
});
