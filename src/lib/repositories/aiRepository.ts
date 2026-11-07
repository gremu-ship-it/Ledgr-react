import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/dal/types/database';
import type { AiAnomalyLog, AiFinancialSummary, CashRunwayForecast, DiagnosticScanResult, FinancialSummaryMetrics, WorkingCapitalMetrics } from '@/types/ai';
import { detectLedgerAnomalies, type AnomalyScanInput } from '@/lib/ai/anomalyDetection';
import { analyzeFinancialHealth, type FinancialSummaryInput } from '@/lib/ai/financialSummary';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { normaliseAiData } from '@/lib/ai/context';

const PAGE_SIZE = 500;
const PAGE_CAP = 10_000;
const DUPLICATE_LOOKBACK_DAYS = 90;
const PAYROLL_LOOKBACK_DAYS = 730;

async function readPages<T>(load: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < PAGE_CAP; from += PAGE_SIZE) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function cutoff(days: number, reference = new Date()): string {
  return new Date(reference.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function monthLength(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return Number.isFinite(year) && Number.isFinite(monthNumber)
    ? new Date(year, monthNumber, 0).getDate()
    : 30;
}

function recentDailyCashRate(trends: Array<{ month: string; cash_in: number; cash_out: number }>, key: 'cash_in' | 'cash_out', now: Date): { daily: number; historyDays: number } {
  const currentMonth = now.toISOString().slice(0, 7);
  const complete = trends.filter((item) => item.month < currentMonth).sort((a, b) => a.month.localeCompare(b.month));
  const selected = (complete.length > 0 ? complete : [...trends].sort((a, b) => a.month.localeCompare(b.month))).slice(-3);
  const historyDays = selected.reduce((sum, item) => sum + monthLength(item.month), 0);
  if (historyDays === 0) return { daily: 0, historyDays: 0 };
  return { daily: selected.reduce((sum, item) => sum + Number(item[key] || 0), 0) / historyDays, historyDays };
}

function daysUntil(dateValue: string, reference: Date): number {
  const due = new Date(`${dateValue}T00:00:00Z`).getTime();
  const today = new Date(`${reference.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(due) ? Math.ceil((due - today) / 86_400_000) : 0;
}

function asJsonRecord(value: Json): Record<string, Json | undefined> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : null;
}

function parseSummaryBullets(value: Json): AiFinancialSummary['key_risks'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asJsonRecord(item);
    if (!record || typeof record.key !== 'string') return [];
    const rawValues = asJsonRecord(record.values as Json);
    const values = rawValues
      ? Object.fromEntries(Object.entries(rawValues).filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number'))
      : undefined;
    return [{ key: record.key, ...(values ? { values } : {}) }];
  });
}

function parseFinancialMetrics(value: Json): FinancialSummaryMetrics {
  return (asJsonRecord(value) ?? {}) as unknown as FinancialSummaryMetrics;
}

function parseSummary(row: Database['public']['Tables']['ai_financial_summaries']['Row']): AiFinancialSummary {
  return {
    ...row,
    key_risks: parseSummaryBullets(row.key_risks),
    recommendations: parseSummaryBullets(row.recommendations),
    metrics: parseFinancialMetrics(row.metrics),
  };
}

export class AiRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database> = supabase) {
    this.client = client;
  }

  async getAnomalies(businessId: string): Promise<AiAnomalyLog[]> {
    const { data, error } = await this.client
      .from('ai_anomaly_logs')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as AiAnomalyLog[];
  }

  async runDiagnosticScan(businessId: string): Promise<DiagnosticScanResult> {
    if (!businessId) throw new Error('A business is required to run diagnostics.');
    const input = await this.loadScanInput(businessId);
    const detections = detectLedgerAnomalies(input);
    if (detections.length === 0) return { scanned: 0, created: 0, skippedExisting: 0 };

    const payload = detections.map((detection) => ({
      category: detection.category,
      severity: detection.severity,
      title: detection.title,
      description: detection.description,
      source_table: detection.source_table,
      source_id: detection.source_id,
      metadata: detection.metadata,
    })) as unknown as Json;
    const { data, error } = await this.client.rpc('run_ai_anomaly_scan', {
      p_business_id: businessId,
      p_anomalies: payload,
    });
    if (error) throw new Error(error.message);
    const created = Number(data ?? 0);
    return { scanned: detections.length, created, skippedExisting: Math.max(0, detections.length - created) };
  }

  async resolveAnomaly(anomalyId: string, userId: string): Promise<AiAnomalyLog> {
    if (!anomalyId || !userId) throw new Error('A finding and authenticated user are required.');
    const { data: authData, error: authError } = await this.client.auth.getUser();
    if (authError) throw new Error(authError.message);
    if (!authData.user || authData.user.id !== userId) throw new Error('The resolving user must match the authenticated session.');

    const { data, error } = await this.client
      .from('ai_anomaly_logs')
      .update({ is_resolved: true, resolved_at: new Date().toISOString(), resolved_by: authData.user.id })
      .eq('id', anomalyId)
      .eq('is_resolved', false)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('The anomaly was already resolved or is not available in this business.');
    return data as AiAnomalyLog;
  }

  async getLatestFinancialSummary(businessId: string): Promise<AiFinancialSummary | null> {
    await this.assertFinancialSummaryAccess(businessId);
    const { data, error } = await this.client
      .from('ai_financial_summaries')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? parseSummary(data) : null;
  }

  async generateFinancialSummary(businessId: string): Promise<AiFinancialSummary> {
    await this.assertFinancialSummaryAccess(businessId);
    const { periodStart, periodEnd, analysis } = await this.buildFinancialAnalysis(businessId);
    const { data, error } = await this.client
      .from('ai_financial_summaries')
      .insert({
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        health_score: analysis.metrics.health_score,
        executive_summary: analysis.executiveSummaryKey,
        key_risks: analysis.keyRisks as unknown as Json,
        recommendations: analysis.recommendations as unknown as Json,
        metrics: analysis.metrics as unknown as Json,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return parseSummary(data);
  }

  async calculateCashRunway(businessId: string): Promise<CashRunwayForecast> {
    await this.assertFinancialSummaryAccess(businessId);
    const { analysis } = await this.buildFinancialAnalysis(businessId);
    const metrics: WorkingCapitalMetrics = {
      cash_balance: analysis.metrics.cash_balance,
      daily_net_burn_rate: analysis.metrics.daily_net_burn_rate,
      runway_days: analysis.metrics.runway_days,
      current_ratio: analysis.metrics.current_ratio,
      quick_ratio: analysis.metrics.quick_ratio,
      dso_days: analysis.metrics.dso_days,
      dpo_days: analysis.metrics.dpo_days,
      cash_history_days: analysis.metrics.cash_history_days,
      health_score: analysis.metrics.health_score,
    };
    return {
      generated_at: new Date().toISOString(),
      currency: analysis.metrics.currency,
      metrics,
      projections: analysis.metrics.projections,
    };
  }

  private async assertFinancialSummaryAccess(businessId: string): Promise<void> {
    if (!businessId) throw new Error('A business is required for financial intelligence.');
    const { data, error } = await this.client.rpc('can_access_ai_financial_summaries', { p_business_id: businessId });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Financial intelligence requires an active Enterprise business membership.');
  }

  private async buildFinancialAnalysis(businessId: string): Promise<{ periodStart: string; periodEnd: string; analysis: ReturnType<typeof analyzeFinancialHealth> }> {
    const now = new Date();
    const periodEnd = now.toISOString().slice(0, 10);
    const periodStart = cutoff(29, now);
    const priorPeriodEnd = cutoff(30, now);
    const priorPeriodStart = cutoff(59, now);
    const trailingStart = cutoff(89, now);
    const statements = new FinancialStatementRepository(this.client);

    const [contextResult, periodProfitAndLoss, trailingProfitAndLoss, position, cashBalance] = await Promise.all([
      this.client.rpc('ai_context', { p_business_id: businessId }),
      statements.getProfitOrLoss(businessId, periodStart, periodEnd, priorPeriodStart, priorPeriodEnd),
      statements.getProfitOrLoss(businessId, trailingStart, periodEnd),
      statements.getSOFP(businessId, periodEnd),
      statements.getCashPosition(businessId, periodEnd),
    ]);
    if (contextResult.error) throw new Error(contextResult.error.message);
    const aiData = normaliseAiData(contextResult.data);

    const currentAssets = position.currentAssets.subtotal;
    const currentLiabilities = position.currentLiabilities.subtotal;
    const nonQuickAssetAmount = position.currentAssets.lines
      .filter((line) => /^114|^1150/.test(line.code) || /inventory|inventor|stock|work in progress|prepaid/i.test(line.name))
      .reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0);
    const fallbackReceivables = position.currentAssets.lines
      .filter((line) => /^113/.test(line.code) || /receivable|debtor/i.test(line.name))
      .reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const fallbackPayables = position.currentLiabilities.lines
      .filter((line) => /^211/.test(line.code) || /payable|creditor/i.test(line.name))
      .reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const receivables = aiData?.kpis?.receivables_total ?? fallbackReceivables;
    const payables = aiData?.kpis?.payables_total ?? fallbackPayables;
    const cashIn = recentDailyCashRate(aiData?.monthlyTrend ?? [], 'cash_in', now);
    const cashOut = recentDailyCashRate(aiData?.monthlyTrend ?? [], 'cash_out', now);
    const trailingSupplierSpend = trailingProfitAndLoss.totalCostOfSales + trailingProfitAndLoss.totalOperatingExpenses;

    const expenseDrivers = periodProfitAndLoss.operatingExpenses.lines
      .map((line) => ({ line, increase: line.amount - (line.comparativeAmount ?? 0) }))
      .filter(({ increase }) => increase > 0)
      .sort((a, b) => b.increase - a.increase);
    const topExpenseDriver = expenseDrivers[0]?.line.name ?? null;
    const overdueInvoices = aiData?.overdueInvoices ?? [];
    const overdueInvoicesOver60Days = new Set(
      overdueInvoices.filter((invoice) => invoice.days_overdue > 60).map((invoice) => invoice.customer),
    ).size;

    const input: FinancialSummaryInput = {
      currency: aiData?.company?.currency || 'MWK',
      periodStart,
      periodEnd,
      cashBalance,
      receivables,
      payables,
      trailingRevenue: trailingProfitAndLoss.totalRevenue,
      trailingSupplierSpend,
      currentAssets,
      currentLiabilities,
      inventoryAndPrepaids: nonQuickAssetAmount,
      dailyCashIn: cashIn.daily,
      dailyCashOut: cashOut.daily,
      cashHistoryDays: Math.max(cashIn.historyDays, cashOut.historyDays),
      currentRevenue: periodProfitAndLoss.totalRevenue,
      priorRevenue: periodProfitAndLoss.comparativeTotalRevenue ?? 0,
      currentGrossProfit: periodProfitAndLoss.grossProfit,
      priorGrossProfit: periodProfitAndLoss.comparativeGrossProfit ?? 0,
      currentOperatingExpenses: periodProfitAndLoss.totalOperatingExpenses,
      priorOperatingExpenses: periodProfitAndLoss.comparativeTotalOperatingExpenses ?? 0,
      topExpenseDriver,
      overdueInvoicesOver60Days,
      overdueReceivables: overdueInvoices.map((invoice) => invoice.amount_outstanding),
      upcomingReceivables: (aiData?.upcomingReceivables ?? []).map((invoice) => ({
        amount: invoice.amount_outstanding,
        daysUntilDue: invoice.days_until_due,
      })),
      upcomingPayables: (aiData?.upcomingPayables ?? []).map((payable) => ({
        amount: payable.amount,
        daysUntilDue: daysUntil(payable.due_date, now),
      })),
      now,
    };
    return { periodStart, periodEnd, analysis: analyzeFinancialHealth(input) };
  }

  private async loadScanInput(businessId: string): Promise<AnomalyScanInput> {
    const duplicateSince = cutoff(DUPLICATE_LOOKBACK_DAYS);
    const payrollSince = cutoff(PAYROLL_LOOKBACK_DAYS);

    const [expenseRows, journalRows, payrollRows] = await Promise.all([
      readPages(async (from, to) => await this.client.from('expenses')
        .select('id, expense_number, expense_date, total_amount, currency, contact_id')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .neq('status', 'void')
        .gte('expense_date', duplicateSince)
        .order('expense_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
      readPages(async (from, to) => await this.client.from('journal_entries')
        .select('id, entry_date, entry_number, description')
        .eq('business_id', businessId)
        .eq('status', 'posted')
        .gte('entry_date', duplicateSince)
        .order('entry_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
      readPages(async (from, to) => await this.client.from('payroll_runs')
        .select('id, pay_date, run_number, total_gross')
        .eq('business_id', businessId)
        .in('status', ['approved', 'paid'])
        .gte('pay_date', payrollSince)
        .order('pay_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    ]);

    const supplierIds = [...new Set(expenseRows.flatMap((expense) => expense.contact_id ? [expense.contact_id] : []))];
    const supplierNames = new Map<string, string>();
    for (const ids of chunks(supplierIds, 200)) {
      const { data, error } = await this.client.from('contacts').select('id, name').eq('business_id', businessId).in('id', ids);
      if (error) throw new Error(error.message);
      for (const contact of data ?? []) supplierNames.set(contact.id, contact.name);
    }

    const expenseIds = expenseRows.map((expense) => expense.id);
    const expenseLines = (await Promise.all(chunks(expenseIds, 200).map(async (ids) => {
      if (ids.length === 0) return [];
      return readPages(async (from, to) => await this.client.from('expense_lines')
        .select('id, expense_id, line_total, tax_amount, tax_code')
        .eq('business_id', businessId)
        .in('expense_id', ids)
        .range(from, to));
    }))).flat();

    const journalEntryIds = journalRows.map((entry) => entry.id);
    const journalLineRows = (await Promise.all(chunks(journalEntryIds, 200).map(async (ids) => {
      if (ids.length === 0) return [];
      return readPages(async (from, to) => await this.client.from('journal_lines')
        .select('id, journal_entry_id, account_id, amount_base, is_debit, department_id, tax_amount, tax_code')
        .eq('business_id', businessId)
        .in('journal_entry_id', ids)
        .range(from, to));
    }))).flat();

    const accountIds = [...new Set(journalLineRows.map((line) => line.account_id))];
    const accountNames = new Map<string, string>();
    for (const ids of chunks(accountIds, 200)) {
      const { data, error } = await this.client.from('accounts').select('id, code, name').eq('business_id', businessId).in('id', ids);
      if (error) throw new Error(error.message);
      for (const account of data ?? []) accountNames.set(account.id, `${account.code} ${account.name}`.trim());
    }

    return {
      expenses: expenseRows.map((expense) => ({
        id: expense.id,
        expense_number: expense.expense_number,
        expense_date: expense.expense_date,
        total_amount: Number(expense.total_amount ?? 0),
        currency: expense.currency,
        contact_id: expense.contact_id,
        supplier_name: expense.contact_id ? supplierNames.get(expense.contact_id) ?? null : null,
      })),
      expenseLines: expenseLines.map((line) => ({
        id: line.id,
        expense_id: line.expense_id,
        line_total: Number(line.line_total ?? 0),
        tax_amount: Number(line.tax_amount ?? 0),
        tax_code: line.tax_code,
      })),
      journalEntries: journalRows.map((entry) => ({
        id: entry.id,
        entry_date: entry.entry_date,
        entry_number: entry.entry_number,
        description: entry.description,
      })),
      journalLines: journalLineRows.map((line) => ({
        id: line.id,
        journal_entry_id: line.journal_entry_id,
        account_id: line.account_id,
        account_name: accountNames.get(line.account_id) ?? line.account_id,
        amount_base: Number(line.amount_base ?? 0),
        is_debit: line.is_debit,
        department_id: line.department_id,
        tax_amount: Number(line.tax_amount ?? 0),
        tax_code: line.tax_code,
      })),
      payrollRuns: payrollRows.map((run) => ({
        id: run.id,
        pay_date: run.pay_date,
        run_number: run.run_number,
        total_gross: Number(run.total_gross ?? 0),
      })),
    };
  }
}

export const aiRepository = new AiRepository();
