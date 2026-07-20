/**
 * Single source of truth for fiscal year format.
 *
 * CORRECTED: matches the actual convention used by seed_new_business's
 * paye_bands seed data ('2024/25' — two-digit second year), and accounts
 * for Malawi's fiscal year running July 1 - June 30
 * (businesses.financial_year_start = '07-01'), not the calendar year.
 *
 * Previous version(s) used calendar year and/or four-digit second year
 * ("2026", "2026/2027") — neither matches what's actually seeded in the
 * database, which is why user-added PAYE bands weren't being picked up.
 */
export function currentFiscalYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed: 6 = July
  const fyStartYear = month >= 6 ? year : year - 1;
  const fyEndYearShort = String((fyStartYear + 1) % 100).padStart(2, '0');
  return `${fyStartYear}/${fyEndYearShort}`;
}