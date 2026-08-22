import { mk } from './format';
import type {
  AiData,
  AiMonthlyTrend,
  Confidence,
  Forecast,
  ForecastCashFlowMonth,
  ForecastPoint,
} from './types';

/**
 * Transparent, explainable forecasting for Ledgr AI.
 *
 * No black boxes: every number below is produced by one of four documented
 * methods, and `Forecast.assumptions` states each of them in plain English so
 * the UI can show the user exactly how the projection was built.
 *
 *   1. BASELINE RUN RATE — weighted 3-month average, weights 0.5 / 0.3 / 0.2
 *      from most recent to oldest, over `monthlyTrend.cash_in` / `cash_out`.
 *   2. COLLECTION CURVES — invoices already on the books are collected as:
 *        overdue            60% within 30 days, 30% within 60 days (10% never)
 *        due in 0-30 days   85% in month 1
 *        due in 30-60 days  50% in month 2
 *        due in 60+ days    excluded from a 3-month horizon
 *   3. COMMITTED OUTFLOWS — unpaid bills, approved payroll and unpaid MRA
 *      returns are added to the month they fall due (100%, they are committed).
 *   4. REVENUE / EXPENSE TREND — 3-month moving average, upgraded to ordinary
 *      least-squares linear regression when there are >= 6 months of history
 *      and the fit explains the data (R^2 > 0.6).
 *
 * Every arithmetic path is guarded against empty history, division by zero and
 * NaN. A brand-new business gets `confidence: 'low'` and an explicit
 * "limited history" assumption rather than a confident-looking straight line.
 */

// ── Tunables (documented in the README) ──────────────────────────────────────

/** Weighted-average weights, most recent month first. */
export const RUN_RATE_WEIGHTS = [0.5, 0.3, 0.2] as const;

/** Share of an OVERDUE balance expected within 30 / 60 days. */
export const OVERDUE_COLLECTION = { within30: 0.6, within60: 0.3 } as const;

/** Share of a not-yet-due balance expected, by due bucket. */
export const UPCOMING_COLLECTION = { due0to30: 0.85, due30to60: 0.5 } as const;

/** Minimum R^2 before a regression is preferred over a moving average. */
export const REGRESSION_R2_THRESHOLD = 0.6;

const MAX_MONTHS_AHEAD = 12;

// ── Small numeric helpers (all NaN/Infinity safe) ────────────────────────────

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  const n = num(value);
  return Math.round(n * 100) / 100;
}

/**
 * Weighted average over the LAST `weights.length` values (most recent last in
 * `series`). Falls back to the simple mean when fewer values exist, and to 0
 * when the series is empty.
 */
export function weightedAverage(series: number[], weights: readonly number[] = RUN_RATE_WEIGHTS): number {
  const values = series.map(num).filter((v) => Number.isFinite(v));
  if (values.length === 0) return 0;

  const recent = values.slice(-weights.length).reverse(); // most recent first
  let total = 0;
  let weightUsed = 0;
  for (let i = 0; i < recent.length; i += 1) {
    const w = weights[i] ?? 0;
    total += recent[i] * w;
    weightUsed += w;
  }
  if (weightUsed <= 0) return 0;
  return total / weightUsed;
}

/** Simple mean; 0 for an empty series. */
export function mean(series: number[]): number {
  if (series.length === 0) return 0;
  return series.reduce((s, v) => s + num(v), 0) / series.length;
}

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
}

/** Ordinary least squares over (index, value). Returns r2 = 0 when undefined. */
export function linearRegression(series: number[]): Regression {
  const ys = series.map(num);
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? ys[0] : 0, r2: 0 };

  const xs = ys.map((_, i) => i);
  const xBar = mean(xs);
  const yBar = mean(ys);

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - xBar) ** 2;
    sxy += (xs[i] - xBar) * (ys[i] - yBar);
  }
  if (sxx === 0) return { slope: 0, intercept: yBar, r2: 0 };

  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = intercept + slope * xs[i];
    ssTot += (ys[i] - yBar) ** 2;
    ssRes += (ys[i] - predicted) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return {
    slope: Number.isFinite(slope) ? slope : 0,
    intercept: Number.isFinite(intercept) ? intercept : 0,
    r2: Number.isFinite(r2) ? r2 : 0,
  };
}

// ── Month helpers ────────────────────────────────────────────────────────────

/** 'YYYY-MM' for a Date (UTC-safe: built from calendar parts, never toISOString). */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Adds `offset` months to a 'YYYY-MM' key. */
export function addMonths(key: string, offset: number): string {
  const [y, m] = key.split('-').map((p) => Number(p));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  const d = new Date(y, m - 1 + offset, 1);
  return monthKey(d);
}

