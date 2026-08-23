/**
 * Shared types for the Ledgr in-app assistants.
 *
 * Two assistants share one UI and one provider interface:
 *   • 'support' — how-to / troubleshooting / compliance from KNOWLEDGE_BASE.
 *   • 'ai'      — Ledgr AI: analysis, forecasting and advice over LIVE
 *                 company data (the v_ai_* views / ai_context()).
 *
 * Everything here is plain data so the same shapes can cross the wire to the
 * `ai-chat` Edge Function without translation.
 */

export type AssistantMode = 'support' | 'ai';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface KnowledgeArticle {
  id: string;
  topic: string;
  keywords: string[];
  body: string;
}

// ── Live data (mirrors public.ai_context(uuid) / the v_ai_* views) ───────────

/** One row of `v_ai_kpis` (month-to-date, MWK). */
export interface AiKpis {
  period_start: string;
  period_end: string;
  revenue_mtd: number;
  expenses_mtd: number;
  net_profit_mtd: number;
  profit_margin_pct: number | null;
  cash_balance: number;
  receivables_total: number;
  overdue_total: number;
  open_invoice_count: number;
  payables_total: number;
  avg_days_to_pay: number | null;
  expense_ratio_pct: number | null;
}

/** One row of `v_ai_monthly_trend`. */
export interface AiMonthlyTrend {
  /** 'YYYY-MM' */
  month: string;
  month_start: string;
  revenue: number;
  expenses: number;
  profit: number;
  cash_in: number;
  cash_out: number;
  net_cash: number;
  cumulative_cash: number;
}

/** One row of `v_ai_overdue_invoices`. */
export interface AiOverdueInvoice {
  invoice_id: string;
  invoice_number: string;
  customer: string;
  amount_outstanding: number;
  issue_date: string;
  due_date: string;
  days_overdue: number;
}

/** Aggregated `v_ai_top_expenses`. */
export interface AiTopExpense {
  category: string;
  account_code: string;
  amount: number;
  document_count: number;
  period_days: number;
}

/** One row of `v_ai_top_customers`. */
export interface AiTopCustomer {
  customer: string;
  revenue: number;
  invoice_count: number;
  last_invoice_date: string | null;
  outstanding: number;
  share_pct: number | null;
}

/** `v_ai_customer_concentration`. */
export interface AiConcentration {
  total_revenue: number;
  top_customer: string;
  top_customer_revenue: number;
  concentration_pct: number | null;
  customer_count: number;
}

export type AnomalySeverity = 'high' | 'medium' | 'low';

/** One row of `v_ai_anomalies`. */
export interface AiAnomaly {
  type: string;
  severity: AnomalySeverity;
  occurred_on: string;
  amount: number;
  reference: string;
  description: string;
}

/** One row of `v_ai_upcoming_receivables`. */
export interface AiUpcomingReceivable {
  invoice_id: string;
  invoice_number: string;
  customer: string;
  amount_outstanding: number;
  due_date: string;
  days_until_due: number;
  bucket: '0-30' | '30-60' | '60+';
}

/** One row of `v_ai_upcoming_payables`. */
export interface AiUpcomingPayable {
  source: 'bill' | 'payroll' | 'tax';
  label: string;
  counterparty: string;
  amount: number;
  due_date: string;
}

export interface AiCompany {
  id: string;
  name: string;
  currency: string | null;
  vat_registered: boolean | null;
  financial_year_start: string | null;
}

/** The whole `ai_context(business_id)` payload. */
export interface AiData {
  generated_at: string;
  company: AiCompany | null;
  kpis: AiKpis | null;
  monthlyTrend: AiMonthlyTrend[];
  overdueInvoices: AiOverdueInvoice[];
  topExpenses: AiTopExpense[];
  topCustomers: AiTopCustomer[];
  concentration: AiConcentration | null;
  anomalies: AiAnomaly[];
  upcomingReceivables: AiUpcomingReceivable[];
  upcomingPayables: AiUpcomingPayable[];
}

// ── Forecast ─────────────────────────────────────────────────────────────────

export interface ForecastCashFlowMonth {
  /** 'YYYY-MM' */
  month: string;
  projected_in: number;
  projected_out: number;
  projected_balance: number;
}

export interface ForecastPoint {
  month: string;
  projected: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Forecast {
  cashFlow: ForecastCashFlowMonth[];
  revenue: ForecastPoint[];
  expenses: ForecastPoint[];
  assumptions: string[];
  confidence: Confidence;
}

// ── Advice ───────────────────────────────────────────────────────────────────

export type AdviceRating = 'healthy' | 'watch' | 'danger';

export interface Advice {
  rating: AdviceRating;
  headline: string;
  insights: string[];
  actions: string[];
}

// ── Provider contract ────────────────────────────────────────────────────────

export interface DataContext {
  companyName?: string;
  data?: AiData;
  knowledgeBase?: KnowledgeArticle[];
  forecast?: Forecast;
}

export interface AIChartSeries {
  label: string;
  value: number;
}

export interface AIChart {
  title: string;
  kind: 'bar' | 'line';
  series: AIChartSeries[];
}

export interface AIAnswer {
  content: string;
  provider: string;
  suggestions?: string[];
  charts?: AIChart[];
}

export interface AIProvider {
  name: string;
  answer(messages: ChatMessage[], context: DataContext): Promise<AIAnswer>;
}
