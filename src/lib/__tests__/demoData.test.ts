import { describe, expect, it } from 'vitest';
import {
  DEMO_INVOICES,
  DEMO_KPIS,
  DEMO_TREND,
  demoNetCashFlow,
  demoProfitMargin,
} from '@/lib/demoData';

describe('demo sample books', () => {
  it('keeps income above expenses so the public tour shows a profitable month', () => {
    expect(DEMO_KPIS.totalIncome).toBeGreaterThan(DEMO_KPIS.totalExpenses);
    expect(demoNetCashFlow()).toBe(DEMO_KPIS.totalIncome - DEMO_KPIS.totalExpenses);
    expect(demoProfitMargin()).toBeGreaterThan(0);
    expect(demoProfitMargin()).toBeLessThanOrEqual(100);
  });

  it('ships six months of trend data and unpaid invoices matching the KPI', () => {
    expect(DEMO_TREND).toHaveLength(6);
    expect(DEMO_TREND.every((p) => p.income > 0 && p.expenses > 0)).toBe(true);
    const unpaid = DEMO_INVOICES.filter((i) => i.status !== 'paid').length;
    expect(unpaid).toBe(DEMO_KPIS.unpaidInvoiceCount);
  });
});
