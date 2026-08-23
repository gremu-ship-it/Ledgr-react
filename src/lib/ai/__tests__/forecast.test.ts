import { describe, expect, it } from 'vitest';
import {
  addMonths,
  forecast,
  linearRegression,
  negativeMonths,
  weightedAverage,
} from '@/lib/ai/forecast';
import type { AiData, AiMonthlyTrend } from '@/lib/ai/types';

const NOW = new Date(2026, 7, 22); // 22 Aug 2026 (local)

function month(offset: number, values: Partial<AiMonthlyTrend> = {}): AiMonthlyTrend {
  const d = new Date(2026, 7 + offset, 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return {
    month: key,
    month_start: `${key}-01`,
    revenue: 0,
    expenses: 0,
    profit: 0,
    cash_in: 0,
    cash_out: 0,
    net_cash: 0,
    cumulative_cash: 0,
    ...values,
  };
}

function emptyData(overrides: Partial<AiData> = {}): AiData {
  return {
    generated_at: '2026-08-22T00:00:00Z',
    company: { id: 'b1', name: 'Test Ltd', currency: 'MWK', vat_registered: true, financial_year_start: '01-01' },
    kpis: null,
    monthlyTrend: [],
    overdueInvoices: [],
    topExpenses: [],
    topCustomers: [],
    concentration: null,
    anomalies: [],
    upcomingReceivables: [],
    upcomingPayables: [],
    ...overrides,
  };
}

const kpis = (cash: number) => ({
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  revenue_mtd: 0,
  expenses_mtd: 0,
  net_profit_mtd: 0,
  profit_margin_pct: null,
  cash_balance: cash,
  receivables_total: 0,
  overdue_total: 0,
  open_invoice_count: 0,
  payables_total: 0,
  avg_days_to_pay: null,
  expense_ratio_pct: null,
});

describe('weightedAverage', () => {
  it('weights the most recent month heaviest (0.5 / 0.3 / 0.2)', () => {
    // most recent last: 100, 200, 300 → 300*0.5 + 200*0.3 + 100*0.2 = 230
    expect(weightedAverage([100, 200, 300])).toBeCloseTo(230, 6);
  });

  it('renormalises when fewer than three values exist', () => {
    // 300*0.5 + 200*0.3 = 210, over weight 0.8 → 262.5
    expect(weightedAverage([200, 300])).toBeCloseTo(262.5, 6);
  });

  it('returns 0 for an empty series rather than NaN', () => {
    expect(weightedAverage([])).toBe(0);
  });
});

describe('linearRegression', () => {
  it('fits a perfect line with R^2 = 1', () => {
    const r = linearRegression([10, 20, 30, 40]);
    expect(r.slope).toBeCloseTo(10, 6);
    expect(r.r2).toBeCloseTo(1, 6);
  });

  it('reports low R^2 for noise', () => {
    expect(linearRegression([10, 90, 12, 88, 11, 92]).r2).toBeLessThan(0.6);
  });

  it('never returns NaN for a flat series', () => {
    const r = linearRegression([5, 5, 5]);
    expect(Number.isFinite(r.slope)).toBe(true);
    expect(Number.isFinite(r.r2)).toBe(true);
  });
});

describe('addMonths', () => {
  it('rolls over the year boundary', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
  });
});

