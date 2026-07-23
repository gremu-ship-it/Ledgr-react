export function formatMwk(value: number): string {
  return new Intl.NumberFormat('en-MW', {
    style: 'currency',
    currency: 'MWK',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMwkCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `MK ${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)     return `MK ${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)         return `MK ${(value / 1_000).toFixed(0)}K`;
  return formatMwk(value);
}