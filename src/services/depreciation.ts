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
   * Annual reducing-balance rate expressed as a PERCENTAGE: 25 means 25% a
   * year, matching `asset_categories.mra_depreciation_rate` (form input is
   * `max="100"`, placeholder "e.g. 25", rendered as "25.0%") and every other
   * rate in this codebase — PAYE `band.rate`, TPR pension rates, loan
   * `ratePct`, invoice `discount_percent` — all of which are stored as
   * percentages and divided by 100 at the point of use.
   *
   * This previously expected a FRACTION (0.25 for 25%), making it the single
   * outlier in the codebase and leaving a 100x trap for whoever first wired
   * the category rate into an asset. Nothing writes
   * `fixed_assets.depreciation_rate` yet, so correcting the convention now is
   * behaviour-preserving in practice — see the unit tests.
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
    // Both operands are percentages: an explicit 25 means 25%/yr, and the
    // straight-line-equivalent fallback for a 10-year life is 100/10 = 10%/yr.
    const annualRatePercent = depreciationRate ?? (monthsLife ? 100 / (monthsLife / 12) : null);
    if (!annualRatePercent) throw new Error('Reducing-balance depreciation requires a rate or useful life.');
    const monthlyRate = annualRatePercent / 100 / 12;
    charge = remainingBookValue * monthlyRate;
  } else {
    throw new Error(`Depreciation method '${method}' is not yet supported by the automated posting engine.`);
  }

  // Never depreciate below residual value
  const maxAllowed = remainingBookValue - residualValue;
  return Math.max(0, Math.min(charge, maxAllowed));
}