describe('forecast', () => {
  it('is low confidence with an explicit assumption for a brand-new company', () => {
    const f = forecast(emptyData({ kpis: kpis(0) }), 3, NOW);
    expect(f.confidence).toBe('low');
    expect(f.cashFlow).toHaveLength(3);
    expect(f.assumptions.some((a) => /limited history/i.test(a))).toBe(true);
    for (const m of f.cashFlow) {
      expect(Number.isFinite(m.projected_in)).toBe(true);
      expect(Number.isFinite(m.projected_out)).toBe(true);
      expect(Number.isFinite(m.projected_balance)).toBe(true);
    }
  });

  it('projects the run rate and rolls the balance forward', () => {
    const trend = [
      month(-3, { cash_in: 1_000_000, cash_out: 600_000 }),
      month(-2, { cash_in: 1_000_000, cash_out: 600_000 }),
      month(-1, { cash_in: 1_000_000, cash_out: 600_000 }),
    ];
    const f = forecast(emptyData({ kpis: kpis(500_000), monthlyTrend: trend }), 3, NOW);

    expect(f.cashFlow[0].projected_in).toBe(1_000_000);
    expect(f.cashFlow[0].projected_out).toBe(600_000);
    expect(f.cashFlow[0].projected_balance).toBe(900_000);
    expect(f.cashFlow[2].projected_balance).toBe(1_700_000);
  });

  it('applies the documented collection curves to overdue and upcoming invoices', () => {
    const data = emptyData({
      kpis: kpis(0),
      monthlyTrend: [month(-1, { cash_in: 0, cash_out: 0 })],
      overdueInvoices: [
        {
          invoice_id: 'i1',
          invoice_number: 'INV-1',
          customer: 'Blantyre Traders Ltd',
          amount_outstanding: 1_000_000,
          issue_date: '2026-06-01',
          due_date: '2026-07-01',
          days_overdue: 52,
        },
      ],
      upcomingReceivables: [
        {
          invoice_id: 'i2',
          invoice_number: 'INV-2',
          customer: 'Lilongwe Foods',
          amount_outstanding: 400_000,
          due_date: '2026-09-10',
          days_until_due: 19,
          bucket: '0-30',
        },
        {
          invoice_id: 'i3',
          invoice_number: 'INV-3',
          customer: 'Mzuzu Retail',
          amount_outstanding: 200_000,
          due_date: '2026-10-10',
          days_until_due: 49,
          bucket: '30-60',
        },
      ],
    });

    const f = forecast(data, 3, NOW);
    // month 1: 60% of overdue + 85% of 0-30 = 600,000 + 340,000
    expect(f.cashFlow[0].projected_in).toBe(940_000);
    // month 2: 30% of overdue + 50% of 30-60 = 300,000 + 100,000
    expect(f.cashFlow[1].projected_in).toBe(400_000);
    expect(f.cashFlow[2].projected_in).toBe(0);
  });

  it('adds committed payables in the month they fall due and flags a negative balance', () => {
    const data = emptyData({
      kpis: kpis(100_000),
      monthlyTrend: [month(-1, { cash_in: 0, cash_out: 0 })],
      upcomingPayables: [
        { source: 'payroll', label: 'Payroll 2026-09', counterparty: 'Employees', amount: 800_000, due_date: '2026-09-28' },
      ],
    });

    const f = forecast(data, 3, NOW);
    expect(f.cashFlow[0].projected_out).toBe(800_000);
    expect(f.cashFlow[0].projected_balance).toBe(-700_000);

    const negatives = negativeMonths(f);
    expect(negatives).toHaveLength(3); // stays negative once it dips
    expect(negatives[0].month).toBe('2026-09');
  });

  it('upgrades to regression with >= 6 months of a clean trend', () => {
    const trend = [-6, -5, -4, -3, -2, -1].map((offset, i) =>
      month(offset, { revenue: 1_000_000 + i * 100_000, expenses: 500_000 }),
    );
    const f = forecast(emptyData({ kpis: kpis(0), monthlyTrend: trend }), 3, NOW);
    expect(f.assumptions.some((a) => /Revenue is projected by linear regression/.test(a))).toBe(true);
    // Extending +100,000/month past 1,500,000.
    expect(f.revenue[0].projected).toBeGreaterThan(1_500_000);
  });

  it('rates 9+ months of activity as high confidence', () => {
    const trend = Array.from({ length: 10 }, (_, i) =>
      month(i - 10, { revenue: 1_000_000, expenses: 700_000, cash_in: 900_000, cash_out: 700_000 }),
    );
    expect(forecast(emptyData({ kpis: kpis(0), monthlyTrend: trend }), 3, NOW).confidence).toBe('high');
  });

  it('never produces NaN from malformed data', () => {
    const broken = emptyData({
      kpis: { ...kpis(Number.NaN), revenue_mtd: Number.NaN },
      monthlyTrend: [month(-1, { cash_in: Number.NaN, cash_out: Number.NaN })],
    });
    const f = forecast(broken, 3, NOW);
    for (const m of f.cashFlow) {
      expect(Number.isNaN(m.projected_balance)).toBe(false);
      expect(Number.isNaN(m.projected_in)).toBe(false);
    }
  });

  it('tolerates a null payload', () => {
    const f = forecast(null, 3, NOW);
    expect(f.confidence).toBe('low');
    expect(f.cashFlow).toHaveLength(3);
  });
});
