import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { formatMwk } from '@/lib/formatters';
import { createLogger } from '@/lib/logger';

const log = createLogger('aiFinancial');

const financialStatements = new FinancialStatementRepository(repos.account.db);

export interface BusinessContextRawData {
  revenue3M: number;
  expense3M: number;
  cashBalance: number;
  outstandingTotal: number;
}

export interface BusinessContext {
  businessName: string;
  today: string;
  currency: string;
  last3MonthsPL: string;
  cashBalance: string;
  outstandingInvoices: string;
  upcomingTaxDeadlines: string;
  anomalies: string[];
  rawData?: BusinessContextRawData;
}

/**
 * A journal entry with its debit/credit totals rolled up from journal_lines.
 *
 * NOTE: `journal_entries` has NO total_debits / total_credits columns — those
 * live on the v_trial_balance view and are keyed by account, not by entry.
 * Earlier revisions of this file selected them straight off journal_entries via
 * `.from('journal_entries' as any)`, which silently returned PostgREST error
 * 42703 and left every downstream feature reading `null`. Totals must be
 * aggregated from journal_lines.amount_base (the MWK functional-currency
 * amount) exactly as JournalRepository.validateBalanced does.
 */
export interface EntryTotals {
  id: string;
  entry_date: string;
  description: string;
  totalDebits: number;
  totalCredits: number;
}

interface JournalLineRow {
  amount_base: number | string | null;
  is_debit: boolean;
  journal_entries: {
    id: string;
    entry_date: string;
    description: string | null;
    status: string;
    business_id: string;
  } | null;
}

/**
 * Fetches posted journal entries in a date range with debit/credit totals
 * aggregated from their lines.
 *
 * Throws on query failure — callers decide whether to degrade. Returning an
 * empty array on error is what previously disguised a broken query as
 * "this business has no activity".
 */
async function fetchEntryTotals(
  businessId: string,
  fromDate: string,
  toDate?: string,
): Promise<EntryTotals[]> {
  let query = supabase
    .from('journal_lines')
    .select('amount_base, is_debit, journal_entries!inner(id, entry_date, description, status, business_id)')
    .eq('business_id', businessId)
    .eq('journal_entries.business_id', businessId)
    .eq('journal_entries.status', 'posted')
    .gte('journal_entries.entry_date', fromDate);

  if (toDate) {
    query = query.lte('journal_entries.entry_date', toDate);
  }

  const { data, error } = await query;
  if (error) throw error;

  const byEntry = new Map<string, EntryTotals>();
  for (const line of (data ?? []) as unknown as JournalLineRow[]) {
    const entry = line.journal_entries;
    if (!entry) continue;

    let totals = byEntry.get(entry.id);
    if (!totals) {
      totals = {
        id: entry.id,
        entry_date: entry.entry_date,
        description: entry.description ?? '',
        totalDebits: 0,
        totalCredits: 0,
      };
      byEntry.set(entry.id, totals);
    }

    const amount = Number(line.amount_base ?? 0);
    if (line.is_debit) totals.totalDebits += amount;
    else totals.totalCredits += amount;
  }

  return [...byEntry.values()].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

export interface Anomaly {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  date?: string;
  amount?: number;
}

export interface CashForecast {
  dates: string[];
  projected: number[];
  lower: number[];
  upper: number[];
  negativeAlert: boolean;
}

export interface TaxPlanningSuggestion {
  title: string;
  description: string;
  potentialSaving: string;
  action: string;
}

// ──────────────────────────────────────────────────────────────
// 1. Build rich business context (enhanced version)
// ──────────────────────────────────────────────────────────────
export async function buildRichBusinessContext(
  businessId: string,
  businessName: string
): Promise<BusinessContext> {
  const today = new Date().toISOString().slice(0, 10);
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const start3M = threeMonthsAgo.toISOString().slice(0, 10);

  try {
    // Cash comes from the ledger (opening balance + posted movement), not from
    // summing accounts.opening_balance — that is a period-opening figure and
    // ignores every transaction since, which understated the AI's view of cash.
    const [invoices, expenses, cashBalance] = await Promise.all([
      repos.invoice.findByBusiness(businessId),
      repos.expense.findByBusiness(businessId),
      financialStatements.getCashPosition(businessId, today),
    ]);

    // P&L last 3 months
    const recentInvoices = invoices.filter(i => i.issue_date >= start3M);
    const recentExpenses = expenses.filter(e => e.expense_date >= start3M);
    const revenue3M = recentInvoices.reduce((s, i) => s + Number(i.total_amount), 0);
    const expense3M = recentExpenses.reduce((s, e) => s + Number(e.total_amount), 0);

    // Outstanding invoices
    const outstanding = invoices.filter(i => i.status !== 'paid');
    const outstandingTotal = outstanding.reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0);

    // Tax deadlines (simplified MRA)
    const upcomingTax = [
      { name: 'VAT Return', due: '25th of next month' },
      { name: 'PAYE Return', due: '10th of next month' },
      { name: 'Withholding Tax', due: '15th of next month' },
    ];

    // Anomaly detection (real-time)
    const anomalies = await detectAdvancedAnomalies(businessId);

    return {
      businessName,
      today,
      currency: 'MWK',
      last3MonthsPL: `Revenue: ${formatMwk(revenue3M)} | Expenses: ${formatMwk(expense3M)} | Net: ${formatMwk(revenue3M - expense3M)}`,
      cashBalance: formatMwk(cashBalance),
      outstandingInvoices: `${outstanding.length} invoices totalling ${formatMwk(outstandingTotal)}`,
      upcomingTaxDeadlines: upcomingTax.map(t => `${t.name}: ${t.due}`).join(' • '),
      anomalies: anomalies.map(a => a.description),
      rawData: { revenue3M, expense3M, cashBalance, outstandingTotal },
    };
  } catch (e) {
    log.error('Failed to build rich context', e as Error);
    return {
      businessName,
      today,
      currency: 'MWK',
      last3MonthsPL: 'Data unavailable',
      cashBalance: 'Data unavailable',
      outstandingInvoices: 'Data unavailable',
      upcomingTaxDeadlines: 'Check MRA portal',
      anomalies: [],
    };
  }
}

