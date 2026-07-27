/**
 * Timezone-safe date arithmetic for tax periods and due dates.
 *
 * WHY THIS EXISTS:
 * The previous helpers on TaxReturnRepository did this:
 *
 *   const d = new Date('2026-06-30');                       // UTC midnight
 *   new Date(d.getFullYear(), d.getMonth() + 1, 0)          // LOCAL accessors
 *     .toISOString().slice(0, 10);                          // back to UTC
 *
 * Parsing an ISO date string yields UTC midnight, but getFullYear()/getMonth()
 * read it in the *local* zone. Anywhere east of UTC that rolls the date back a
 * day, and toISOString() then bakes the error in. Verified in Africa/Blantyre
 * (UTC+2, Ledgr's primary market):
 *
 *   lastDayOfMonth('2026-06-30') -> '2026-06-29'   (should be 2026-06-30)
 *   TPR due date                 -> '2026-07-14'   (should be 2026-07-15)
 *
 * Every PAYE and TPR due date was a day early for the target market.
 *
 * These functions work on 'YYYY-MM-DD' strings using UTC-only accessors, so
 * the result is identical regardless of the runtime timezone. They are pure
 * string -> string, which also makes them directly comparable to Postgres
 * `date` columns without any conversion.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(dateStr: string): void {
  if (!ISO_DATE.test(dateStr)) {
    throw new Error(`Expected a 'YYYY-MM-DD' date string, received '${dateStr}'.`);
  }
}

/** Parse 'YYYY-MM-DD' into a UTC-midnight Date. Never shifts across a day boundary. */
function parseUtc(dateStr: string): Date {
  assertIsoDate(dateStr);
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Serialise a UTC Date back to 'YYYY-MM-DD'. */
function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today in the given IANA timezone (default Africa/Blantyre) as 'YYYY-MM-DD'. */
export function todayIso(timeZone = 'Africa/Blantyre'): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Last calendar day of the month containing `dateStr`. */
export function lastDayOfMonth(dateStr: string): string {
  const d = parseUtc(dateStr);
  // Day 0 of the next month == last day of this month.
  return formatUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** First calendar day of the month containing `dateStr`. */
export function firstDayOfMonth(dateStr: string): string {
  const d = parseUtc(dateStr);
  return formatUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** Add (or subtract, with a negative) whole days. */
export function addDays(dateStr: string, days: number): string {
  const d = parseUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtc(d);
}

/**
 * Move `months` forward and pin to `day` of that month. If the target month is
 * shorter than `day` (e.g. day 31 in February), clamps to the month's last day
 * rather than silently overflowing into the next month the way Date does.
 */
export function addMonthsSetDay(dateStr: string, months: number, day: number): string {
  const d = parseUtc(dateStr);
  const targetYear = d.getUTCFullYear();
  const targetMonth = d.getUTCMonth() + months;
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return formatUtc(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, daysInTarget))));
}

/** Whole days from `fromIso` to `toIso`. Negative when `toIso` is in the past. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseUtc(fromIso).getTime();
  const to = parseUtc(toIso).getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * Days remaining until `dueDateIso`, relative to today in Malawi time.
 * Negative means overdue.
 */
export function daysUntilDue(dueDateIso: string, timeZone?: string): number {
  return daysBetween(todayIso(timeZone), dueDateIso);
}

/** 'YYYY-MM' period label for the month containing `dateStr`. */
export function periodLabel(dateStr: string): string {
  assertIsoDate(dateStr);
  return dateStr.slice(0, 7);
}

/**
 * Human-readable month, e.g. '2026-06' -> 'June 2026'. Accepts a full date or
 * a 'YYYY-MM' label. Uses UTC so the label can't drift a month at the edges.
 */
export function formatPeriodLabel(labelOrDate: string): string {
  const [y, m] = labelOrDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Display format for a due date, e.g. '25 Jul 2026'. */
export function formatDueDate(dateStr: string): string {
  return parseUtc(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
