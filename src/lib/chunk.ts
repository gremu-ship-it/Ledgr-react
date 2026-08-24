/**
 * Split `items` into batches of at most `size`.
 *
 * Used before PostgREST `.in(...)` filters: a few hundred UUIDs already
 * blow the URL length limit and silently 400. 200 is a conservative default
 * that stays well under typical gateway caps.
 */
export function chunk<T>(items: readonly T[], size = 200): T[][] {
  if (size <= 0) {
    throw new Error('chunk size must be a positive integer');
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
