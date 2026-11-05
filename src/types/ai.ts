import type { Json } from '@/dal/types/database';

export type AnomalySeverity = 'high' | 'medium' | 'low';

export type AnomalyCategory =
  | 'duplicate_invoice'
  | 'unallocated_cost_center'
  | 'missing_tax_tag'
  | 'amount_outlier'
  | 'payroll_variance';

export type AiAnomalySourceTable = 'expenses' | 'expense_lines' | 'journal_entries' | 'payroll_runs';

/** Stored ledger-health finding. Text columns contain ai.* translation keys. */
export interface AiAnomalyLog {
  id: string;
  business_id: string;
  category: AnomalyCategory;
  severity: AnomalySeverity;
  title: string;
  description: string;
  source_table: AiAnomalySourceTable | null;
  source_id: string | null;
  metadata: Json;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface DiagnosticScanResult {
  scanned: number;
  created: number;
  skippedExisting: number;
}

export interface WorkingCapitalMetrics {
  cash_balance: number;
  daily_net_burn_rate: number;
  runway_days: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  dso_days: number | null;
  dpo_days: number | null;
  cash_history_days: number;
  health_score: number;
}

export interface CashRunwayProjection {
  days: 30 | 60 | 90;
  starting_cash: number;
  expected_collections: number;
  expected_outflows: number;
  baseline_net_cash: number;
  projected_ending_cash: number;
}

export interface CashRunwayForecast {
  generated_at: string;
  currency: string;
  metrics: WorkingCapitalMetrics;
  projections: CashRunwayProjection[];
}

export interface FinancialSummaryMetrics extends WorkingCapitalMetrics {
  currency: string;
  current_revenue: number;
  prior_revenue: number;
  revenue_change_pct: number | null;
  gross_margin_pct: number | null;
  prior_gross_margin_pct: number | null;
  gross_margin_change_pp: number | null;
  current_operating_expenses: number;
  prior_operating_expenses: number;
  operating_expense_change_pct: number | null;
  top_expense_driver: string | null;
  projected_day_30_cash: number;
  projected_day_60_cash: number;
  projected_day_90_cash: number;
  projections: CashRunwayProjection[];
}

export interface AiSummaryBullet {
  key: string;
  values?: Record<string, string | number>;
}

/** Persisted deterministic summary; fields hold ai.summary.* keys and JSON interpolation values. */
export interface AiFinancialSummary {
  id: string;
  business_id: string;
  period_start: string;
  period_end: string;
  health_score: number;
  executive_summary: string;
  key_risks: AiSummaryBullet[];
  recommendations: AiSummaryBullet[];
  metrics: FinancialSummaryMetrics;
  created_at: string;
}
