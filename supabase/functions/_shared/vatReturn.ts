// supabase/functions/_shared/vatReturn.ts
//
// Pure VAT-return arithmetic shared by the generate-vat-returns Edge
// Function and its unit tests. This is the Deno-side mirror of
// TaxReturnRepository.generateVatReturn — deliberately kept dependency-free
// (no Deno.*, no npm imports, Web-standard APIs only) so vitest can run the
// same logic the cron job executes. If the calculation rules change, update
// BOTH this module and TaxReturnRepository (see the NOTE in
// generate-vat-returns/index.ts about the intentional duplication).
//
// Statutory context (Malawi Revenue Authority, VAT Act): monthly VAT returns
// are due on the 25th of the month following the tax period.

export interface VatPeriod {
  /** First day of the tax period (prior calendar month), YYYY-MM-DD. */
  periodStart: string;
  /** Last day of the tax period, YYYY-MM-DD. */
  periodEnd: string;
  /** "YYYY-MM" — the tax_returns.period_label key. */
  periodLabel: string;
  /** Statutory filing deadline: the 25th of the month the job runs in. */
  dueDate: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, monthIndex0: number, day: number) => `${y}-${pad2(monthIndex0 + 1)}-${pad2(day)}`;

/**
 * The tax period targeted by a run on `now`: the prior calendar month, plus
 * the filing due date (25th of the run month).
 *
 * Date arithmetic is done with LOCAL-time getters throughout and the ISO
 * strings are assembled manually. The previous implementation piped the
 * Date objects through toISOString (a UTC rendering) — in any timezone
 * ahead of UTC, local midnight of the 1st renders as the previous day in
 * UTC, shifting both the period bounds and the due date back by one day.
 */
export function priorMonthPeriod(now: Date): VatPeriod {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0); // day 0 = last day of prior month
  const due = new Date(now.getFullYear(), now.getMonth(), 25);
  const periodStart = ymd(start.getFullYear(), start.getMonth(), start.getDate());
  return {
    periodStart,
    periodEnd: ymd(end.getFullYear(), end.getMonth(), end.getDate()),
    periodLabel: periodStart.slice(0, 7),
    dueDate: ymd(due.getFullYear(), due.getMonth(), due.getDate()),
  };
}

/** Sums tax_amount across fetched invoice/expense lines. */
export function sumTaxAmounts(lines: ReadonlyArray<{ tax_amount: number | string }>): number {
  return lines.reduce((sum, line) => sum + Number(line.tax_amount), 0);
}

/**
 * VAT payable for the period: output tax less input tax, rounded to the
 * tambala (0.01 MWK) and floored at zero — a net credit position carries
 * forward rather than producing a negative amount_due on the return.
 */
export function computeAmountDue(outputTax: number, inputTax: number): number {
  return Math.max(Math.round((outputTax - inputTax) * 100) / 100, 0);
}

export type VatAlertType = '14_day' | '7_day' | '1_day' | 'due_date';

export interface VatAlertOffset {
  days: number;
  type: VatAlertType;
}

/** Reminder schedule relative to the due date (mirrors TaxReturnRepository.scheduleAlerts). */
export const VAT_ALERT_OFFSETS: ReadonlyArray<VatAlertOffset> = [
  { days: -14, type: '14_day' },
  { days: -7, type: '7_day' },
  { days: -1, type: '1_day' },
  { days: 0, type: 'due_date' },
];

/**
 * The four alert (alert_type, scheduled_for) pairs for a due date.
 * `dueDate` is parsed as a UTC-midnight instant and rendered back via
 * toISOString, so the result is timezone-independent.
 */
export function alertSchedule(dueDate: string): Array<{ alert_type: VatAlertType; scheduled_for: string }> {
  return VAT_ALERT_OFFSETS.map((offset) => {
    const scheduled = new Date(dueDate);
    scheduled.setDate(scheduled.getDate() + offset.days);
    return { alert_type: offset.type, scheduled_for: scheduled.toISOString().slice(0, 10) };
  });
}
