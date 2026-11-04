export type Row = Record<string, unknown>;

export function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

export function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(asRow) : [];
}

export function text(value: unknown, fallback = ''): string {
  return value == null || value === '' ? fallback : String(value);
}

export function numeric(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

export function formatMoney(value: unknown, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(numeric(value));
  } catch {
    return `${currency} ${numeric(value).toFixed(2)}`;
  }
}

export function formatDate(value: unknown, locale: string): string {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function todayDate(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

export function employeeDisplayName(employee: Row): string {
  return [text(employee.first_name), text(employee.last_name)].filter(Boolean).join(' ');
}

export function activeOnDate(row: Row, date = new Date()): boolean {
  const from = row.effective_from ? new Date(`${String(row.effective_from).slice(0, 10)}T00:00:00`) : null;
  const to = row.effective_to ? new Date(`${String(row.effective_to).slice(0, 10)}T00:00:00`) : null;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return (!from || from <= day) && (!to || to >= day);
}
