import { mk } from './format';
import { negativeMonths } from './forecast';
import type {
  Advice,
  AdviceRating,
  AiData,
  AiMonthlyTrend,
  DataContext,
} from './types';

/**
 * Deterministic business advisor.
 *
 * Every insight and action is derived from a REAL figure in the live
 * `ai_context` payload and names a real entity (customer, category, account,
 * month). There is no generic advice: if a signal cannot be computed from the
 * data, it is simply not emitted.
 *
 * Thresholds are tuned for Malawian SMEs (high inflation, slow collections,
 * thin cash buffers).
 */

// ── Thresholds (documented in the README) ────────────────────────────────────
export const THRESHOLDS = {
  margin: { healthy: 20, watch: 5 },        // net profit margin, %
  runwayMonths: { danger: 1, watch: 3 },    // cash / average monthly cash out
  overdueRatio: { danger: 30, watch: 15 },  // overdue / receivables, %
  expenseRatio: { danger: 95, watch: 85 },  // expenses / revenue, %
  concentration: { danger: 40 },            // single customer share, %
  momExpenseJump: 25,                       // month-on-month expense rise, %
  momRevenueDrop: 15,                       // month-on-month revenue fall, %
} as const;

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(value: number): string {
  return `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`;
}

/** Rank ratings so the worst signal wins. */
const RATING_RANK: Record<AdviceRating, number> = { healthy: 0, watch: 1, danger: 2 };

function worst(a: AdviceRating, b: AdviceRating): AdviceRating {
  return RATING_RANK[b] > RATING_RANK[a] ? b : a;
}

/** Last two COMPLETE months from the trend (current partial month excluded). */
function lastTwoCompleteMonths(trend: AiMonthlyTrend[], now: Date): [AiMonthlyTrend | null, AiMonthlyTrend | null] {
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const complete = trend
    .filter((m) => String(m.month) < currentKey)
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const previous = complete.length >= 2 ? complete[complete.length - 2] : null;
  const latest = complete.length >= 1 ? complete[complete.length - 1] : null;
  return [previous, latest];
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  return new Date(y, m - 1, 1).toLocaleString('en-MW', { month: 'long', year: 'numeric' });
}

/**
 * Produces a rating, a headline, supporting insights and 2-5 specific actions.
 * Safe on an empty/new company: returns a 'watch' rating that says there is
 * not enough data yet, and actions that get the user to record something.
 */
