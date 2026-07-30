/**
 * Tests for the pure helpers behind asset capitalisation.
 *
 * Register-era fixed assets were saved with no GL entry at all, so the SOFP
 * showed fixed assets at zero even when the register listed them. These
 * cover the shape of the backfill/create journal (buildCapitalisationLines)
 * and the idempotency filter (selectAssetsMissingCapitalisation) without a
 * database — same pattern as inventoryValuation.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { buildCapitalisationLines, selectAssetsMissingCapitalisation } from '@/lib/fixedAssetCapitalisation';

const base = {
  assetAccountId: 'acc-asset',
  fundingAccountId: 'acc-bank',
  amount: 250_000,
  description: 'Capitalisation — Delivery Van (FA-001)',
};

describe('buildCapitalisationLines', () => {
  it('posts an increase as DR asset / CR funding at the full cost', () => {
    const lines = buildCapitalisationLines({ ...base, direction: 'increase' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ account_id: 'acc-asset', is_debit: true, amount: 250_000, amount_base: 250_000 });
    expect(lines[1]).toMatchObject({ account_id: 'acc-bank', is_debit: false, amount: 250_000, amount_base: 250_000 });
  });

  it('posts a decrease as CR asset / DR funding (cost adjustment down)', () => {
    const lines = buildCapitalisationLines({ ...base, amount: 50_000, direction: 'decrease' });
    expect(lines[0]).toMatchObject({ account_id: 'acc-bank', is_debit: true, amount: 50_000 });
    expect(lines[1]).toMatchObject({ account_id: 'acc-asset', is_debit: false, amount: 50_000 });
  });

  it('always balances in functional currency (MWK, rate 1)', () => {
    for (const direction of ['increase', 'decrease'] as const) {
      const lines = buildCapitalisationLines({ ...base, direction });
      const debits = lines.filter((l) => l.is_debit).reduce((s, l) => s + l.amount_base, 0);
      const credits = lines.filter((l) => !l.is_debit).reduce((s, l) => s + l.amount_base, 0);
      expect(debits).toBe(credits);
    }
  });
});

describe('selectAssetsMissingCapitalisation', () => {
  const asset = (id: string, status: string) => ({ id, status });

  it('selects register assets with no capitalisation entry', () => {
    const missing = selectAssetsMissingCapitalisation(
      [asset('a', 'active'), asset('b', 'active')],
      new Set(['a']),
    );
    expect(missing.map((a) => a.id)).toEqual(['b']);
  });

  it('excludes disposed assets — capitalising them would resurrect a derecognised cost', () => {
    const missing = selectAssetsMissingCapitalisation(
      [asset('gone', 'disposed'), asset('kept', 'fully_depreciated')],
      new Set(),
    );
    expect(missing.map((a) => a.id)).toEqual(['kept']);
  });

  it('returns nothing when every asset is already capitalised', () => {
    expect(
      selectAssetsMissingCapitalisation([asset('a', 'active')], new Set(['a'])),
    ).toEqual([]);
  });
});
