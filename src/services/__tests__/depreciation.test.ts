import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyDepreciation,
  type DepreciationCalcInput,
} from '../depreciation';

/**
 * Depreciation drives both the P&L charge and the carrying amount on the
 * balance sheet. The two rules that matter most — never depreciate below
 * residual value, and stop once fully depreciated — are asserted directly,
 * since breaching either produces a negative net book value.
 */

function input(over: Partial<DepreciationCalcInput> = {}): DepreciationCalcInput {
  return {
    method: 'straight_line',
    acquisitionCost: 1_200_000,
    residualValue: 0,
    usefulLifeYears: 10,
    usefulLifeMonths: null,
    accumulatedDepreciation: 0,
    depreciationRate: null,
    ...over,
  } as DepreciationCalcInput;
}

describe('calculateMonthlyDepreciation', () => {
  describe('straight line', () => {
    it('spreads cost evenly over the useful life in months', () => {
      // 1,200,000 over 10 years = 120 months = 10,000/month
      expect(calculateMonthlyDepreciation(input())).toBeCloseTo(10_000, 6);
    });

    it('depreciates only the amount above residual value', () => {
      // (1,200,000 - 200,000) / 120 = 8,333.33/month
      const result = calculateMonthlyDepreciation(
        input({ residualValue: 200_000 }),
      );
      expect(result).toBeCloseTo(1_000_000 / 120, 6);
    });

    it('prefers an explicit month-based life over a year-based one', () => {
      const result = calculateMonthlyDepreciation(
        input({ usefulLifeYears: 10, usefulLifeMonths: 24 }),
      );
      expect(result).toBeCloseTo(1_200_000 / 24, 6);
    });

    it('throws when no useful life is supplied', () => {
      expect(() =>
        calculateMonthlyDepreciation(
          input({ usefulLifeYears: null, usefulLifeMonths: null }),
        ),
      ).toThrow(/useful life/i);
    });
  });

  describe('reducing balance', () => {
    // depreciationRate is a PERCENTAGE (24 == 24%/yr), matching
    // asset_categories.mra_depreciation_rate and every other rate in the
    // codebase (PAYE bands, TPR pension, loan ratePct, discount_percent).
    it('charges the monthly slice of the annual rate on net book value', () => {
      // NBV 1,000,000 at 24%/yr = 2%/month = 20,000
      const result = calculateMonthlyDepreciation(
        input({
          method: 'reducing_balance',
          acquisitionCost: 1_200_000,
          accumulatedDepreciation: 200_000,
          depreciationRate: 24,
        }),
      );
      expect(result).toBeCloseTo(20_000, 6);
    });

    it('accepts the category MRA rate directly, with no conversion', () => {
      // The whole point of aligning the units: asset_categories stores 25 for
      // 25%, so feeding that straight in must give a sane charge rather than
      // the clamped-to-full-cost result the old fraction convention produced.
      const mraCategoryRate = 25; // as stored in asset_categories
      const result = calculateMonthlyDepreciation(
        input({ method: 'reducing_balance', depreciationRate: mraCategoryRate }),
      );
      expect(result).toBeCloseTo(1_200_000 * (25 / 100 / 12), 6);
      expect(result).toBeLessThan(1_200_000); // not clamped
    });

    it('treats a fractional rate as a sub-1% rate, not as 24%', () => {
      // Guards against silently reverting to the old convention: 0.24 now means
      // 0.24%/yr, which is ~100x smaller than 24%/yr.
      const asPercent = calculateMonthlyDepreciation(
        input({ method: 'reducing_balance', depreciationRate: 24 }),
      );
      const asFraction = calculateMonthlyDepreciation(
        input({ method: 'reducing_balance', depreciationRate: 0.24 }),
      );
      expect(asPercent).toBeCloseTo(asFraction * 100, 6);
    });

    it('derives a rate from the useful life when none is given', () => {
      // 10 year life -> 100/10 = 10%/yr -> NBV 1,200,000 * (10/100/12) = 10,000
      const result = calculateMonthlyDepreciation(
        input({ method: 'reducing_balance', depreciationRate: null }),
      );
      expect(result).toBeCloseTo(10_000, 6);
    });

    it('derived fallback is unchanged by the fraction-to-percentage switch', () => {
      // Regression guard for the unit change: the fallback previously computed
      // `1 / (monthsLife / 12)` as a fraction and now computes
      // `100 / (monthsLife / 12)` as a percentage. Both reduce to the same
      // monthly rate, so every existing asset with a null depreciation_rate
      // must keep depreciating at exactly the same amount.
      for (const years of [3, 5, 10, 20]) {
        const result = calculateMonthlyDepreciation(
          input({ method: 'reducing_balance', usefulLifeYears: years, depreciationRate: null }),
        );
        const expectedLegacyMonthlyRate = 1 / (years * 12 / 12) / 12;
        expect(result).toBeCloseTo(1_200_000 * expectedLegacyMonthlyRate, 6);
      }
    });

    it('decreases as accumulated depreciation grows', () => {
      const early = calculateMonthlyDepreciation(
        input({ method: 'reducing_balance', depreciationRate: 24, accumulatedDepreciation: 0 }),
      );
      const later = calculateMonthlyDepreciation(
        input({
          method: 'reducing_balance',
          depreciationRate: 24,
          accumulatedDepreciation: 600_000,
        }),
      );
      expect(later).toBeLessThan(early);
    });
  });

  describe('guard rails', () => {
    it('returns zero once the asset is fully depreciated', () => {
      expect(
        calculateMonthlyDepreciation(input({ accumulatedDepreciation: 1_200_000 })),
      ).toBe(0);
    });

    it('returns zero once net book value has reached residual value', () => {
      expect(
        calculateMonthlyDepreciation(
          input({ residualValue: 200_000, accumulatedDepreciation: 1_000_000 }),
        ),
      ).toBe(0);
    });

    it('never charges more than the remaining depreciable amount', () => {
      // Only 5,000 of depreciable value left, but a full 10,000 slice is due.
      const result = calculateMonthlyDepreciation(
        input({ accumulatedDepreciation: 1_195_000 }),
      );
      expect(result).toBeCloseTo(5_000, 6);
    });

    it('never returns a negative charge', () => {
      const result = calculateMonthlyDepreciation(
        input({ residualValue: 500_000, accumulatedDepreciation: 800_000 }),
      );
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('cannot drive net book value below residual value over a full life', () => {
      const cost = 1_200_000;
      const residual = 200_000;
      let accumulated = 0;
      for (let month = 0; month < 240; month++) {
        accumulated += calculateMonthlyDepreciation(
          input({ acquisitionCost: cost, residualValue: residual, accumulatedDepreciation: accumulated }),
        );
      }
      expect(cost - accumulated).toBeGreaterThanOrEqual(residual - 0.005);
    });

    it('rejects an unsupported depreciation method', () => {
      expect(() =>
        calculateMonthlyDepreciation(
          input({ method: 'units_of_production' as DepreciationCalcInput['method'] }),
        ),
      ).toThrow(/not yet supported/i);
    });
  });
});
