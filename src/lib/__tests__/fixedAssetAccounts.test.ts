import { describe, expect, it } from 'vitest';
import { isAssetDepreciable, resolveAssetAccountLinks } from '../fixedAssetAccounts';

describe('resolveAssetAccountLinks', () => {
  it('inherits all required GL links from the selected category', () => {
    expect(resolveAssetAccountLinks(
      {
        asset_account_id: null,
        accumulated_dep_account_id: null,
        dep_expense_account_id: null,
      },
      {
        asset_account_id: 'asset-cost',
        accumulated_dep_account_id: 'accumulated-depreciation',
        dep_expense_account_id: 'depreciation-expense',
      },
    )).toEqual({
      assetAccountId: 'asset-cost',
      accumulatedDepAccountId: 'accumulated-depreciation',
      depExpenseAccountId: 'depreciation-expense',
      missing: [],
    });
  });

  it('keeps asset overrides ahead of category defaults', () => {
    expect(resolveAssetAccountLinks(
      {
        asset_account_id: 'asset-override',
        accumulated_dep_account_id: '',
        dep_expense_account_id: null,
      },
      {
        asset_account_id: 'category-asset',
        accumulated_dep_account_id: 'category-accumulated',
        dep_expense_account_id: 'category-expense',
      },
    )).toMatchObject({
      assetAccountId: 'asset-override',
      accumulatedDepAccountId: 'category-accumulated',
      depExpenseAccountId: 'category-expense',
      missing: [],
    });
  });

  it('does not require depreciation accounts for Land', () => {
    expect(resolveAssetAccountLinks(
      {},
      { name: 'Land', asset_account_id: 'land-account' },
    )).toEqual({
      assetAccountId: 'land-account',
      accumulatedDepAccountId: null,
      depExpenseAccountId: null,
      missing: [],
    });
  });

  it('reports only the cost account when a non-depreciable category has no GL link', () => {
    expect(resolveAssetAccountLinks({}, { name: 'Land' }).missing).toEqual(['asset account']);
  });

  it('recognises Land as non-depreciable even before the category is migrated', () => {
    expect(isAssetDepreciable({}, { name: 'Land' })).toBe(false);
  });

  it('allows an explicit non-depreciable flag for categories other than Land', () => {
    expect(resolveAssetAccountLinks(
      {},
      { name: 'Freehold Property', is_depreciable: false, asset_account_id: 'property-account' },
    ).missing).toEqual([]);
  });

  it('reports the exact links still missing instead of restarting a vague loop', () => {
    expect(resolveAssetAccountLinks(
      {},
      { asset_account_id: 'asset-cost' },
    ).missing).toEqual([
      'accumulated depreciation account',
      'depreciation expense account',
    ]);
  });
});