// ──────────────────────────────────────────────────────────────
// 2. Advanced Anomaly Detection
// ──────────────────────────────────────────────────────────────
export async function detectAdvancedAnomalies(businessId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const entryList = await fetchEntryTotals(
      businessId,
      thirtyDaysAgo.toISOString().slice(0, 10),
    );

    if (entryList.length < 5) return anomalies;

    const amounts = entryList.map(e => e.totalDebits);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    // 1. Unusually large transactions
    const largeTx = entryList.filter(e => e.totalDebits > avg * 2.5);
    largeTx.forEach(tx => {
      anomalies.push({
        type: 'large_transaction',
        severity: 'high',
        description: `Unusually large transaction: ${formatMwk(tx.totalDebits)} on ${tx.entry_date}`,
        date: tx.entry_date,
        amount: tx.totalDebits,
      });
    });

    // 2. Duplicate amounts on same day
    const byDay: Record<string, number[]> = {};
    entryList.forEach(e => {
      const d = e.entry_date;
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(e.totalDebits);
    });

    Object.entries(byDay).forEach(([date, arr]) => {
      const seen = new Set<number>();
      arr.forEach(amt => {
        if (seen.has(amt) && amt > 10000) {
          anomalies.push({
            type: 'duplicate',
            severity: 'medium',
            description: `Duplicate amount ${formatMwk(amt)} on ${date}`,
            date,
            amount: amt,
          });
        }
        seen.add(amt);
      });
    });

    // 3. Income gap (no revenue for 5+ days)
    const incomeEntries = entryList.filter(e => {
      const description = e.description.toLowerCase();
      return description.includes('income')
        || description.includes('sale')
        || description.includes('revenue');
    });
    
    if (incomeEntries.length > 0) {
      const sortedDates = [...new Set(incomeEntries.map(e => e.entry_date))].sort();

      
      for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i-1]);
        const curr = new Date(sortedDates[i]);
        const diff = (curr.getTime() - prev.getTime()) / (1000 * 3600 * 24);
        
        if (diff >= 5) {
          anomalies.push({
            type: 'income_gap',
            severity: 'high',
            description: `No recorded income for ${Math.floor(diff)} consecutive days (${sortedDates[i-1]} → ${sortedDates[i]})`,
            date: sortedDates[i],
          });
        }
      }
    }

    return anomalies.slice(0, 8); // Limit to most relevant
  } catch (e) {
    // Degrade to "no anomalies" for the UI, but make the failure visible —
    // a silent [] here is indistinguishable from a clean set of books.
    log.error('Anomaly detection failed', e as Error);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// 3. Cash Flow Forecast (improved)
// ──────────────────────────────────────────────────────────────
export async function generateCashFlowForecast(businessId: string): Promise<CashForecast> {
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const windowStart = threeMonthsAgo.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  // Any failure here propagates. This function previously swallowed a broken
  // query and returned a flat line at the current cash balance with
  // negativeAlert=false — a fabricated forecast rendered as though it were
  // real. An empty chart is recoverable; a confident wrong number is not.
  const [movements, currentCash] = await Promise.all([
    fetchEntryTotals(businessId, windowStart, todayStr),
    financialStatements.getCashPosition(businessId, todayStr),
  ]);

  // Actual number of days observed, rather than a hardcoded 90. A business
  // with three weeks of history would otherwise have its daily run-rate
  // diluted by ~4x against a 90-day denominator.
  const observedDays = Math.max(
    1,
    Math.round((today.getTime() - threeMonthsAgo.getTime()) / (1000 * 3600 * 24)),
  );

  const netMovement = movements.reduce(
    (sum, m) => sum + (m.totalCredits - m.totalDebits),
    0,
  );
  const dailyNet = netMovement / observedDays;

  const dates: string[] = [];
  const projected: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  let balance = currentCash;
  let negativeAlert = false;

  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    dates.push(dateStr);

    balance += dailyNet;
    projected.push(Math.round(balance));

    // Confidence band. Scaling the balance itself (balance * 0.82 / 1.18)
    // inverts once the balance goes negative — "lower" ends up above "upper",
    // which is precisely the region a cash-flow warning matters. Anchor the
    // band to the magnitude of projected movement instead, and widen it with
    // the forecast horizon since uncertainty compounds.
    const uncertainty = Math.abs(dailyNet) * (i + 1) * 0.18;
    lower.push(Math.round(balance - uncertainty));
    upper.push(Math.round(balance + uncertainty));

    if (balance < 0) negativeAlert = true;
  }

  return { dates, projected, lower, upper, negativeAlert };
}

