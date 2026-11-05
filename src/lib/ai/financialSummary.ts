import type { AiSummaryBullet, CashRunwayProjection, FinancialSummaryMetrics, WorkingCapitalMetrics } from '@/types/ai';

export interface FinancialSummaryInput {
  currency: string;
  periodStart: string;
  periodEnd: string;
  cashBalance: number;
  receivables: number;
  payables: number;
  trailingRevenue: number;
  trailingSupplierSpend: number;
  currentAssets: number;
  currentLiabilities: number;
  inventoryAndPrepaids: number;
  dailyCashIn: number;
  dailyCashOut: number;
  cashHistoryDays: number;
  currentRevenue: number;
  priorRevenue: number;
  currentGrossProfit: number;
  priorGrossProfit: number;
  currentOperatingExpenses: number;
  priorOperatingExpenses: number;
  topExpenseDriver: string | null;
  overdueInvoicesOver60Days: number;
  overdueReceivables: number[];
  upcomingReceivables: Array<{ amount: number; daysUntilDue: number }>;
  upcomingPayables: Array<{ amount: number; daysUntilDue: number }>;
  now?: Date;
}

export interface FinancialSummaryAnalysis {
  metrics: FinancialSummaryMetrics;
  executiveSummaryKey: string;
  keyRisks: AiSummaryBullet[];
  recommendations: AiSummaryBullet[];
}

const PROJECTION_DAYS = [30, 60, 90] as const;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function changePercent(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

function scoreCurrentRatio(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 2) return 100;
  if (value >= 1.5) return 85;
  if (value >= 1) return 65;
  if (value >= 0.5) return 35;
  return 0;
}

function scoreQuickRatio(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 1.2) return 100;
  if (value >= 1) return 85;
  if (value >= 0.7) return 60;
  if (value >= 0.4) return 30;
  return 0;
}

function scoreDso(value: number | null): number | null {
  if (value === null) return null;
  if (value <= 30) return 100;
  if (value <= 45) return 80;
  if (value <= 60) return 60;
  if (value <= 90) return 30;
  return 0;
}

function scoreDpo(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 30 && value <= 60) return 100;
  if (value >= 15 && value <= 90) return 80;
  if (value < 15) return 60;
  if (value <= 120) return 45;
  return 15;
}

/** Weighted 0–100 score, re-scaled over metrics available for a new business. */
export function calculateWorkingCapitalHealthScore(metrics: Pick<WorkingCapitalMetrics, 'current_ratio' | 'quick_ratio' | 'dso_days' | 'dpo_days'>): number {
  const components = [
    { value: scoreCurrentRatio(metrics.current_ratio), weight: 30 },
    { value: scoreQuickRatio(metrics.quick_ratio), weight: 25 },
    { value: scoreDso(metrics.dso_days), weight: 25 },
    { value: scoreDpo(metrics.dpo_days), weight: 20 },
  ].filter((component): component is { value: number; weight: number } => component.value !== null);
  const possibleWeight = components.reduce((sum, component) => sum + component.weight, 0);
  if (possibleWeight === 0) return 0;
  return Math.round(components.reduce((sum, component) => sum + component.value * component.weight, 0) / possibleWeight);
}

function expectedCollections(input: FinancialSummaryInput, days: number): number {
  const overdueFactor = days <= 30 ? 0.6 : 0.9;
  const overdue = input.overdueReceivables.reduce((sum, amount) => sum + Math.max(0, finite(amount)), 0) * overdueFactor;
  const scheduled = input.upcomingReceivables.reduce((sum, item) => {
    const dueIn = finite(item.daysUntilDue);
    const amount = Math.max(0, finite(item.amount));
    if (dueIn < 0 || dueIn > days) return sum;
    const collectionRate = dueIn <= 30 ? 0.85 : dueIn <= 60 ? 0.5 : 0.35;
    return sum + amount * collectionRate;
  }, 0);
  return overdue + scheduled;
}

function expectedOutflows(input: FinancialSummaryInput, days: number): number {
  return input.upcomingPayables.reduce((sum, item) => {
    const dueIn = finite(item.daysUntilDue);
    return dueIn <= days ? sum + Math.max(0, finite(item.amount)) : sum;
  }, 0);
}

function makeBullet(key: string, values?: Record<string, string | number>): AiSummaryBullet {
  return values ? { key, values } : { key };
}

