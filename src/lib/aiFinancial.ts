import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { formatMwk } from '@/lib/formatters';

export interface BusinessContext {
  businessName: string;
  today: string;
  currency: string;
  last3MonthsPL: string;
  cashBalance: string;
  outstandingInvoices: string;
  upcomingTaxDeadlines: string;
  anomalies: string[];
  rawData?: any;
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
    const [invoices, expenses, , accounts] = await Promise.all([
      repos.invoice.findByBusiness(businessId),
      repos.expense.findByBusiness(businessId),
      supabase.from('journal_entries').select('*').eq('business_id', businessId).eq('status', 'posted').gte('entry_date', start3M),
      repos.account.findByBusiness(businessId),
    ]);

    // P&L last 3 months
    const recentInvoices = invoices.filter(i => i.issue_date >= start3M);
    const recentExpenses = expenses.filter(e => e.expense_date >= start3M);
    const revenue3M = recentInvoices.reduce((s, i) => s + Number(i.total_amount), 0);
    const expense3M = recentExpenses.reduce((s, e) => s + Number(e.total_amount), 0);

    // Cash position
    const bankAccounts = accounts.filter(a => a.is_bank_account);
    const cashBalance = bankAccounts.reduce((s, a) => s + Number(a.opening_balance || 0), 0);

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
    console.error('Failed to build rich context', e);
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
    const { data: entries } = await supabase
      .from('journal_entries' as any)
      .select('id, entry_date, total_debits, description, status')
      .eq('business_id', businessId)
      .eq('status', 'posted')
      .gte('entry_date', thirtyDaysAgo.toISOString().slice(0, 10))
      .order('entry_date', { ascending: false });

    const entryList = entries as any[];
    if (!entryList || entryList.length < 5) return anomalies;

    const amounts = entryList.map(e => Number(e.total_debits || 0));
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    // 1. Unusually large transactions
    const largeTx = entryList.filter(e => Number(e.total_debits || 0) > avg * 2.5);
    largeTx.forEach(tx => {
      anomalies.push({
        type: 'large_transaction',
        severity: 'high',
        description: `Unusually large transaction: ${formatMwk(Number(tx.total_debits))} on ${tx.entry_date}`,
        date: tx.entry_date,
        amount: Number(tx.total_debits),
      });
    });

    // 2. Duplicate amounts on same day
    const byDay: Record<string, number[]> = {};
    entryList.forEach(e => {
      const d = e.entry_date;
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(Number(e.total_debits || 0));
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
    const incomeEntries = entryList.filter(e => 
      e.description?.toLowerCase().includes('income') || 
      e.description?.toLowerCase().includes('sale') ||
      e.description?.toLowerCase().includes('revenue')
    );
    
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
  } catch {
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

  const { data: movements } = await supabase
    .from('journal_entries' as any)
    .select('entry_date, total_debits, total_credits')
    .eq('business_id', businessId)
    .eq('status', 'posted')
    .gte('entry_date', threeMonthsAgo.toISOString().slice(0, 10));

  const dailyNet = ((movements || []) as any[]).reduce((sum, m) => {
    return sum + (Number(m.total_credits || 0) - Number(m.total_debits || 0));
  }, 0) / 90;

  // Get current cash
  const accounts = await repos.account.findByBusiness(businessId);
  const currentCash = accounts
    .filter(a => a.is_bank_account)
    .reduce((s, a) => s + Number(a.opening_balance || 0), 0);

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
    lower.push(Math.round(balance * 0.82));
    upper.push(Math.round(balance * 1.18));

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
    const { data: plData } = await supabase
      .from('v_profit_loss_summary' as any)
      .select('*')
      .eq('business_id', businessId)
      .single();

    const currentProfit = Number((plData as any)?.net_profit || 0);

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
  } catch {
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