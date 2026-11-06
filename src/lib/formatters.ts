export function formatCurrency(value: number, currencyCode = 'MWK', locale?: string): string {
  const code = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'MWK';
  const numberLocale = locale || (code === 'MWK' ? 'en-MW' : 'en');
  return new Intl.NumberFormat(numberLocale, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCurrencyCompact(value: number, currencyCode = 'MWK', locale?: string): string {
  const code = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'MWK';
  const numberLocale = locale || (code === 'MWK' ? 'en-MW' : 'en');
  return new Intl.NumberFormat(numberLocale, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'code',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateRange(from: string, to: string, locale = 'en-MW'): string {
  const parseLocal = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${parseLocal(from).toLocaleDateString(locale, options)} – ${parseLocal(to).toLocaleDateString(locale, options)}`;
}

export function formatMwk(value: number): string {
  return new Intl.NumberFormat('en-MW', {
    style: 'currency',
    currency: 'MWK',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMwkDetailed(amount: number): string {
  const n = Number(amount) || 0;
  return `MK ${n.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** @deprecated — use formatMwkDetailed for tables needing 2 decimals */
export function formatMwkFull(amount: number): string {
  return formatMwkDetailed(amount);
}

export function formatMwkCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `MK ${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `MK ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `MK ${(value / 1_000).toFixed(0)}K`;
  return formatMwk(value);
}

export function formatDateShort(date: string): string {
  try {
    return new Date(date).toLocaleDateString('en-MW', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return date;
  }
}
