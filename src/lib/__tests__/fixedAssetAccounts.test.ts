import { describe, expect, it } from 'vitest';
import { resolveAssetAccountLinks } from '../fixedAssetAccounts';

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
