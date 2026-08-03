/**
 * Integration tests for FixedAssetsJournalService (IAS 16).
 *
 * `repos` and the bare supabase client are mocked at the module boundary;
 * every journal entry the service builds is captured and asserted.
 *
 * The invariants that matter:
 *   - Depreciation: Dr depreciation expense / Cr accumulated depreciation,
 *     with the charge capped so NBV never goes below residual value, period
 *     idempotency (no double-posting into the same period), and category
 *     account fallbacks kicking in when an asset has no own account links.
 *   - Disposal: NBV = cost − accumulated depreciation; proceeds above NBV
 *     credit a GAIN account, below NBV debit a LOSS account; the entry
 *     always balances and line numbers stay contiguous.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Row } from '@/dal/types/database';

// ── Captured calls ────────────────────────────────────────────────────────────

type JournalLine = {
  line_number: number;
  account_id: string;
  description: string;
  is_debit: boolean;
  amount: number;
  amount_base: number;
};

const createdEntries: { header: Record<string, unknown>; lines: JournalLine[] }[] = [];
const postedEntryIds: string[] = [];
const depreciationRecords: Record<string, unknown>[] = [];
const fullyDepreciatedIds: string[] = [];
const disposedAssets: Record<string, unknown>[] = [];
const createdGainLossAccounts: Record<string, unknown>[] = [];

let periodRow: Partial<Row<'accounting_periods'>> = {};
let assetRows: Row<'fixed_assets'>[] = [];
let categoryRows: Row<'asset_categories'>[] = [];
let scheduleRows: Row<'depreciation_schedules'>[] = [];

vi.mock('@/lib/repositories', () => ({
  repos: {
    period: {
      findById: () => Promise.resolve(periodRow),
    },
    asset: {
      findByBusiness: () => Promise.resolve(assetRows),
      findById: (id: string) => Promise.resolve(assetRows.find((a) => a.id === id) ?? null),
      findDepreciationSchedule: (_biz: string, assetId: string) =>
        Promise.resolve(scheduleRows.filter((s) => s.asset_id === assetId)),
      findCategories: () => Promise.resolve(categoryRows),
      recordDepreciation: (row: Record<string, unknown>) => {
        depreciationRecords.push(row);
        return Promise.resolve(row);
      },
      markFullyDepreciated: (id: string) => {
        fullyDepreciatedIds.push(id);
        return Promise.resolve({ id });
      },
      dispose: (id: string, date: string, proceeds: number, entryId: string) => {
        disposedAssets.push({ id, date, proceeds, entryId });
        return Promise.resolve({ id });
      },
    },
    account: {
      findOrCreateBySubtype: (_biz: string, _subtype: string, _type: string, seed: Record<string, unknown>) => {
        createdGainLossAccounts.push(seed);
        return Promise.resolve({ id: `acc-${(seed.code as string).toLowerCase()}`, ...seed });
      },
    },
    journal: {
      createBalancedEntry: (header: Record<string, unknown>, lines: JournalLine[]) => {
        createdEntries.push({ header, lines });
        return Promise.resolve({ entry: { id: `entry-${createdEntries.length}` }, lines });
      },
      post: (id: string) => {
        postedEntryIds.push(id);
        return Promise.resolve({ id });
      },
    },
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop) =>
          prop === 'then'
            ? (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
                onFulfilled({ data: [], error: null })
            : () => proxy,
      });
      return proxy;
    },
  },
}));

import { postAssetDepreciation, disposeAsset } from '@/services/FixedAssetsJournalService';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function openPeriod(): Partial<Row<'accounting_periods'>> {
  return {
    id: 'period-1',
    name: 'July 2026',
    is_closed: false,
    period_start: '2026-07-01',
    period_end: '2026-07-31',
  };
}

function makeAsset(overrides: Partial<Row<'fixed_assets'>>): Row<'fixed_assets'> {
  return {
    id: 'asset-1',
    business_id: 'biz-1',
    name: 'Delivery Vehicle',
    asset_number: 'FA-001',
    category_id: 'cat-vehicles',
    status: 'active',
    is_active: true,
    acquisition_cost: 12_000_000,
    residual_value: 2_000_000,
    useful_life_years: 5,
    useful_life_months: null,
    accumulated_depreciation: 0,
    depreciation_method: 'straight_line',
    depreciation_rate: null,
    asset_account_id: null,
    accumulated_dep_account_id: null,
    dep_expense_account_id: null,
    branch_id: null,
    department_id: null,
    ...overrides,
  } as Row<'fixed_assets'>;
}

function vehicleCategory(): Row<'asset_categories'> {
  return {
    id: 'cat-vehicles',
    asset_account_id: 'acc-vehicles',
    accumulated_dep_account_id: 'acc-accum-dep',
    dep_expense_account_id: 'acc-dep-expense',
  } as Row<'asset_categories'>;
}

function sumBase(lines: JournalLine[], debit: boolean): number {
  return lines.filter((l) => l.is_debit === debit).reduce((s, l) => s + l.amount_base, 0);
}

beforeEach(() => {
  createdEntries.length = 0;
  postedEntryIds.length = 0;
  depreciationRecords.length = 0;
  fullyDepreciatedIds.length = 0;
  disposedAssets.length = 0;
  createdGainLossAccounts.length = 0;
  periodRow = openPeriod();
  assetRows = [];
  categoryRows = [vehicleCategory()];
  scheduleRows = [];
});

// ── Depreciation run ──────────────────────────────────────────────────────────

describe('postAssetDepreciation', () => {
  it('posts Dr depreciation expense / Cr accumulated depreciation at the monthly charge', async () => {
    // 12,000,000 cost − 2,000,000 residual over 5 years = 166,666.67/month
    assetRows = [makeAsset({})];
    const results = await postAssetDepreciation('biz-1', 'period-1', 'user-1');

    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBeUndefined();
    expect(results[0].charge).toBeCloseTo((12_000_000 - 2_000_000) / 60, 2);

    const { lines, header } = createdEntries[0];
    expect(sumBase(lines, true)).toBeCloseTo(sumBase(lines, false), 6);
    expect(lines[0].account_id).toBe('acc-dep-expense');  // from CATEGORY fallback
    expect(lines[0].is_debit).toBe(true);
    expect(lines[1].account_id).toBe('acc-accum-dep');
    expect(lines[1].is_debit).toBe(false);
    expect(header.period_id).toBe('period-1');
  });

  it('records the schedule row with new accumulated + NBV, marking fully-depreciated at residual', async () => {
    // One month from the end: accumulated leaves NBV just above residual
    assetRows = [makeAsset({ accumulated_depreciation: 9_900_000 })];
    await postAssetDepreciation('biz-1', 'period-1', 'user-1');

    // charge is capped so NBV lands exactly on residual (not below)
    const record = depreciationRecords[0] as {
      depreciation_charge: number;
      accumulated_to_date: number;
      net_book_value: number;
    };
    expect(record.accumulated_to_date).toBeCloseTo(10_000_000, 2);
    expect(record.net_book_value).toBeCloseTo(2_000_000, 2);
    expect(fullyDepreciatedIds).toEqual(['asset-1']);
  });

  it('is idempotent: already-posted assets are skipped, never double-posted', async () => {
    assetRows = [makeAsset({})];
    scheduleRows = [{
      asset_id: 'asset-1',
      posted: true,
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    } as Row<'depreciation_schedules'>];

    const results = await postAssetDepreciation('biz-1', 'period-1', 'user-1');
    expect(results[0].charge).toBe(0);
    expect(results[0].skipped).toMatch(/already depreciated/i);
    expect(createdEntries).toHaveLength(0);
  });

  it('skips fully-depreciated and inactive assets without posting', async () => {
    assetRows = [
      makeAsset({ id: 'a-full', accumulated_depreciation: 10_000_000 }),
      makeAsset({ id: 'a-sold', status: 'disposed' }),
      makeAsset({ id: 'a-off', is_active: false }),
    ];
    const results = await postAssetDepreciation('biz-1', 'period-1', 'user-1');
    expect(results.every((r) => r.charge === 0)).toBe(true);
    expect(createdEntries).toHaveLength(0);
  });

  it('throws into a CLOSED period rather than posting', async () => {
    periodRow = { ...openPeriod(), is_closed: true };
    assetRows = [makeAsset({})];
    await expect(postAssetDepreciation('biz-1', 'period-1', 'user-1'))
      .rejects.toThrow(/closed/i);
    expect(createdEntries).toHaveLength(0);
  });

  it('fails loudly when neither asset nor category links GL accounts', async () => {
    categoryRows = [];
    assetRows = [makeAsset({ category_id: 'cat-unknown' })];
    await expect(postAssetDepreciation('biz-1', 'period-1', 'user-1'))
      .rejects.toThrow(/no linked accounts|missing one or more/i);
  });
});

// ── Disposal ──────────────────────────────────────────────────────────────────

describe('disposeAsset', () => {
  it('books a GAIN when proceeds exceed NBV (balanced, contiguous lines)', async () => {
    // cost 12m, accum 5m → NBV 7m; sold for 8.5m → gain 1.5m
    assetRows = [makeAsset({ accumulated_depreciation: 5_000_000 })];
    const result = await disposeAsset('biz-1', 'asset-1', '2026-08-01', 8_500_000, 'acc-bank', 'user-1');

    expect(result.gainLoss).toBeCloseTo(1_500_000, 2);

    const { lines } = createdEntries[0];
    expect(sumBase(lines, true)).toBeCloseTo(sumBase(lines, false), 2);
    expect(lines.map((l) => l.line_number)).toEqual([1, 2, 3, 4]);

    expect(lines[0]).toMatchObject({ account_id: 'acc-accum-dep', is_debit: true, amount_base: 5_000_000 });
    expect(lines[1]).toMatchObject({ account_id: 'acc-bank', is_debit: true, amount_base: 8_500_000 });
    expect(lines[2]).toMatchObject({ account_id: 'acc-vehicles', is_debit: false, amount_base: 12_000_000 });
    expect(lines[3]).toMatchObject({ account_id: 'acc-4910', is_debit: false, amount_base: 1_500_000 });

    // the gain account was resolved as credit-normal other income
    expect(createdGainLossAccounts[0]).toMatchObject({ code: '4910', normalBalance: 'credit' });
    expect(disposedAssets).toEqual([{ id: 'asset-1', date: '2026-08-01', proceeds: 8_500_000, entryId: 'entry-1' }]);
  });

  it('books a LOSS when proceeds are below NBV (debit-side, expense account)', async () => {
    // NBV 7m; scrapped for 500k → loss 6.5m
    assetRows = [makeAsset({ accumulated_depreciation: 5_000_000 })];
    const result = await disposeAsset('biz-1', 'asset-1', '2026-08-01', 500_000, 'acc-bank', 'user-1');

    expect(result.gainLoss).toBeCloseTo(-6_500_000, 2);

    const { lines } = createdEntries[0];
    expect(sumBase(lines, true)).toBeCloseTo(sumBase(lines, false), 2);
    expect(lines.map((l) => l.line_number)).toEqual([1, 2, 3, 4]);

    const loss = lines.find((l) => l.account_id === 'acc-6910')!;
    expect(loss.is_debit).toBe(true);
    expect(loss.amount_base).toBe(6_500_000);
    expect(createdGainLossAccounts[0]).toMatchObject({ code: '6910', normalBalance: 'debit' });
  });

  it('omits the proceeds line when scrapped for nothing (loss = full NBV)', async () => {
    assetRows = [makeAsset({ accumulated_depreciation: 5_000_000 })];
    await disposeAsset('biz-1', 'asset-1', '2026-08-01', 0, 'acc-bank', 'user-1');

    const { lines } = createdEntries[0];
    expect(lines).toHaveLength(3); // accum dep + loss + derecognise
    expect(lines.some((l) => l.account_id === 'acc-bank')).toBe(false);
    expect(sumBase(lines, true)).toBeCloseTo(sumBase(lines, false), 2);
    expect(lines.find((l) => l.account_id === 'acc-6910')?.amount_base).toBe(7_000_000);
  });

  it('refuses to dispose an already-disposed asset', async () => {
    assetRows = [makeAsset({ status: 'disposed' })];
    await expect(disposeAsset('biz-1', 'asset-1', '2026-08-01', 0, 'acc-bank', 'user-1'))
      .rejects.toThrow(/already been disposed/i);
    expect(createdEntries).toHaveLength(0);
  });

  it('refuses to post into an account id missing from the category fallback', async () => {
    categoryRows = [{
      ...vehicleCategory(),
      asset_account_id: null,
      accumulated_dep_account_id: null,
      dep_expense_account_id: null,
    } as unknown as Row<'asset_categories'>];
    assetRows = [makeAsset({})];
    await expect(disposeAsset('biz-1', 'asset-1', '2026-08-01', 0, 'acc-bank', 'user-1'))
      .rejects.toThrow(/missing one or more/i);
  });
});