/** Whole months between a due date and today (0 = this month, 1 = next…). */
function monthsFromToday(dueDate: string, today: Date): number {
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  return (d.getFullYear() - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth());
}

// ── Forecast ─────────────────────────────────────────────────────────────────

/**
 * Builds a `monthsAhead`-month projection from the live `ai_context` payload.
 * Never throws: bad or missing data degrades to a zeroed, low-confidence
 * forecast whose assumptions say so.
 */
export function forecast(data: AiData | undefined | null, monthsAhead = 3, now: Date = new Date()): Forecast {
  const horizon = Math.max(1, Math.min(MAX_MONTHS_AHEAD, Math.trunc(monthsAhead) || 3));
  const assumptions: string[] = [];

  const trendAll: AiMonthlyTrend[] = Array.isArray(data?.monthlyTrend) ? [...(data?.monthlyTrend ?? [])] : [];
  trendAll.sort((a, b) => String(a.month).localeCompare(String(b.month)));

  const currentMonth = monthKey(now);

  // The current month is partial; including it drags every average down.
  // Drop it from the run rate whenever we still have some complete history.
  const complete = trendAll.filter((m) => String(m.month) < currentMonth);
  const basis = complete.length >= 1 ? complete : trendAll;
  const droppedPartialMonth = complete.length >= 1 && trendAll.length > complete.length;

  // Months that actually contain activity — the real measure of history depth.
  const activeMonths = trendAll.filter(
    (m) => num(m.revenue) !== 0 || num(m.expenses) !== 0 || num(m.cash_in) !== 0 || num(m.cash_out) !== 0,
  ).length;

  const confidence: Confidence = activeMonths >= 9 ? 'high' : activeMonths >= 4 ? 'medium' : 'low';

  // ── 1. Baseline run rate ────────────────────────────────────────────────
  const baselineIn = Math.max(0, weightedAverage(basis.map((m) => num(m.cash_in))));
  const baselineOut = Math.max(0, weightedAverage(basis.map((m) => num(m.cash_out))));

  // ── 2. Collections from invoices already on the books ───────────────────
  const collections = new Array<number>(horizon).fill(0);

  const overdueTotal = (data?.overdueInvoices ?? []).reduce((s, i) => s + num(i.amount_outstanding), 0);
  if (overdueTotal > 0) {
    if (horizon >= 1) collections[0] += overdueTotal * OVERDUE_COLLECTION.within30;
    if (horizon >= 2) collections[1] += overdueTotal * OVERDUE_COLLECTION.within60;
  }

  let upcoming0to30 = 0;
  let upcoming30to60 = 0;
  let upcomingBeyond = 0;
  for (const r of data?.upcomingReceivables ?? []) {
    const amount = num(r.amount_outstanding);
    if (amount <= 0) continue;
    const days = num(r.days_until_due);
    if (days <= 30) upcoming0to30 += amount;
    else if (days <= 60) upcoming30to60 += amount;
    else upcomingBeyond += amount;
  }
  if (horizon >= 1) collections[0] += upcoming0to30 * UPCOMING_COLLECTION.due0to30;
  if (horizon >= 2) collections[1] += upcoming30to60 * UPCOMING_COLLECTION.due30to60;

  // ── 3. Committed outflows (bills, payroll, tax) ─────────────────────────
  const committed = new Array<number>(horizon).fill(0);
  let committedTotal = 0;
  for (const p of data?.upcomingPayables ?? []) {
    const amount = num(p.amount);
    if (amount <= 0) continue;
    // The projection starts NEXT month, so a bill due next month is bucket 0.
    // Anything already due (or overdue) is clamped into month 1 as well.
    const bucket = Math.max(0, Math.min(horizon - 1, monthsFromToday(String(p.due_date), now) - 1));
    committed[bucket] += amount;
    committedTotal += amount;
  }

  // ── Roll the balance forward ────────────────────────────────────────────
  const startingCash = num(data?.kpis?.cash_balance);
  let balance = startingCash;
  const cashFlow: ForecastCashFlowMonth[] = [];

  for (let i = 0; i < horizon; i += 1) {
    const projectedIn = Math.max(0, baselineIn + collections[i]);
    const projectedOut = Math.max(0, baselineOut + committed[i]);
    balance += projectedIn - projectedOut;
    cashFlow.push({
      month: addMonths(currentMonth, i + 1),
      projected_in: round2(projectedIn),
      projected_out: round2(projectedOut),
      projected_balance: round2(balance),
    });
  }

  // ── 4. Revenue / expense trend ──────────────────────────────────────────
  const revenueSeries = basis.map((m) => num(m.revenue));
  const expenseSeries = basis.map((m) => num(m.expenses));

  const revenueProjection = projectSeries(revenueSeries, horizon, currentMonth);
  const expenseProjection = projectSeries(expenseSeries, horizon, currentMonth);

  // ── Assumptions — every one of them, in plain English ───────────────────
  if (activeMonths === 0) {
    assumptions.push(
      'Limited history — there is no recorded activity yet, so this projection is indicative only and simply carries your current cash balance forward.',
    );
  } else if (confidence === 'low') {
    assumptions.push(
      `Limited history — only ${activeMonths} month${activeMonths === 1 ? '' : 's'} of activity, so this projection is indicative only.`,
    );
  }

  assumptions.push(
    `Ongoing trade is projected at your recent cash run rate: a weighted average of the last ${Math.min(RUN_RATE_WEIGHTS.length, basis.length) || 0} month(s) of receipts and payments, weighted 50% / 30% / 20% from most recent to oldest (${mk(baselineIn)} in, ${mk(baselineOut)} out per month).`,
  );

  if (droppedPartialMonth) {
    assumptions.push('The current (incomplete) month is excluded from the run rate so a part-month does not drag the average down.');
  }

  if (overdueTotal > 0) {
    assumptions.push(
      `Overdue invoices (${mk(overdueTotal)}) are collected on the standard curve: 60% within 30 days, 30% within 60 days, 10% assumed uncollectible inside this horizon.`,
    );
  }
  if (upcoming0to30 > 0 || upcoming30to60 > 0) {
    assumptions.push(
      `Invoices not yet due are collected at 85% when due within 30 days (${mk(upcoming0to30)}) and 50% when due in 30-60 days (${mk(upcoming30to60)}).`,
    );
  }
  if (upcomingBeyond > 0) {
    assumptions.push(
      `${mk(upcomingBeyond)} of invoices fall due beyond 60 days and are excluded from this horizon.`,
    );
  }
  if (overdueTotal > 0 || upcoming0to30 > 0 || upcoming30to60 > 0) {
    assumptions.push(
      'Collections from invoices already issued are added on top of the run rate. Where most of your receipts come from invoices already on the books, treat month 1 as an upper bound.',
    );
  }
  if (committedTotal > 0) {
    assumptions.push(
      `Committed outflows already on the books — unpaid supplier bills, approved payroll and unpaid MRA returns totalling ${mk(committedTotal)} — are paid in full in the month they fall due.`,
    );
  }

  assumptions.push(`Opening cash is your current balance of ${mk(startingCash)} (bank, petty cash and mobile money).`);
  assumptions.push(revenueProjection.method === 'regression'
    ? `Revenue is projected by linear regression over ${revenueSeries.length} months (R² ${revenueProjection.r2.toFixed(2)}).`
    : 'Revenue is projected as a 3-month moving average (no reliable trend line).');
  assumptions.push(expenseProjection.method === 'regression'
    ? `Expenses are projected by linear regression over ${expenseSeries.length} months (R² ${expenseProjection.r2.toFixed(2)}).`
    : 'Expenses are projected as a 3-month moving average (no reliable trend line).');
  assumptions.push('No new borrowing, capital injection, asset sale or other one-off is assumed.');
  assumptions.push('Prices, salaries and tax rates are held flat; no seasonality adjustment is applied.');

  return {
    cashFlow,
    revenue: revenueProjection.points,
    expenses: expenseProjection.points,
    assumptions,
    confidence,
  };
}

