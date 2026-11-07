import { describe, expect, it } from 'vitest';
import { analyzeFinancialHealth, calculateWorkingCapitalHealthScore, type FinancialSummaryInput } from '../financialSummary';

function financialInput(overrides: Partial<FinancialSummaryInput> = {}): FinancialSummaryInput {
  return {
    currency: 'MWK',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-30',
    cashBalance: 10_000,
    receivables: 900,
    payables: 600,
    trailingRevenue: 1_800,
    trailingSupplierSpend: 1_800,
    currentAssets: 2_000,
    currentLiabilities: 1_000,
    inventoryAndPrepaids: 600,
    dailyCashIn: 100,
    dailyCashOut: 200,
    cashHistoryDays: 90,
    currentRevenue: 2_000,
    priorRevenue: 1_800,
    currentGrossProfit: 1_000,
    priorGrossProfit: 900,
    currentOperatingExpenses: 110,
    priorOperatingExpenses: 100,
    topExpenseDriver: 'Transport',
    overdueInvoicesOver60Days: 2,
    overdueReceivables: [100],
    upcomingReceivables: [
      { amount: 200, daysUntilDue: 10 },
      { amount: 50, daysUntilDue: 85 },
    ],
    upcomingPayables: [
      { amount: 100, daysUntilDue: 30 },
      { amount: 50, daysUntilDue: 60 },
      { amount: 20, daysUntilDue: 90 },
    ],
    now: new Date('2026-10-30T12:00:00Z'),
    ...overrides,
  };
}

describe('deterministic executive financial summaries and cash runway', () => {
  it('calculates DSO, DPO, liquidity ratios, health score and 30/60/90 day cash projections', () => {
    const result = analyzeFinancialHealth(financialInput());

    expect(result.metrics).toMatchObject({
      cash_balance: 10_000,
      daily_net_burn_rate: 100,
      runway_days: 100,
      current_ratio: 2,
      quick_ratio: 1.4,
      dso_days: 45,
      dpo_days: 30,
      health_score: 95,
      projected_day_30_cash: 7_130,
      projected_day_60_cash: 4_110,
      projected_day_90_cash: 1_107.5,
    });
    expect(result.metrics.projections.map((point) => point.days)).toEqual([30, 60, 90]);
    expect(result.keyRisks).toContainEqual({ key: 'ai.summary.risks.agedReceivables', values: { count: 2 } });
    expect(result.recommendations).toContainEqual({ key: 'ai.summary.recommendations.followUpAgedReceivables', values: { count: 2 } });
    expect(result.executiveSummaryKey).toBe('ai.summary.generatedOverview');
  });

  it('returns null rather than non-finite ratios or runway when there is no data or net burn', () => {
    const result = analyzeFinancialHealth(financialInput({
      cashBalance: 0,
      receivables: 0,
      payables: 0,
      trailingRevenue: 0,
      trailingSupplierSpend: 0,
      currentAssets: 0,
      currentLiabilities: 0,
      inventoryAndPrepaids: 0,
      dailyCashIn: 0,
      dailyCashOut: 0,
      cashHistoryDays: 0,
      overdueInvoicesOver60Days: 0,
      overdueReceivables: [],
      upcomingReceivables: [],
      upcomingPayables: [],
    }));

    expect(result.metrics).toMatchObject({
      runway_days: null,
      current_ratio: null,
      quick_ratio: null,
      dso_days: null,
      dpo_days: null,
      health_score: 0,
      cash_history_days: 0,
    });
    expect(result.metrics.projections.every((point) => Number.isFinite(point.projected_ending_cash))).toBe(true);
    expect(result.keyRisks).toEqual([{ key: 'ai.summary.noMaterialRisks' }]);
  });

  it('uses only available indicators when calculating the 0–100 health index', () => {
    expect(calculateWorkingCapitalHealthScore({ current_ratio: 2, quick_ratio: 1.2, dso_days: 30, dpo_days: 30 })).toBe(100);
    expect(calculateWorkingCapitalHealthScore({ current_ratio: 2, quick_ratio: null, dso_days: null, dpo_days: null })).toBe(100);
    expect(calculateWorkingCapitalHealthScore({ current_ratio: null, quick_ratio: null, dso_days: null, dpo_days: null })).toBe(0);
  });
});
