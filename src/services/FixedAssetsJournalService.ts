/**
 * FixedAssetJournalService — posts IAS 16-compliant journal entries for
 * fixed asset depreciation, disposal, and revaluation.
 *
 * Mirrors journalService.ts's pattern: build balanced lines, call
 * repos.journal.createBalancedEntry() then repos.journal.post(), then
 * update the asset/schedule rows to reflect the posting.
 *
 * Account resolution: fixed_assets and asset_categories already store
 * direct account_id foreign keys (asset_account_id, accumulated_dep_
 * account_id, dep_expense_account_id, revaluation_surplus_account).
 * An asset's own fields take precedence; falls back to its category's
 * defaults if the asset's own fields are null.
 */

import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function nextEntryNumber(): Promise<string> {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}`;
  return `JNL-${stamp}`;
}

function monthName(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

interface ResolvedAssetAccounts {
  assetAccountId: string;
  accumulatedDepAccountId: string;
  depExpenseAccountId: string;
}

async function resolveAssetAccounts(
  asset: Row<'fixed_assets'>,
): Promise<ResolvedAssetAccounts> {
  let assetAccountId = asset.asset_account_id;
  let accumulatedDepAccountId = asset.accumulated_dep_account_id;
  let depExpenseAccountId = asset.dep_expense_account_id;

  if (!assetAccountId || !accumulatedDepAccountId || !depExpenseAccountId) {
    const categories = await repos.asset.findCategories(asset.business_id);
    const category = categories.find((c) => c.id === asset.category_id);
    if (!category) {
      throw new Error(
        `Asset ${asset.name} (${asset.asset_number}) has no linked accounts and its category could not be found.`,
      );
    }
    assetAccountId ??= category.asset_account_id;
    accumulatedDepAccountId ??= category.accumulated_dep_account_id;
    depExpenseAccountId ??= category.dep_expense_account_id;
  }

  if (!assetAccountId || !accumulatedDepAccountId || !depExpenseAccountId) {
    throw new Error(
      `Asset ${asset.name} (${asset.asset_number}) is missing one or more required GL account links ` +
      `(asset / accumulated depreciation / depreciation expense), and its category has no defaults set.`,
    );
  }

  return { assetAccountId, accumulatedDepAccountId, depExpenseAccountId };
}

// ── Depreciation calculation (pure, no DB) ────────────────────────────────────

export interface DepreciationCalcInput {
  method: Row<'fixed_assets'>['depreciation_method'];
  acquisitionCost: number;
  residualValue: number;
  usefulLifeYears: number | null;
  usefulLifeMonths: number | null;
  accumulatedDepreciation: number;
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

// ── Monthly Depreciation Run ──────────────────────────────────────────────────

export interface DepreciationRunResult {
  assetId: string;
  assetName: string;
  charge: number;
  journalEntryId: string;
  skipped?: string; // reason, if skipped
}

/**
 * Posts depreciation for all active, non-fully-depreciated assets for a
 * given accounting period. One journal entry per asset:
 *   DR Depreciation Expense
 *   CR Accumulated Depreciation
 *
 * Blocks posting into a closed period. Skips assets already depreciated
 * for this period (checked via depreciation_schedules).
 */
export async function postAssetDepreciation(
  businessId: string,
  periodId: string,
  postedBy: string,
): Promise<DepreciationRunResult[]> {
  const period = await repos.period.findById(periodId);
  if (period.is_closed) {
    throw new Error(`Cannot post depreciation: period "${period.name}" is closed.`);
  }

  const assets = await repos.asset.findByBusiness(businessId);
  const results: DepreciationRunResult[] = [];

  for (const asset of assets) {
    if (asset.status !== 'active' || !asset.is_active) {
      continue;
    }

    // Skip if already posted for this exact period
    const existingSchedules = await repos.asset.findDepreciationSchedule(businessId, asset.id);
    const alreadyPosted = existingSchedules.some(
      (s) => s.posted && s.period_start === period.period_start && s.period_end === period.period_end,
    );
    if (alreadyPosted) {
      results.push({
        assetId: asset.id,
        assetName: asset.name,
        charge: 0,
        journalEntryId: '',
        skipped: 'Already depreciated for this period.',
      });
      continue;
    }

    const charge = calculateMonthlyDepreciation({
      method: asset.depreciation_method,
      acquisitionCost: asset.acquisition_cost,
      residualValue: asset.residual_value,
      usefulLifeYears: asset.useful_life_years,
      usefulLifeMonths: asset.useful_life_months,
      accumulatedDepreciation: asset.accumulated_depreciation,
      depreciationRate: asset.depreciation_rate,
    });

    if (charge <= 0) {
      results.push({
        assetId: asset.id,
        assetName: asset.name,
        charge: 0,
        journalEntryId: '',
        skipped: 'Fully depreciated — no charge due.',
      });
      continue;
    }

    const { accumulatedDepAccountId, depExpenseAccountId } = await resolveAssetAccounts(asset);
    const entryNumber = await nextEntryNumber();
    const monthLabel = monthName(period.period_end);
    const description = `Auto-depreciation — ${asset.name} — ${monthLabel}`;

    const { entry } = await repos.journal.createBalancedEntry(
      {
        business_id: businessId,
        entry_number: entryNumber,
        entry_date: period.period_end,
        description,
        source_type: 'fixed_asset_depreciation',
        source_id: asset.id,
        currency: 'MWK',
        exchange_rate: 1,
        status: 'draft',
        period_id: periodId,
        branch_id: asset.branch_id,
        department_id: asset.department_id,
        created_by: postedBy,
      },
      [
        {
          line_number: 1,
          account_id: depExpenseAccountId,
          description,
          is_debit: true,
          amount: charge,
          amount_base: charge,
          currency: 'MWK',
          exchange_rate: 1,
          tax_code: 'none',
          tax_amount: 0,
          reconciled: false,
        },
        {
          line_number: 2,
          account_id: accumulatedDepAccountId,
          description,
          is_debit: false,
          amount: charge,
          amount_base: charge,
          currency: 'MWK',
          exchange_rate: 1,
          tax_code: 'none',
          tax_amount: 0,
          reconciled: false,
        },
      ],
    );

    await repos.journal.post(entry.id, postedBy);

    const newAccumulated = asset.accumulated_depreciation + charge;
    const newNetBookValue = asset.acquisition_cost - newAccumulated;

    await repos.asset.recordDepreciation(
      {
        business_id: businessId,
        asset_id: asset.id,
        period_start: period.period_start,
        period_end: period.period_end,
        depreciation_charge: charge,
        accumulated_to_date: newAccumulated,
        net_book_value: newNetBookValue,
        journal_entry_id: entry.id,
      },
      postedBy,
    );

    if (newNetBookValue <= asset.residual_value + 0.01) {
      await repos.asset.markFullyDepreciated(asset.id);
    }

    results.push({
      assetId: asset.id,
      assetName: asset.name,
      charge,
      journalEntryId: entry.id,
    });
  }

  return results;
}

// ── Disposal ──────────────────────────────────────────────────────────────────

export interface DisposalResult {
  journalEntryId: string;
  gainLoss: number;
}

/**
 * Disposes an asset:
 *   DR Accumulated Depreciation (reverse it out)
 *   DR Cash/Receivable (proceeds, if any)
 *   DR Loss on Disposal (if disposal is a loss)
 *   CR Fixed Asset (at cost)
 *   CR Gain on Disposal (if disposal is a gain)
 *
 * Gain/loss = proceeds - net book value at disposal date.
 *
 * Gain on disposal posts to account 4910 (Other Income, 4000s per the
 * COA design — matches "Other Income" bucket).
 * Loss on disposal posts to account 6910 (Operating Expense, 6000s per
 * the COA design — a disposal loss is an operating expense, not a
 * finance cost, so it does NOT use the 7000s Finance Costs range).
 */
export async function disposeAsset(
  businessId: string,
  assetId: string,
  disposalDate: string,
  proceeds: number,
  proceedsAccountId: string,
  postedBy: string,
): Promise<DisposalResult> {
  const asset = await repos.asset.findById(assetId);
  if (asset.status === 'disposed') {
    throw new Error(`Asset ${asset.name} has already been disposed.`);
  }

  const { assetAccountId, accumulatedDepAccountId } = await resolveAssetAccounts(asset);
  const netBookValue = asset.acquisition_cost - asset.accumulated_depreciation;
  const gainLoss = proceeds - netBookValue;

  const gainLossSubtype = gainLoss >= 0 ? 'other_income' : 'operating_expense';
  const gainLossAccountType = gainLoss >= 0 ? 'income' : 'expense';
  const gainLossAccount = await repos.account.findOrCreateBySubtype(
    businessId,
    gainLossSubtype,
    gainLossAccountType,
    {
      code: gainLoss >= 0 ? '4910' : '6910',
      name: gainLoss >= 0 ? 'Gain on Disposal of Fixed Assets' : 'Loss on Disposal of Fixed Assets',
      normalBalance: gainLoss >= 0 ? 'credit' : 'debit',
    },
  );

  const entryNumber = await nextEntryNumber();
  const description = `Disposal — ${asset.name} (${asset.asset_number})`;

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [];
  let lineNumber = 1;

  lines.push({
    line_number: lineNumber++,
    account_id: accumulatedDepAccountId,
    description: `${description} — reverse accumulated depreciation`,
    is_debit: true,
    amount: asset.accumulated_depreciation,
    amount_base: asset.accumulated_depreciation,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none',
    tax_amount: 0,
    reconciled: false,
  });

  if (proceeds > 0) {
    lines.push({
      line_number: lineNumber++,
      account_id: proceedsAccountId,
      description: `${description} — proceeds received`,
      is_debit: true,
      amount: proceeds,
      amount_base: proceeds,
      currency: 'MWK',
      exchange_rate: 1,
      tax_code: 'none',
      tax_amount: 0,
      reconciled: false,
    });
  }

  if (gainLoss < 0) {
    lines.push({
      line_number: lineNumber++,
      account_id: gainLossAccount.id,
      description: `${description} — loss on disposal`,
      is_debit: true,
      amount: Math.abs(gainLoss),
      amount_base: Math.abs(gainLoss),
      currency: 'MWK',
      exchange_rate: 1,
      tax_code: 'none',
      tax_amount: 0,
      reconciled: false,
    });
  }

  lines.push({
    line_number: lineNumber++,
    account_id: assetAccountId,
    description: `${description} — derecognise cost`,
    is_debit: false,
    amount: asset.acquisition_cost,
    amount_base: asset.acquisition_cost,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none',
    tax_amount: 0,
    reconciled: false,
  });

  if (gainLoss > 0) {
    lines.push({
      line_number: lineNumber++,
      account_id: gainLossAccount.id,
      description: `${description} — gain on disposal`,
      is_debit: false,
      amount: gainLoss,
      amount_base: gainLoss,
      currency: 'MWK',
      exchange_rate: 1,
      tax_code: 'none',
      tax_amount: 0,
      reconciled: false,
    });
  }

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: businessId,
      entry_number: entryNumber,
      entry_date: disposalDate,
      description,
      source_type: 'fixed_asset_disposal',
      source_id: asset.id,
      currency: 'MWK',
      exchange_rate: 1,
      status: 'draft',
      branch_id: asset.branch_id,
      department_id: asset.department_id,
      created_by: postedBy,
    },
    lines,
  );

  await repos.journal.post(entry.id, postedBy);
  await repos.asset.dispose(assetId, disposalDate, proceeds, entry.id);

  return { journalEntryId: entry.id, gainLoss };
}

// ── Revaluation ────────────────────────────────────────────────────────────────

export interface RevaluationResult {
  journalEntryId: string;
  surplus: number;
}

/**
 * Upward revaluation per IAS 16 — the surplus is posted to a Revaluation
 * Reserve within equity (never through P&L), auto-resolved by
 * account_subtype='reserves' if not already configured.
 *
 *   DR Fixed Asset (increase to revalued amount)
 *   CR Revaluation Reserve (equity)
 *
 * Only supports upward revaluation, per the stated requirement.
 */
export async function revalueAsset(
  businessId: string,
  assetId: string,
  revaluationDate: string,
  newValue: number,
  postedBy: string,
): Promise<RevaluationResult> {
  const asset = await repos.asset.findById(assetId);
  const netBookValue = asset.acquisition_cost - asset.accumulated_depreciation;
  const surplus = newValue - netBookValue;

  if (surplus <= 0) {
    throw new Error(
      'Only upward revaluations are supported. The new value must exceed the current net book value.',
    );
  }

  const { assetAccountId } = await resolveAssetAccounts(asset);

  const reserveAccount = await repos.account.findOrCreateBySubtype(
    businessId,
    'reserves',
    'equity',
    {
      code: '3200',
      name: 'Revaluation Reserve',
      normalBalance: 'credit',
    },
  );

  const entryNumber = await nextEntryNumber();
  const description = `Revaluation — ${asset.name} (${asset.asset_number})`;

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: businessId,
      entry_number: entryNumber,
      entry_date: revaluationDate,
      description,
      source_type: 'fixed_asset_revaluation',
      source_id: asset.id,
      currency: 'MWK',
      exchange_rate: 1,
      status: 'draft',
      branch_id: asset.branch_id,
      department_id: asset.department_id,
      created_by: postedBy,
    },
    [
      {
        line_number: 1,
        account_id: assetAccountId,
        description,
        is_debit: true,
        amount: surplus,
        amount_base: surplus,
        currency: 'MWK',
        exchange_rate: 1,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      },
      {
        line_number: 2,
        account_id: reserveAccount.id,
        description,
        is_debit: false,
        amount: surplus,
        amount_base: surplus,
        currency: 'MWK',
        exchange_rate: 1,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      },
    ],
  );

  await repos.journal.post(entry.id, postedBy);
  await repos.asset.revalue(assetId, revaluationDate, newValue, reserveAccount.id);

  return { journalEntryId: entry.id, surplus };
}