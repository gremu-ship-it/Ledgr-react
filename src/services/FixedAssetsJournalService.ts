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
import { supabase } from '@/lib/supabase';
import {
  isAssetDepreciable,
  resolveAssetAccountLinks,
} from '@/lib/fixedAssetAccounts';
import type { Row } from '@/dal/types/database';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Phase 10.4: DB-backed sequence (JNL-YYYYMMDD-NNNNNN) so journal numbers are
// unique regardless of client/edge clock skew. Falls back to the timestamp
// format only if the RPC is unavailable (e.g. pre-migration environments).
export async function nextEntryNumber(): Promise<string> {
  try {
    const { data, error } = await (supabase as unknown as {
      rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('next_journal_entry_number', { p_business_id: null });
    if (!error && typeof data === 'string' && data) return data;
  } catch {
    // fall through to timestamp fallback
  }
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
  accumulatedDepAccountId: string | null;
  depExpenseAccountId: string | null;
  isDepreciable: boolean;
}

async function resolveAssetAccounts(
  asset: Row<'fixed_assets'>,
  categoryOverride?: Row<'asset_categories'> | null,
): Promise<ResolvedAssetAccounts> {
  // Always resolve the category when account links are needed: an asset can be
  // non-depreciable while still inheriting its cost account from the category.
  // This also keeps older Land rows safe when they still have all three
  // account overrides populated.
  const category = categoryOverride === undefined
    ? await repos.asset.findCategoryById(asset.business_id, asset.category_id)
    : categoryOverride;
  const resolved = resolveAssetAccountLinks(asset, category);

  if (resolved.missing.length > 0) {
    const categoryLabel = category ? `category "${category.name}"` : 'the selected category';
    throw new Error(
      `Asset ${asset.name} (${asset.asset_number}) is missing: ${resolved.missing.join(', ')}. ` +
      `Set these as defaults on ${categoryLabel}, or set them under the asset's GL account overrides.`,
    );
  }

  return {
    assetAccountId: resolved.assetAccountId!,
    accumulatedDepAccountId: resolved.accumulatedDepAccountId,
    depExpenseAccountId: resolved.depExpenseAccountId,
    isDepreciable: isAssetDepreciable(asset, category),
  };
}

// ── Depreciation calculation (pure, no DB) ────────────────────────────────────

// The pure depreciation arithmetic lives in @/services/depreciation (a leaf
// module with no Supabase import chain) so it can be unit-tested in isolation.
// Re-exported here so the service remains the single entry point for
// fixed-asset posting logic (same pattern as fixedAssetCapitalisation).
export {
  calculateMonthlyDepreciation,
  type DepreciationCalcInput,
} from '@/services/depreciation';
import { calculateMonthlyDepreciation } from '@/services/depreciation';

// ── Capitalisation (acquisition) ──────────────────────────────────────────────

// The pure capitalisation helpers live in @/lib/fixedAssetCapitalisation so
// they carry no Supabase dependency and can be unit-tested without a
// database (same pattern as inventoryValuation.ts). Re-exported here so the
// service remains the single entry point for fixed-asset posting logic.
export {
  buildCapitalisationLines,
  postedCapitalisedAssetIds,
  selectAssetsMissingCapitalisation,
} from '@/lib/fixedAssetCapitalisation';
import {
  buildCapitalisationLines,
  postedCapitalisedAssetIds,
  selectAssetsMissingCapitalisation,
} from '@/lib/fixedAssetCapitalisation';

/**
 * Returns assets with a POSTED acquisition journal. Draft entries are not
 * effective in the ledger and must not block a retry/backfill. In particular,
 * the two-step create-then-post flow can leave a draft if posting is rejected;
 * the SOFP also excludes drafts, so counting one here made the asset disappear
 * from both the ledger report and its uncapitalised-register fallback.
 */
async function findCapitalisedAssetIds(businessId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('source_id, status')
    .eq('business_id', businessId)
    .eq('source_type', 'fixed_asset_acquisition')
    .eq('status', 'posted');
  if (error) throw error;
  return postedCapitalisedAssetIds(data ?? []);
}

export interface CapitalisationResult {
  assetId: string;
  assetName: string;
  amount: number;
  journalEntryId: string;
  skipped?: string;
}

/**
 * Posts the capitalisation (acquisition) journal for ONE asset:
 *   DR Fixed Asset account (cost) / CR funding account (bank / creditor /
 *   capital), dated at the acquisition date.
 *
 * BACKGROUND: fixed_assets register rows were created without any GL entry,
 * so the SOFP (a GL report) showed fixed assets at zero even when the
 * register listed assets. Depreciation/disposal/revaluation journals existed;
 * the initial capitalisation was the missing leg.
 *
 * Idempotent: an asset that already has a posted capitalisation entry is
 * skipped. Draft/failed and reversed entries do not block a retry. Delta
 * postings (cost edited after capitalisation) pass
 * amountOverride + direction so only the CHANGE is posted.
 */
export async function postAssetCapitalisation(
  businessId: string,
  asset: Row<'fixed_assets'>,
  fundingAccountId: string,
  postedBy: string,
  options?: {
    amountOverride?: number;
    direction?: 'increase' | 'decrease';
    entryDate?: string;
    descriptionSuffix?: string;
    idempotencyCheck?: boolean;
    entryNumberSuffix?: string;
  },
): Promise<CapitalisationResult> {
  if (options?.idempotencyCheck ?? true) {
    const capitalised = await findCapitalisedAssetIds(businessId);
    if (capitalised.has(asset.id)) {
      return {
        assetId: asset.id,
        assetName: asset.name,
        amount: 0,
        journalEntryId: '',
        skipped: 'Capitalisation entry already posted for this asset.',
      };
    }
  }

  const amount = options?.amountOverride ?? asset.acquisition_cost;
  if (!(amount > 0)) {
    return {
      assetId: asset.id,
      assetName: asset.name,
      amount: 0,
      journalEntryId: '',
      skipped: 'Zero capitalisation amount — nothing to post.',
    };
  }

  const { assetAccountId } = await resolveAssetAccounts(asset);
  const direction = options?.direction ?? 'increase';
  const description =
    `Capitalisation — ${asset.name} (${asset.asset_number})` +
    (options?.descriptionSuffix ?? '');

  const entryNumber = `${await nextEntryNumber()}${options?.entryNumberSuffix ?? ''}`;
  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: businessId,
      entry_number: entryNumber,
      entry_date: options?.entryDate ?? asset.acquisition_date,
      description,
      reference: asset.purchase_invoice_ref ?? null,
      source_type: 'fixed_asset_acquisition',
      source_id: asset.id,
      currency: 'MWK',
      exchange_rate: 1,
      status: 'draft',
      branch_id: asset.branch_id,
      department_id: asset.department_id,
      created_by: postedBy,
    },
    buildCapitalisationLines({
      assetAccountId,
      fundingAccountId,
      amount,
      description,
      direction,
    }),
  );

  await repos.journal.post(entry.id, postedBy);
  return { assetId: asset.id, assetName: asset.name, amount, journalEntryId: entry.id };
}

