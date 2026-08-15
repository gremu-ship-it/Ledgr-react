import { describe, it, expect } from 'vitest';
import { calculatePAYE, FALLBACK_PAYE_BANDS, type PayeBand } from '../paye';

/**
 * PAYE is the amount withheld from every employee and remitted to the MRA.
 * A silent error here under-withholds tax across an entire payroll run, so the
 * marginal-band arithmetic is pinned down explicitly at each boundary.
 *
 * The fallback bands are the APPROVED Phase 9.2 structure (MRA effective
 * 30 Dec 2025), stored as ANNUAL equivalents:
 *   0%  to K2,040,000 · 30% to K18,840,000 · 35% to K120,000,000 · 40% above.
 */
describe('calculatePAYE', () => {
  describe('with the approved MRA fallback bands (0% / 30% / 35% / 40%)', () => {
    const paye = (annual: number) => calculatePAYE(annual, []);

    it('charges nothing inside the tax-free band (2,040,000 annual = 170,000/mo)', () => {
      expect(paye(0)).toBe(0);
      expect(paye(600_000)).toBe(0);
      expect(paye(1_200_000)).toBe(0);
      expect(paye(2_040_000)).toBe(0); // exactly at the threshold
    });

    it('taxes only the slice above the threshold, not the whole salary', () => {
      // 500,000/mo = 6,000,000 annual: (6,000,000 - 2,040,000) * 30% =
      // 1,188,000/yr -> 99,000/mo (matches the statutory worked example)
      expect(paye(6_000_000)).toBeCloseTo(99_000, 6);
    });

    it('applies the 30% band marginally across its full range', () => {
      // full 30% band: (18,840,000 - 2,040,000) * 30% = 5,040,000/yr
      expect(paye(18_840_000)).toBeCloseTo(5_040_000 / 12, 6);
    });

    it('applies the 35% band to income above 18,840,000', () => {
      // 2,000,000/mo = 24,000,000 annual:
      //   30% band: 16,800,000 * 30% = 5,040,000
      //   35% band:  5,160,000 * 35% = 1,806,000
      //   total 6,846,000/yr -> 570,500/mo
      expect(paye(24_000_000)).toBeCloseTo(570_500, 6);
    });

    it('applies the 40% top band above 120,000,000', () => {
      // 12,000,000/mo = 144,000,000 annual:
      //   30% band: 16,800,000 * 30% = 5,040,000
      //   35% band: 101,160,000 * 35% = 35,406,000
      //   40% band:  24,000,000 * 40% = 9,600,000
      //   total 50,046,000/yr -> 4,170,500/mo
      expect(paye(144_000_000)).toBeCloseTo(4_170_500, 6);
    });

    it('returns a MONTHLY figure, i.e. one twelfth of the annual charge', () => {
      const annualCharge = 6_846_000;
      expect(paye(24_000_000) * 12).toBeCloseTo(annualCharge, 6);
    });

    it('is monotonic — earning more never reduces tax', () => {
      const salaries = [0, 500_000, 2_040_000, 3_000_000, 18_840_000, 24_000_000, 144_000_000];
      const taxes = salaries.map(paye);
      for (let i = 1; i < taxes.length; i++) {
        expect(taxes[i]).toBeGreaterThanOrEqual(taxes[i - 1]);
      }
    });

    it('never exceeds the top marginal rate overall', () => {
      const gross = 500_000_000;
      const effectiveRate = (paye(gross) * 12) / gross;
      expect(effectiveRate).toBeLessThan(0.4);
    });

    it('uses the exported fallback constant when bands are empty', () => {
      expect(calculatePAYE(24_000_000, [])).toBe(
        calculatePAYE(24_000_000, FALLBACK_PAYE_BANDS),
      );
    });
  });

  describe('with business-configured bands', () => {
    const flatBands: PayeBand[] = [{ band_from: 0, band_to: null, rate: 10 }];

    it('honours a custom flat-rate band instead of the MRA defaults', () => {
      expect(calculatePAYE(1_200_000, flatBands)).toBeCloseTo(120_000 / 12, 6);
    });

    it('handles an open-ended top band (band_to = null)', () => {
      const bands: PayeBand[] = [
        { band_from: 0, band_to: 100_000, rate: 0 },
        { band_from: 100_000, band_to: null, rate: 20 },
      ];
      // (1,000,000 - 100,000) * 20% = 180,000/yr
      expect(calculatePAYE(1_000_000, bands)).toBeCloseTo(180_000 / 12, 6);
    });

    it('ignores bands entirely above the salary', () => {
      const bands: PayeBand[] = [
        { band_from: 0, band_to: 100_000, rate: 10 },
        { band_from: 5_000_000, band_to: null, rate: 40 },
      ];
      // only the first band applies: 100,000 * 10% = 10,000/yr
      expect(calculatePAYE(200_000, bands)).toBeCloseTo(10_000 / 12, 6);
    });
  });
});
