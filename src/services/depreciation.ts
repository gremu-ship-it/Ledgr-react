/**
 * Pure depreciation arithmetic (IAS 16), with no database or Supabase imports.
 *
 * Split out of FixedAssetsJournalService so it can be unit-tested in isolation:
 * that module reaches lib/repositories.ts -> lib/supabase.ts, which throws at
 * import time when Supabase env vars are absent. Keeping the calculation in its
 * own leaf module means the tests exercise the maths without booting a client.
 */

import type { Row } from '@/dal/types/database';

export interface DepreciationCalcInput {
  method: Row<'fixed_assets'>['depreciation_method'];
  acquisitionCost: number;
  residualValue: number;
  usefulLifeYears: number | null;
  usefulLifeMonths: number | null;
  accumulatedDepreciation: number;
  /**
   * Annual reducing-balance rate expressed as a FRACTION, not a percentage:
   * 0.25 means 25% a year. This matches the derived fallback below
   * (`1 / (monthsLife / 12)`, which yields 0.1 for a ten-year life).
   *
   * ⚠ Note for whoever wires this up: `fixed_assets.depreciation_rate` is not
   * currently written anywhere in the app, so nothing exercises this path yet.
   * The neighbouring `asset_categories.mra_depreciation_rate` field IS a
   * percentage (the form input is `max="100"` with placeholder "e.g. 25" and
   * renders as "25.0%"). If that value is ever copied into this one, divide by
   * 100 first — feeding 25 in here would charge 25x the intended depreciation.
   */
  depreciationRate: number | null;
}

export function calculateMonthlyDepreciation(input: DepreciationCalcInput): number {
  const {
    method, acquisitionCost, residualValue,
    usefulLifeYears, usefulLifeMonths, accumulatedDepreciation, depreciationRate,
  } = input;

  const depreciableAmount = acquisitionCost - residualValue;
  const remainingBookValue = acquisitionCost - accumulatedDepreciation;
  const monthsLife = usefulLifeMonths ?? (usefulLifeYears ? usefulLifeYears * 12 : null);

  if (remainingBookValue <= residualValue) return 0; // fully depreciated

  let charge: number;

  if (method === 'straight_line') {
    if (!monthsLife) throw new Error('Straight-line depreciation requires a useful life.');
    charge = depreciableAmount / monthsLife;
  } else if (method === 'reducing_balance') {
    const annualRate = depreciationRate ?? (monthsLife ? 1 / (monthsLife / 12) : null);
    if (!annualRate) throw new Error('Reducing-balance depreciation requires a rate or useful life.');
    const monthlyRate = annualRate / 12;
    charge = remainingBookValue * monthlyRate;
  } else {
    throw new Error(`Depreciation method '${method}' is not yet supported by the automated posting engine.`);
  }

  // Never depreciate below residual value
  const maxAllowed = remainingBookValue - residualValue;
  return Math.max(0, Math.min(charge, maxAllowed));
}