/** Deterministic working-capital ratios, runway, forecast, risks and commentary keys. */
export function analyzeFinancialHealth(input: FinancialSummaryInput): FinancialSummaryAnalysis {
  const currentAssets = Math.max(0, finite(input.currentAssets));
  const currentLiabilities = Math.max(0, finite(input.currentLiabilities));
  const cashBalance = finite(input.cashBalance);
  const dailyCashIn = Math.max(0, finite(input.dailyCashIn));
  const dailyCashOut = Math.max(0, finite(input.dailyCashOut));
  const dailyNetBurnRate = Math.max(0, dailyCashOut - dailyCashIn);
  const runwayDays = dailyNetBurnRate > 0 ? Math.max(0, cashBalance) / dailyNetBurnRate : null;
  const currentRatio = safeRatio(currentAssets, currentLiabilities);
  const quickRatio = safeRatio(Math.max(0, currentAssets - Math.max(0, finite(input.inventoryAndPrepaids))), currentLiabilities);
  const dsoDays = safeRatio(Math.max(0, finite(input.receivables)) * 90, input.trailingRevenue);
  const dpoDays = safeRatio(Math.max(0, finite(input.payables)) * 90, input.trailingSupplierSpend);

  const workingCapital: WorkingCapitalMetrics = {
    cash_balance: cashBalance,
    daily_net_burn_rate: dailyNetBurnRate,
    runway_days: runwayDays,
    current_ratio: currentRatio,
    quick_ratio: quickRatio,
    dso_days: dsoDays,
    dpo_days: dpoDays,
    cash_history_days: Math.max(0, Math.trunc(finite(input.cashHistoryDays))),
    health_score: calculateWorkingCapitalHealthScore({
      current_ratio: currentRatio,
      quick_ratio: quickRatio,
      dso_days: dsoDays,
      dpo_days: dpoDays,
    }),
  };

  const netDailyCashFlow = dailyCashIn - dailyCashOut;
  const projections: CashRunwayProjection[] = PROJECTION_DAYS.map((days) => {
    const collections = expectedCollections(input, days);
    const outflows = expectedOutflows(input, days);
    const baselineNetCash = netDailyCashFlow * days;
    return {
      days,
      starting_cash: cashBalance,
      expected_collections: collections,
      expected_outflows: outflows,
      baseline_net_cash: baselineNetCash,
      projected_ending_cash: cashBalance + baselineNetCash + collections - outflows,
    };
  });

  const revenueChange = changePercent(input.currentRevenue, input.priorRevenue);
  const currentMargin = safeRatio(input.currentGrossProfit * 100, input.currentRevenue);
  const priorMargin = safeRatio(input.priorGrossProfit * 100, input.priorRevenue);
  const marginChange = currentMargin !== null && priorMargin !== null ? currentMargin - priorMargin : null;
  const expenseChange = changePercent(input.currentOperatingExpenses, input.priorOperatingExpenses);

  const metrics: FinancialSummaryMetrics = {
    ...workingCapital,
    currency: input.currency,
    current_revenue: finite(input.currentRevenue),
    prior_revenue: finite(input.priorRevenue),
    revenue_change_pct: revenueChange,
    gross_margin_pct: currentMargin,
    prior_gross_margin_pct: priorMargin,
    gross_margin_change_pp: marginChange,
    current_operating_expenses: finite(input.currentOperatingExpenses),
    prior_operating_expenses: finite(input.priorOperatingExpenses),
    operating_expense_change_pct: expenseChange,
    top_expense_driver: input.topExpenseDriver,
    projected_day_30_cash: projections[0].projected_ending_cash,
    projected_day_60_cash: projections[1].projected_ending_cash,
    projected_day_90_cash: projections[2].projected_ending_cash,
    projections,
  };

  const risks: AiSummaryBullet[] = [];
  const recommendations: AiSummaryBullet[] = [];
  if (currentRatio !== null && currentRatio < 1) {
    risks.push(makeBullet('ai.summary.risks.lowLiquidity'));
    recommendations.push(makeBullet('ai.summary.recommendations.improveLiquidity'));
  }
  if (runwayDays !== null && runwayDays < 90) {
    risks.push(makeBullet('ai.summary.risks.shortRunway'));
    recommendations.push(makeBullet('ai.summary.recommendations.protectRunway'));
  }
  if (dsoDays !== null && dsoDays > 60) {
    risks.push(makeBullet('ai.summary.risks.slowCollections'));
    recommendations.push(makeBullet('ai.summary.recommendations.followUpCollections'));
  }
  if (marginChange !== null && marginChange < -5) {
    risks.push(makeBullet('ai.summary.risks.marginDecline'));
    recommendations.push(makeBullet('ai.summary.recommendations.reviewMargins'));
  }
  if (expenseChange !== null && expenseChange > 15) {
    risks.push(makeBullet('ai.summary.risks.expenseGrowth'));
    recommendations.push(makeBullet('ai.summary.recommendations.reviewExpenseDriver'));
  }
  if (input.overdueInvoicesOver60Days > 0) {
    risks.push(makeBullet('ai.summary.risks.agedReceivables', { count: input.overdueInvoicesOver60Days }));
    recommendations.push(makeBullet('ai.summary.recommendations.followUpAgedReceivables', { count: input.overdueInvoicesOver60Days }));
  }
  if (risks.length === 0) risks.push(makeBullet('ai.summary.noMaterialRisks'));
  if (recommendations.length === 0) recommendations.push(makeBullet('ai.summary.recommendations.maintainDiscipline'));

  return {
    metrics,
    executiveSummaryKey: 'ai.summary.generatedOverview',
    keyRisks: risks,
    recommendations,
  };
}
