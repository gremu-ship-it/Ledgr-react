import { describe, expect, it } from 'vitest';
import { normaliseAiData } from '@/lib/ai/context';

/**
 * Regression coverage for the shapes `ai_context()` can actually return.
 *
 * The payload is JSONB built by Postgres, so every field can arrive as null,
 * as an empty object/array, or absent entirely — a brand-new company, a
 * service-role caller and a fully-populated business all produce different
 * shapes. normaliseAiData() is the single place these are narrowed.
 */

const FULL = {
  generated_at: '2026-08-23T10:00:00+02',
  company: {
    id: 'b1', name: 'Kwacha Traders', currency: 'MWK',
    vat_registered: true, financial_year_start: '01-01',
  },
  kpis: {
    period_start: '2026-08-01', period_end: '2026-08-31',
    revenue_mtd: 10_000_000, expenses_mtd: 7_000_000, net_profit_mtd: 3_000_000,
    profit_margin_pct: 30, cash_balance: 20_000_000, receivables_total: 4_000_000,
    overdue_total: 1_000_000, open_invoice_count: 6, payables_total: 900_000,
    avg_days_to_pay: 34, expense_ratio_pct: 70,
  },
  monthlyTrend: [],
  overdueInvoices: [],
  topExpenses: [],
  topCustomers: [],
  concentration: null,
  anomalies: [],
  upcomingReceivables: [],
  upcomingPayables: [],
};

describe('normaliseAiData', () => {
  it('narrows a fully-populated payload', () => {
    const d = normaliseAiData(FULL);
    expect(d).not.toBeNull();
    expect(d!.kpis?.revenue_mtd).toBe(10_000_000);
    expect(d!.company?.name).toBe('Kwacha Traders');
  });

  it('treats kpis: {} as absent, not as a row of zeros', () => {
    // ai_context() coalesces a missing KPI row to '{}'::jsonb
    // (migration 20260823000001). If this leaked through as an object, every
    // numeric field would coerce to 0 and the assistant would report
    // "MK 0 revenue" for a company it simply could not read.
    const d = normaliseAiData({ ...FULL, kpis: {} });
    expect(d!.kpis).toBeNull();
  });

  it('treats kpis: null as absent', () => {
    // The pre-fix shape, kept covered so a rollback is caught by tests.
    expect(normaliseAiData({ ...FULL, kpis: null })!.kpis).toBeNull();
  });

  it('treats concentration: {} as absent', () => {
    expect(normaliseAiData({ ...FULL, concentration: {} })!.concentration).toBeNull();
  });

  it('survives a completely empty object', () => {
    const d = normaliseAiData({});
    expect(d).not.toBeNull();
    expect(d!.kpis).toBeNull();
    expect(d!.monthlyTrend).toEqual([]);
    expect(d!.anomalies).toEqual([]);
  });

  it('returns null for non-object input', () => {
    expect(normaliseAiData(null)).toBeNull();
    expect(normaliseAiData(undefined)).toBeNull();
    expect(normaliseAiData('nope')).toBeNull();
    expect(normaliseAiData([1, 2, 3])).toBeNull();
  });

  it('coerces numeric strings and drops non-finite values', () => {
    const d = normaliseAiData({
      ...FULL,
      kpis: { ...FULL.kpis, revenue_mtd: '12345.67', cash_balance: 'not a number' },
    });
    expect(d!.kpis?.revenue_mtd).toBeCloseTo(12345.67, 2);
    expect(d!.kpis?.cash_balance).toBe(0);
    expect(Number.isNaN(d!.kpis?.cash_balance)).toBe(false);
  });

  it('keeps genuinely-nullable ratios as null rather than 0', () => {
    // margin is undefined (not zero) when there is no revenue — the advisor
    // relies on this distinction to skip the signal entirely.
    const d = normaliseAiData({
      ...FULL,
      kpis: { ...FULL.kpis, profit_margin_pct: null, avg_days_to_pay: null, expense_ratio_pct: null },
    });
    expect(d!.kpis?.profit_margin_pct).toBeNull();
    expect(d!.kpis?.avg_days_to_pay).toBeNull();
    expect(d!.kpis?.expense_ratio_pct).toBeNull();
  });

  it('ignores malformed array entries instead of throwing', () => {
    const d = normaliseAiData({
      ...FULL,
      anomalies: [null, 'garbage', 42, { type: 'x', severity: 'high', description: 'ok' }],
    });
    expect(d!.anomalies).toHaveLength(1);
    expect(d!.anomalies[0].description).toBe('ok');
  });
});