interface SeriesProjection {
  points: ForecastPoint[];
  method: 'regression' | 'moving-average';
  r2: number;
}

/**
 * 3-month moving average, upgraded to linear regression when there are >= 6
 * months of history and R^2 > 0.6. Projections are floored at zero — negative
 * revenue or expenses are not a meaningful forecast.
 */
function projectSeries(series: number[], horizon: number, fromMonth: string): SeriesProjection {
  const points: ForecastPoint[] = [];

  if (series.length === 0) {
    for (let i = 0; i < horizon; i += 1) {
      points.push({ month: addMonths(fromMonth, i + 1), projected: 0 });
    }
    return { points, method: 'moving-average', r2: 0 };
  }

  const reg = linearRegression(series);
  const useRegression = series.length >= 6 && reg.r2 > REGRESSION_R2_THRESHOLD;
  const movingAverage = mean(series.slice(-3));

  for (let i = 0; i < horizon; i += 1) {
    const projected = useRegression
      ? reg.intercept + reg.slope * (series.length + i)
      : movingAverage;
    points.push({
      month: addMonths(fromMonth, i + 1),
      projected: round2(Math.max(0, num(projected))),
    });
  }

  return { points, method: useRegression ? 'regression' : 'moving-average', r2: reg.r2 };
}

/** Months in the projection whose closing balance is below zero. */
export function negativeMonths(f: Forecast | undefined | null): ForecastCashFlowMonth[] {
  return (f?.cashFlow ?? []).filter((m) => num(m.projected_balance) < 0);
}
