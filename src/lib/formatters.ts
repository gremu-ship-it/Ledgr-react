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
