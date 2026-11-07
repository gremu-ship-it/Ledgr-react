/**
 * A positive result is an overage, a negative result a shortage, and zero is
 * an exact cash count. The server's close command remains authoritative and
 * independently computes the signed variance when the shift is closed.
 */
export function calculateShiftVariance(actualCash: number, expectedCash: number): number {
  return Number(actualCash) - Number(expectedCash);
}
