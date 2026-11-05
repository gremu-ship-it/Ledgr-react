import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/dal/types/database';
import type { AiAnomalyLog, DiagnosticScanResult } from '@/types/ai';
import { detectLedgerAnomalies, type AnomalyScanInput } from '@/lib/ai/anomalyDetection';

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

function cutoff(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
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
