/**
 * PAYE (Pay As You Earn) calculation for Malawi.
 *
 * Extracted verbatim from PayrollPage.tsx so it can be unit-tested. This is the
 * single most consequential pure function in the app — it determines what is
 * withheld from every employee's salary and remitted to the MRA — and it was
 * previously unreachable by tests, trapped inside a 1,000-line page component.
 *
 * The bands are progressive/marginal: each slice of annual gross is taxed at
 * its own band's rate, not the whole amount at the top rate.
 */

export interface PayeBand {
  band_from: number;
  band_to: number | null;
  rate: number; // percentage, e.g. 25 means 25%
}

/**
 * MRA fallback bands, used when a business has not configured its own for the
 * current fiscal year. Kept as an exported constant so tests (and the UI) can
 * assert against the same numbers the calculation uses.
 */
export const FALLBACK_PAYE_BANDS: PayeBand[] = [
  { band_from: 0, band_to: 1_200_000, rate: 0 },
  { band_from: 1_200_000, band_to: 2_400_000, rate: 25 },
  { band_from: 2_400_000, band_to: null, rate: 35 },
];

/**
 * Returns the MONTHLY PAYE due for a given ANNUAL gross salary.
 *
 * @param annualGross Annual gross pay in MWK.
 * @param bands       Business-configured bands; falls back to MRA defaults when empty.
 */
export function calculatePAYE(annualGross: number, bands: PayeBand[]): number {
  const effectiveBands = bands.length === 0 ? FALLBACK_PAYE_BANDS : bands;

  let tax = 0;
  for (const band of effectiveBands) {
    if (annualGross <= band.band_from) break;
    const upper = band.band_to ?? Infinity;
    const taxable = Math.min(annualGross, upper) - band.band_from;
    if (taxable <= 0) continue;
    tax += taxable * (band.rate / 100);
  }
  return tax / 12;
}