/**
 * Keeps the GL in step when an asset row is saved from the form:
 *  - no capitalisation entry yet (register-era asset, CSV import) → post the
 *    FULL acquisition cost;
 *  - entry exists and the cost changed → post only the DELTA (increase or
 *    decrease), dated today with a 'cost adjustment' note;
 *  - entry exists and cost unchanged → nothing.
 */
export async function syncAssetCapitalisation(
  businessId: string,
  asset: Row<'fixed_assets'>,
  previousAcquisitionCost: number,
  fundingAccountId: string,
  postedBy: string,
): Promise<CapitalisationResult | null> {
  const capitalised = await findCapitalisedAssetIds(businessId);
  if (!capitalised.has(asset.id)) {
    if (asset.status === 'disposed') return null;
    return postAssetCapitalisation(businessId, asset, fundingAccountId, postedBy, {
      idempotencyCheck: false,
    });
  }

  const delta = asset.acquisition_cost - previousAcquisitionCost;
  if (Math.abs(delta) < 0.005) return null;
  return postAssetCapitalisation(businessId, asset, fundingAccountId, postedBy, {
    amountOverride: Math.abs(delta),
    direction: delta > 0 ? 'increase' : 'decrease',
    entryDate: new Date().toISOString().slice(0, 10),
    descriptionSuffix: delta > 0 ? ' — cost adjustment' : ' — cost adjustment (decrease)',
    idempotencyCheck: false,
  });
}

/**
 * Backfill: posts capitalisation journals for every non-disposed register
 * asset that lacks one. Funding is user-chosen (how the assets were actually
 * paid for — bank, creditor or owner capital). Idempotent via
 * findCapitalisedAssetIds + the per-call check in postAssetCapitalisation.
 */
export async function backfillAssetCapitalisation(
  businessId: string,
  fundingAccountId: string,
  postedBy: string,
): Promise<CapitalisationResult[]> {
  const [assets, capitalised] = await Promise.all([
    repos.asset.findByBusiness(businessId),
    findCapitalisedAssetIds(businessId),
  ]);
  const missing = selectAssetsMissingCapitalisation(assets, capitalised);

  const results: CapitalisationResult[] = [];
  for (let i = 0; i < missing.length; i++) {
    results.push(
      await postAssetCapitalisation(businessId, missing[i], fundingAccountId, postedBy, {
        idempotencyCheck: false, // already filtered against the snapshot above
        // Timestamp-based entry numbers can collide within the same second in
        // a loop — disambiguate with the index.
        entryNumberSuffix: `-CAP${i + 1}`,
      }),
    );
  }
  return results;
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

    // Resolve the policy before checking accounts or doing the arithmetic.
    // Land and any other non-depreciable category must never reach the
    // calculation (which would otherwise require a useful life and could turn
    // a data-entry omission into a posting error).
    const category = await repos.asset.findCategoryById(businessId, asset.category_id);
    if (!isAssetDepreciable(asset, category)) {
      results.push({
        assetId: asset.id,
        assetName: asset.name,
        charge: 0,
        journalEntryId: '',
        skipped: 'Non-depreciable asset — no charge due.',
      });
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

    const resolvedAccounts = await resolveAssetAccounts(asset, category);

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

    const accumulatedDepAccountId = resolvedAccounts.accumulatedDepAccountId!;
    const depExpenseAccountId = resolvedAccounts.depExpenseAccountId!;
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

  if (asset.accumulated_depreciation > 0 && !accumulatedDepAccountId) {
    throw new Error(
      `Asset ${asset.name} has accumulated depreciation but no accumulated depreciation account.`,
    );
  }
  if (asset.accumulated_depreciation > 0) {
    lines.push({
      line_number: lineNumber++,
      account_id: accumulatedDepAccountId!,
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
  }

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
      line_number: lineNumber + 1,
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