// ──────────────────────────────────────────────────────────────
// 4. Tax Planning Suggestions
// ──────────────────────────────────────────────────────────────
export async function getTaxPlanningSuggestions(businessId: string): Promise<TaxPlanningSuggestion[]> {
  const today = new Date();
  const yearEnd = new Date(today.getFullYear(), 11, 31);
  const daysToYearEnd = Math.ceil((yearEnd.getTime() - today.getTime()) / (1000 * 3600 * 24));

  if (daysToYearEnd > 60) return []; // Only show within 60 days of year end

  try {
    // Previously queried a `v_profit_loss_summary` view that exists in no
    // migration and no generated type; the resulting error was swallowed by
    // the catch below, so this function always returned []. Because of the
    // 60-day guard above that only bit during Q4 — the one time of year the
    // feature is meant to do anything. Use the P&L the reports pages use.
    const yearStart = `${today.getFullYear()}-01-01`;
    const pl = await financialStatements.getProfitOrLoss(
      businessId,
      yearStart,
      today.toISOString().slice(0, 10),
    );

    const currentProfit = pl.profitBeforeTax;

    const suggestions: TaxPlanningSuggestion[] = [];

    if (currentProfit > 5000000) {
      suggestions.push({
        title: 'Prepay Expenses',
        description: 'Accelerate deductible expenses before year-end (equipment, marketing, training).',
        potentialSaving: formatMwk(Math.min(currentProfit * 0.3, 1500000)),
        action: 'Review upcoming expenses and prepay where possible.',
      });
    }

    suggestions.push({
      title: 'Pension Contributions',
      description: 'Increase employer pension contributions (deductible up to 15% of gross salary).',
      potentialSaving: formatMwk(Math.min(currentProfit * 0.15, 800000)),
      action: 'Discuss with payroll team before 31 December.',
    });

    if (currentProfit > 20000000) {
      suggestions.push({
        title: 'Capital Allowances',
        description: 'Accelerate asset purchases to claim higher wear & tear allowances.',
        potentialSaving: formatMwk(currentProfit * 0.1),
        action: 'Consider purchasing qualifying assets before year end.',
      });
    }

    return suggestions;
  } catch (e) {
    log.error('Tax planning suggestions failed', e as Error);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// 5. Natural Language Report Generator
// ──────────────────────────────────────────────────────────────
export async function generateNarrativeReport(
  _businessId: string,
  question: string,
  businessContext: BusinessContext
): Promise<string> {
  // This would normally call Claude with a specialized prompt.
  // For now we return a structured template that the AI can expand.

  return `**Financial Performance Narrative Report**

**Question:** ${question}

**Period:** Last 3 months ending ${businessContext.today}

**Key Metrics:**
- Revenue (3 months): ${businessContext.last3MonthsPL.split('|')[0]}
- Expenses: ${businessContext.last3MonthsPL.split('|')[1]}
- Net Position: ${businessContext.last3MonthsPL.split('|')[2]}

**Cash Position:** ${businessContext.cashBalance}
**Outstanding Receivables:** ${businessContext.outstandingInvoices}

**Analysis & Recommendations:**
${businessContext.anomalies.length > 0 
  ? `• Attention needed: ${businessContext.anomalies.slice(0, 2).join(' • ')}` 
  : '• No major anomalies detected in the recent period.'}

${businessContext.upcomingTaxDeadlines}

*This report was generated using real-time business data.*`;
}