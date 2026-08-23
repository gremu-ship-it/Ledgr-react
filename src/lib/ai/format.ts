/**
 * Money formatting for the assistants.
 *
 * The product spec for Ledgr AI is a single, unambiguous format: `MK 1,234,567`
 * — no decimals, ASCII space, minus sign in front of the unit for negatives.
 * `@/lib/formatters.formatMwk` uses `Intl.NumberFormat('en-MW')`, which inserts
 * a narrow no-break space and varies by runtime ICU build; that is fine inside
 * the app's tables but not for text the AI is expected to reproduce verbatim.
 * Both produce the same NUMBER — only the separator differs.
 */
export function mk(value: number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'MK 0';
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return rounded < 0 ? `-MK ${abs}` : `MK ${abs}`;
}

/** Percentage with one decimal, e.g. `18.4%`. Returns '—' for null. */
export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** 'YYYY-MM' → 'March 2026'. Returns the input unchanged when unparseable. */
export function monthName(month: string): string {
  const [y, m] = String(month).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  return new Date(y, m - 1, 1).toLocaleString('en-MW', { month: 'long', year: 'numeric' });
}

/** 'YYYY-MM-DD' → '15 Mar 2026'. Returns the input unchanged when unparseable. */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-MW', { day: '2-digit', month: 'short', year: 'numeric' });
}
