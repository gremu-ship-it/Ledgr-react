import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DepreciationRepository } from '@/dal/repositories/DepreciationRepository';

interface QueryCall { table: string; method: string; args: unknown[]; }
type Handler = (table: string, action: string, payload: unknown, calls: QueryCall[]) => { data: unknown; error?: { message: string } | null };

function createClient(handler: Handler) {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      let action = 'select';
      let payload: unknown;
      const builder: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === 'insert' || method === 'update' || method === 'delete') {
          action = method;
          payload = args[0];
        }
        return builder;
      };
      for (const method of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'is', 'order']) builder[method] = chain(method);
      builder.insert = chain('insert');
      builder.update = chain('update');
      builder.delete = chain('delete');
      builder.single = async () => {
        const result = handler(table, action, payload, calls);
        return { data: Array.isArray(result.data) ? result.data[0] : result.data, error: result.error ?? null };
      };
      builder.maybeSingle = builder.single;
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(handler(table, action, payload, calls)).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as never, calls };
}

const category = {
  id: 'category-1', business_id: 'biz-1', name: 'Equipment', is_active: true, is_depreciable: true,
  depreciation_method: 'straight_line', useful_life_years: 10, residual_percent: 10,
  mra_depreciation_rate: 24, asset_account_id: 'asset-account',
  accumulated_dep_account_id: 'accum-account', dep_expense_account_id: 'expense-account', created_at: '2026-01-01T00:00:00Z',
};
const asset = {
  id: 'asset-1', business_id: 'biz-1', category_id: category.id, asset_number: 'FA-001', name: 'Generator',
  status: 'active', is_active: true, is_depreciable: true, deleted_at: null,
  acquisition_cost: 1_200_000, accumulated_depreciation: 200_000, net_book_value: 1_000_000,
  residual_value: 200_000, useful_life_months: 120, useful_life_years: 10,
  depreciation_method: 'straight_line', depreciation_rate: null, depreciation_start_date: '2026-01-01',
  dep_expense_account_id: null, accumulated_dep_account_id: null, branch_id: null, department_id: null,
  revalued_amount: null, depreciable_amount: null,
};

function mocksForRun() {
  const createBalancedEntry = vi.fn().mockResolvedValue({
    entry: { id: 'journal-1', entry_number: 'JNL-0001', status: 'draft' }, lines: [],
  });
  const post = vi.fn().mockResolvedValue({ id: 'journal-1', entry_number: 'JNL-0001', status: 'posted' });
  const findByPostingKey = vi.fn().mockResolvedValue(null);
  const recordDepreciation = vi.fn().mockResolvedValue({ schedule: {}, asset: {} });
  const markFullyDepreciated = vi.fn().mockResolvedValue({});
  return {
    journal: { createBalancedEntry, post, findByPostingKey },
    assets: { recordDepreciation, markFullyDepreciated },
    nextEntryNumber: vi.fn().mockResolvedValue('JNL-0001'),
  };
}

describe('DepreciationRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calculates straight-line depreciation over a multi-month period', async () => {
    const { client } = createClient((table) => table === 'fixed_assets' ? { data: asset } : { data: category });
    const repository = new DepreciationRepository(client);
    await expect(repository.calculateDepreciation(asset.id, '2026-01-01', '2026-03-31')).resolves.toBe(25_000);
  });

  it('calculates reducing-balance depreciation from net book value and category rate', async () => {
    const reducingAsset = { ...asset, depreciation_method: 'reducing_balance', depreciation_rate: null, net_book_value: 500_000 };
    const { client } = createClient((table) => table === 'fixed_assets' ? { data: reducingAsset } : { data: category });
    const repository = new DepreciationRepository(client);
    await expect(repository.calculateDepreciation(asset.id, '2026-01-01', '2026-03-31')).resolves.toBe(30_000);
  });

  it('caps depreciation at the remaining amount above salvage value', async () => {
    const nearResidualAsset = { ...asset, accumulated_depreciation: 999_500, net_book_value: 200_500 };
    const { client } = createClient((table) => table === 'fixed_assets' ? { data: nearResidualAsset } : { data: category });
    const repository = new DepreciationRepository(client);
    await expect(repository.calculateDepreciation(asset.id, '2026-01-01', '2026-03-31')).resolves.toBe(500);
  });

  it('posts one balanced depreciation journal per asset and records the schedule', async () => {
    const { client } = createClient((table) => {
      if (table === 'fixed_assets') return { data: [asset] };
      if (table === 'asset_categories') return { data: [category] };
      if (table === 'depreciation_schedules') return { data: [] };
      if (table === 'businesses') return { data: { base_currency: 'MWK' } };
      if (table === 'accounting_periods') return { data: [] };
      return { data: [] };
    });
    const deps = mocksForRun();
    const repository = new DepreciationRepository(client, deps);
    const result = await repository.runDepreciation('biz-1', '2026-01-01', '2026-01-31', 'user-1');
    expect(result).toMatchObject({ assetsProcessed: 1, totalAmount: 8_333.33, alreadyRun: false });
    expect(result.journalEntryIds).toEqual(['journal-1']);
    expect(deps.journal.createBalancedEntry).toHaveBeenCalledWith(expect.objectContaining({
      source_type: 'depreciation', source_id: asset.id, status: 'draft', currency: 'MWK',
    }), expect.arrayContaining([
      expect.objectContaining({ account_id: 'expense-account', is_debit: true, amount_base: 8_333.33 }),
      expect.objectContaining({ account_id: 'accum-account', is_debit: false, amount_base: 8_333.33 }),
    ]));
    expect(deps.journal.post).toHaveBeenCalledWith('journal-1', 'user-1');
    expect(deps.assets.recordDepreciation).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'biz-1', asset_id: asset.id, depreciation_charge: 8_333.33,
      period_start: '2026-01-01', period_end: '2026-01-31', journal_entry_id: 'journal-1',
    }), 'user-1');
  });

  it('returns history records with their corresponding journal entry numbers', async () => {
    const schedule = {
      id: 'schedule-1', business_id: 'biz-1', asset_id: asset.id, period_start: '2026-01-01', period_end: '2026-01-31',
      depreciation_charge: 8_333.33, accumulated_to_date: 208_333.33, net_book_value: 991_666.67,
      journal_entry_id: 'journal-1', posted: true, posted_at: '2026-02-01T00:00:00Z', posted_by: 'user-1', created_at: '2026-02-01T00:00:00Z',
    };
    const { client } = createClient((table) => {
      if (table === 'depreciation_schedules') return { data: [schedule] };
      if (table === 'fixed_assets') return { data: [{ id: asset.id, name: asset.name }] };
      if (table === 'journal_entries') return { data: [{ id: 'journal-1', entry_number: 'JNL-0001' }] };
      return { data: [] };
    });
    const history = await new DepreciationRepository(client).getDepreciationHistory('biz-1');
    expect(history).toEqual([expect.objectContaining({
      assetId: asset.id, assetName: 'Generator', periodStart: '2026-01-01', periodEnd: '2026-01-31',
      depreciationCharge: 8_333.33, journalEntryId: 'journal-1', journalEntryNumber: 'JNL-0001',
    })]);
  });
});