export function advise(ctx: DataContext, now: Date = new Date()): Advice {
  const data: AiData | undefined = ctx.data;
  const kpis = data?.kpis;
  const trend = Array.isArray(data?.monthlyTrend) ? data!.monthlyTrend : [];
  const company = ctx.companyName ?? data?.company?.name ?? 'Your business';

  const insights: string[] = [];
  const actions: string[] = [];
  let rating: AdviceRating = 'healthy';
  const headlineParts: string[] = [];

  const hasActivity = trend.some((m) => num(m.revenue) !== 0 || num(m.expenses) !== 0)
    || num(kpis?.revenue_mtd) !== 0
    || num(kpis?.expenses_mtd) !== 0
    || num(kpis?.receivables_total) !== 0;

  if (!kpis || !hasActivity) {
    return {
      rating: 'watch',
      headline: `${company} has no recorded financial activity yet — there is nothing to assess.`,
      insights: [
        'No posted invoices, expenses or bank movement were found for this business.',
        'Once a few weeks of transactions are captured, Ledgr AI can rate performance, forecast cash and flag anomalies.',
      ],
      actions: [
        'Record your opening balances in Accounts (/accounts) so cash and receivables start from the right place.',
        'Capture your first invoices in /invoices and expenses in /expenses — advice needs at least one month of activity.',
      ],
    };
  }

  const revenue = num(kpis.revenue_mtd);
  const expenses = num(kpis.expenses_mtd);
  const profit = num(kpis.net_profit_mtd);
  const cash = num(kpis.cash_balance);
  const receivables = num(kpis.receivables_total);
  const overdue = num(kpis.overdue_total);

  // ── 1. Profit margin ───────────────────────────────────────────────────
  const margin = kpis.profit_margin_pct === null || kpis.profit_margin_pct === undefined
    ? null
    : num(kpis.profit_margin_pct);

  if (margin !== null && revenue > 0) {
    if (margin < THRESHOLDS.margin.watch) {
      rating = worst(rating, 'danger');
      headlineParts.push(`net margin is ${pct(margin)}`);
      insights.push(
        `Month-to-date margin is ${pct(margin)}: ${mk(revenue)} revenue against ${mk(expenses)} of costs, leaving ${mk(profit)}.`,
      );
    } else if (margin < THRESHOLDS.margin.healthy) {
      rating = worst(rating, 'watch');
      insights.push(
        `Margin is thin at ${pct(margin)} (${mk(profit)} on ${mk(revenue)} of revenue) — below the 20% healthy mark.`,
      );
    } else {
      insights.push(
        `Healthy margin of ${pct(margin)} month-to-date: ${mk(profit)} profit on ${mk(revenue)} of revenue.`,
      );
    }
  }

  // ── 2. Cash runway ─────────────────────────────────────────────────────
  const outflowMonths = trend.map((m) => num(m.cash_out)).filter((v) => v > 0);
  const avgMonthlyOut = outflowMonths.length > 0
    ? outflowMonths.reduce((s, v) => s + v, 0) / outflowMonths.length
    : 0;
  const runway = avgMonthlyOut > 0 ? cash / avgMonthlyOut : null;

  if (runway !== null) {
    if (runway < THRESHOLDS.runwayMonths.danger) {
      rating = worst(rating, 'danger');
      headlineParts.push(`cash covers under a month of costs`);
      insights.push(
        `Cash of ${mk(cash)} covers only ${runway.toFixed(1)} months at your average monthly outflow of ${mk(avgMonthlyOut)}.`,
      );
    } else if (runway < THRESHOLDS.runwayMonths.watch) {
      rating = worst(rating, 'watch');
      insights.push(
        `Cash runway is ${runway.toFixed(1)} months — ${mk(cash)} against ${mk(avgMonthlyOut)} of monthly outflow.`,
      );
    } else {
      insights.push(
        `Cash runway is comfortable at ${runway.toFixed(1)} months (${mk(cash)} against ${mk(avgMonthlyOut)} monthly outflow).`,
      );
    }
  } else if (cash <= 0) {
    rating = worst(rating, 'danger');
    insights.push(`Cash balance is ${mk(cash)} — the ledger shows no positive cash position.`);
  }

  // ── 3. Overdue ratio + the worst offender by name ──────────────────────
  const overdueRatio = receivables > 0 ? (overdue / receivables) * 100 : 0;
  const worstInvoice = [...(data?.overdueInvoices ?? [])]
    .sort((a, b) => num(b.amount_outstanding) - num(a.amount_outstanding))[0];

  if (receivables > 0 && overdue > 0) {
    if (overdueRatio > THRESHOLDS.overdueRatio.danger) {
      rating = worst(rating, 'danger');
      headlineParts.push(`${pct(overdueRatio)} of receivables are overdue`);
      insights.push(
        `${mk(overdue)} of your ${mk(receivables)} receivables is past due — ${pct(overdueRatio)} of the book.`,
      );
    } else if (overdueRatio > THRESHOLDS.overdueRatio.watch) {
      rating = worst(rating, 'watch');
      insights.push(
        `${pct(overdueRatio)} of receivables (${mk(overdue)}) is past due.`,
      );
    }
  }

  if (worstInvoice) {
    actions.push(
      `Chase ${worstInvoice.customer} — ${mk(num(worstInvoice.amount_outstanding))} on invoice ${worstInvoice.invoice_number} is ${Math.round(num(worstInvoice.days_overdue))} days overdue.`,
    );
  }

  // ── 4. Expense ratio ───────────────────────────────────────────────────
  const expenseRatio = kpis.expense_ratio_pct === null || kpis.expense_ratio_pct === undefined
    ? null
    : num(kpis.expense_ratio_pct);

  if (expenseRatio !== null && revenue > 0) {
    if (expenseRatio > THRESHOLDS.expenseRatio.danger) {
      rating = worst(rating, 'danger');
      insights.push(`Costs are consuming ${pct(expenseRatio)} of revenue this month (${mk(expenses)} of ${mk(revenue)}).`);
    } else if (expenseRatio > THRESHOLDS.expenseRatio.watch) {
      rating = worst(rating, 'watch');
      insights.push(`Costs are running at ${pct(expenseRatio)} of revenue (${mk(expenses)} of ${mk(revenue)}).`);
    }
  }

  // ── 5. Customer concentration ──────────────────────────────────────────
  const conc = data?.concentration;
  const concPct = conc?.concentration_pct === null || conc?.concentration_pct === undefined
    ? null
    : num(conc.concentration_pct);

  if (conc && concPct !== null && concPct > THRESHOLDS.concentration.danger) {
    rating = worst(rating, 'danger');
    insights.push(
      `${conc.top_customer} accounts for ${pct(concPct)} of the last 12 months' revenue (${mk(num(conc.top_customer_revenue))} of ${mk(num(conc.total_revenue))}) — losing them would be existential.`,
    );
    actions.push(
      `Reduce reliance on ${conc.top_customer} (${pct(concPct)} of revenue): target two new accounts worth ${mk(Math.round(num(conc.top_customer_revenue) * 0.25))} each over the next quarter.`,
    );
  }

  // ── 6. Month-on-month direction ────────────────────────────────────────
  const [prev, latest] = lastTwoCompleteMonths(trend, now);
  if (prev && latest) {
    const prevRevenue = num(prev.revenue);
    const latestRevenue = num(latest.revenue);
    if (prevRevenue > 0) {
      const change = ((latestRevenue - prevRevenue) / prevRevenue) * 100;
      if (change <= -THRESHOLDS.momRevenueDrop) {
        rating = worst(rating, 'watch');
        insights.push(
          `Revenue fell ${pct(Math.abs(change))} in ${monthLabel(String(latest.month))} — ${mk(latestRevenue)} against ${mk(prevRevenue)} in ${monthLabel(String(prev.month))}.`,
        );
      } else if (change >= 10) {
        insights.push(
          `Revenue grew ${pct(change)} in ${monthLabel(String(latest.month))} to ${mk(latestRevenue)}.`,
        );
      }
    }

    const prevExpenses = num(prev.expenses);
    const latestExpenses = num(latest.expenses);
    if (prevExpenses > 0) {
      const change = ((latestExpenses - prevExpenses) / prevExpenses) * 100;
      if (change >= THRESHOLDS.momExpenseJump) {
        rating = worst(rating, 'watch');
        insights.push(
          `Expenses rose ${pct(change)} in ${monthLabel(String(latest.month))} to ${mk(latestExpenses)} (from ${mk(prevExpenses)}).`,
        );
        const topCategory = [...(data?.topExpenses ?? [])].sort((a, b) => num(b.amount) - num(a.amount))[0];
        if (topCategory) {
          actions.push(
            `Review ${topCategory.category} — ${mk(num(topCategory.amount))} across ${Math.round(num(topCategory.document_count))} document(s) in the last 90 days, your largest cost line while total spend is up ${pct(change)}.`,
          );
        }
      }
    }
  }

  // ── 7. Forecast: any month below zero ──────────────────────────────────
  const negatives = negativeMonths(ctx.forecast);
  if (negatives.length > 0) {
    rating = worst(rating, 'danger');
    const first = negatives[0];
    headlineParts.push(`cash goes negative in ${monthLabel(first.month)}`);
    insights.push(
      `The ${ctx.forecast?.cashFlow.length ?? 0}-month projection dips to ${mk(num(first.projected_balance))} in ${monthLabel(first.month)}.`,
    );
    actions.push(
      `Cover the ${monthLabel(first.month)} shortfall of ${mk(Math.abs(num(first.projected_balance)))}: pull collections forward, defer non-committed spend, or arrange an overdraft before ${monthLabel(first.month)}.`,
    );
  }

  // ── 8. Committed obligations (payroll / MRA) ───────────────────────────
  const taxDue = (data?.upcomingPayables ?? []).filter((p) => p.source === 'tax');
  if (taxDue.length > 0) {
    const total = taxDue.reduce((s, p) => s + num(p.amount), 0);
    const soonest = [...taxDue].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
    insights.push(`${mk(total)} of MRA returns are unpaid; the next (${soonest.label}) is due ${soonest.due_date}.`);
    actions.push(`Settle ${soonest.label} of ${mk(num(soonest.amount))} by ${soonest.due_date} to avoid MRA penalties and interest.`);
  }

  const payrollDue = (data?.upcomingPayables ?? []).filter((p) => p.source === 'payroll');
  if (payrollDue.length > 0) {
    const total = payrollDue.reduce((s, p) => s + num(p.amount), 0);
    const soonest = [...payrollDue].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
    insights.push(`Approved payroll of ${mk(total)} is due for payment from ${soonest.due_date}.`);
  }

  // ── 9. High-severity anomalies ─────────────────────────────────────────
  const highAnomalies = (data?.anomalies ?? []).filter((a) => a.severity === 'high');
  if (highAnomalies.length > 0) {
    rating = worst(rating, 'watch');
    const first = highAnomalies[0];
    insights.push(`${highAnomalies.length} high-severity anomal${highAnomalies.length === 1 ? 'y' : 'ies'} detected — e.g. ${first.description}`);
    actions.push(`Verify ${first.reference} (${mk(num(first.amount))} on ${first.occurred_on}) — flagged as ${first.type.replace(/_/g, ' ')}.`);
  }

  // ── Fill up to at least two specific, numeric actions ──────────────────
  if (actions.length < 2) {
    const topCategory = [...(data?.topExpenses ?? [])].sort((a, b) => num(b.amount) - num(a.amount))[0];
    if (topCategory && !actions.some((a) => a.includes(topCategory.category))) {
      actions.push(
        `Renegotiate or trim ${topCategory.category}: ${mk(num(topCategory.amount))} over the last 90 days — a 10% saving is ${mk(Math.round(num(topCategory.amount) * 0.1))}.`,
      );
    }
  }
  if (actions.length < 2 && receivables > 0) {
    const days = kpis.avg_days_to_pay === null || kpis.avg_days_to_pay === undefined ? null : num(kpis.avg_days_to_pay);
    actions.push(
      days !== null
        ? `Customers take ${days.toFixed(0)} days on average to pay. Shortening that by 10 days releases roughly ${mk(Math.round((receivables / Math.max(days, 1)) * 10))} of cash.`
        : `Set due dates on all ${mk(receivables)} of open receivables so collections can be tracked and chased.`,
    );
  }
  if (actions.length < 2) {
    const topCustomer = [...(data?.topCustomers ?? [])].sort((a, b) => num(b.revenue) - num(a.revenue))[0];
    if (topCustomer) {
      actions.push(
        `Grow ${topCustomer.customer} (${mk(num(topCustomer.revenue))} over 12 months, last invoiced ${topCustomer.last_invoice_date ?? 'n/a'}) — a repeat order is your cheapest revenue.`,
      );
    }
  }

  // Last resort: still derived from real figures and named periods, never
  // generic filler. `hasActivity` guarantees at least one of these is non-zero.
  if (actions.length < 2 && avgMonthlyOut > 0) {
    const target = avgMonthlyOut * 3;
    actions.push(
      cash >= target
        ? `Keep at least ${mk(Math.round(target))} on hand (three months at ${mk(avgMonthlyOut)} of outflow); you currently hold ${mk(cash)}, so the surplus of ${mk(Math.round(cash - target))} can be put to work.`
        : `Build the cash buffer from ${mk(cash)} to ${mk(Math.round(target))} — three months at your ${mk(avgMonthlyOut)} average monthly outflow.`,
    );
  }
  if (actions.length < 2 && latest) {
    actions.push(
      `Hold ${monthLabel(String(latest.month))}'s run rate of ${mk(num(latest.revenue))} revenue against ${mk(num(latest.expenses))} of costs — that pace yields ${mk(num(latest.revenue) - num(latest.expenses))} a month.`,
    );
  }
  if (actions.length < 2) {
    actions.push(
      `Record this month's remaining invoices and expenses in Ledgr — today's figures (${mk(revenue)} revenue, ${mk(expenses)} costs) are only as complete as what has been captured.`,
    );
  }

  // ── Headline ────────────────────────────────────────────────────────────
  let headline: string;
  if (rating === 'danger') {
    headline = `${company} needs attention: ${headlineParts.slice(0, 2).join(' and ') || 'key indicators are outside safe ranges'}.`;
  } else if (rating === 'watch') {
    headline = margin !== null
      ? `${company} is stable but watch the margin at ${pct(margin)} and cash at ${mk(cash)}.`
      : `${company} is stable, with a few indicators worth watching.`;
  } else {
    headline = margin !== null
      ? `${company} is performing well: ${pct(margin)} margin and ${mk(cash)} in cash.`
      : `${company} is performing well, with ${mk(cash)} in cash.`;
  }

  return {
    rating,
    headline,
    insights: insights.slice(0, 6),
    actions: actions.slice(0, 5),
  };
}
