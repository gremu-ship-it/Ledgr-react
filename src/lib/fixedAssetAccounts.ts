export interface AssetAccountLinks {
  asset_account_id?: string | null;
  accumulated_dep_account_id?: string | null;
  dep_expense_account_id?: string | null;
}

export interface ResolvedAssetAccountLinks {
  assetAccountId: string | null;
  accumulatedDepAccountId: string | null;
  depExpenseAccountId: string | null;
  missing: Array<'asset account' | 'accumulated depreciation account' | 'depreciation expense account'>;
}

/**
 * Resolves an asset's GL overrides against its category defaults. Empty form
 * values are treated as absent in the same way as database nulls.
 */
export function resolveAssetAccountLinks(
  asset: AssetAccountLinks,
  category?: AssetAccountLinks | null,
): ResolvedAssetAccountLinks {
  const assetAccountId = asset.asset_account_id || category?.asset_account_id || null;
  const accumulatedDepAccountId =
    asset.accumulated_dep_account_id || category?.accumulated_dep_account_id || null;
  const depExpenseAccountId =
    asset.dep_expense_account_id || category?.dep_expense_account_id || null;
  const missing: ResolvedAssetAccountLinks['missing'] = [];

  if (!assetAccountId) missing.push('asset account');
  if (!accumulatedDepAccountId) missing.push('accumulated depreciation account');
  if (!depExpenseAccountId) missing.push('depreciation expense account');

  return {
    assetAccountId,
    accumulatedDepAccountId,
    depExpenseAccountId,
    missing,
  };
}
