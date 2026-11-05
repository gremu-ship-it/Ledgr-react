import { describe, expect, it } from 'vitest';
import { calculateShiftVariance } from '../shiftReconciliation';

describe('calculateShiftVariance', () => {
  it('reports a cash surplus as a positive variance', () => {
    expect(calculateShiftVariance(172500, 170000)).toBe(2500);
  });

  it('reports a cash shortage as a negative variance', () => {
    expect(calculateShiftVariance(167500, 170000)).toBe(-2500);
  });

  it('reports zero when the cash count matches expected cash', () => {
    expect(calculateShiftVariance(170000, 170000)).toBe(0);
  });
});
