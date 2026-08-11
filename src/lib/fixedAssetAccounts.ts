export interface AssetAccountLinks {
  /**
   * A category normally controls this flag. It is also stored on an asset so
   * that an asset created before a category is edited still has an explicit
   * depreciation policy.
   */
  is_depreciable?: boolean | null;
  asset_account_id?: string | null;
  accumulated_dep_account_id?: string | null;
  dep_expense_account_id?: string | null;
}

export interface AssetCategoryDepreciationSettings {
  name?: string | null;
  is_depreciable?: boolean | null;
}

export interface ResolvedAssetAccountLinks {
  assetAccountId: string | null;
  accumulatedDepAccountId: string | null;
  depExpenseAccountId: string | null;
  missing: Array<'asset account' | 'accumulated depreciation account' | 'depreciation expense account'>;
}

/** Land is an indefinite-life asset and is not depreciated under IAS 16. */
export function isLandCategoryName(name?: string | null): boolean {
  return name?.trim().toLocaleLowerCase() === 'land';
}

/**
 * Resolves the depreciation policy for an asset/category pair.
 *
 * The explicit flag is the source of truth for newly migrated data, while the
 * name fallback keeps older Land categories safe until they have been saved by
 * the updated Categories form. A false value always wins, so a category that
 * is marked non-depreciable cannot accidentally be depreciated because an old
 * asset row still contains the previous default.
 */
export function isAssetDepreciable(
  asset: Pick<AssetAccountLinks, 'is_depreciable'>,
  category?: AssetCategoryDepreciationSettings | null,
): boolean {
  if (isLandCategoryName(category?.name)) return false;
  if (asset.is_depreciable === false || category?.is_depreciable === false) return false;
  if (asset.is_depreciable === true || category?.is_depreciable === true) return true;
  return true;
}

/**
 * Resolves an asset's GL overrides against its category defaults. Empty form
 * values are treated as absent in the same way as database nulls.
 *
 * Non-depreciable categories (most notably Land) only need the asset cost
 * account. Accumulated depreciation and depreciation expense accounts are not
 * required because no depreciation journal will ever be posted for them.
 */
export function resolveAssetAccountLinks(
  asset: AssetAccountLinks,
  category?: AssetCategoryDepreciationSettings & AssetAccountLinks | null,
): ResolvedAssetAccountLinks {
  const assetAccountId = asset.asset_account_id || category?.asset_account_id || null;
  const accumulatedDepAccountId =
    asset.accumulated_dep_account_id || category?.accumulated_dep_account_id || null;
  const depExpenseAccountId =
    asset.dep_expense_account_id || category?.dep_expense_account_id || null;
  const isDepreciable = isAssetDepreciable(asset, category);
  const missing: ResolvedAssetAccountLinks['missing'] = [];

  if (!assetAccountId) missing.push('asset account');
  if (isDepreciable && !accumulatedDepAccountId) {
    missing.push('accumulated depreciation account');
  }
  if (isDepreciable && !depExpenseAccountId) {
    missing.push('depreciation expense account');
  }

  return {
    assetAccountId,
    accumulatedDepAccountId,
    depExpenseAccountId,
    missing,
  };
}
