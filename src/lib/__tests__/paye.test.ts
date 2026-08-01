import { describe, it, expect } from 'vitest';
import { calculatePAYE, FALLBACK_PAYE_BANDS, type PayeBand } from '../paye';

/**
 * PAYE is the amount withheld from every employee and remitted to the MRA.
 * A silent error here under-withholds tax across an entire payroll run, so the
 * marginal-band arithmetic is pinned down explicitly at each boundary.
 */
describe('calculatePAYE', () => {
  describe('with the MRA fallback bands (0% / 25% / 35%)', () => {
    const paye = (annual: number) => calculatePAYE(annual, []);

    it('charges nothing inside the tax-free band', () => {
      expect(paye(0)).toBe(0);
      expect(paye(600_000)).toBe(0);
      expect(paye(1_200_000)).toBe(0); // exactly at the threshold
    });

    it('taxes only the slice above the threshold, not the whole salary', () => {
      // 1,400,000 annual: first 1.2m free, next 200,000 at 25% = 50,000/yr
      expect(paye(1_400_000)).toBeCloseTo(50_000 / 12, 6);
    });

    it('applies each band marginally across the 25% band', () => {
      // full 25% band: 1.2m taxed at 25% = 300,000/yr
      expect(paye(2_400_000)).toBeCloseTo(300_000 / 12, 6);
    });

    it('applies the top 35% band only to income above 2.4m', () => {
      // 300,000 (from the 25% band) + 600,000*0.35 = 210,000 -> 510,000/yr
      expect(paye(3_000_000)).toBeCloseTo(510_000 / 12, 6);
    });

    it('returns a MONTHLY figure, i.e. one twelfth of the annual charge', () => {
      const annualCharge = 510_000;
      expect(paye(3_000_000) * 12).toBeCloseTo(annualCharge, 6);
    });

    it('is monotonic — earning more never reduces tax', () => {
      const salaries = [0, 500_000, 1_200_000, 1_500_000, 2_400_000, 5_000_000, 20_000_000];
      const taxes = salaries.map(paye);
      for (let i = 1; i < taxes.length; i++) {
        expect(taxes[i]).toBeGreaterThanOrEqual(taxes[i - 1]);
      }
    });

    it('never exceeds the top marginal rate overall', () => {
      const gross = 50_000_000;
      const effectiveRate = (paye(gross) * 12) / gross;
      expect(effectiveRate).toBeLessThan(0.35);
    });

    it('uses the exported fallback constant when bands are empty', () => {
      expect(calculatePAYE(3_000_000, [])).toBe(
        calculatePAYE(3_000_000, FALLBACK_PAYE_BANDS),
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
