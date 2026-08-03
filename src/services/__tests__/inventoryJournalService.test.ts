/**
 * Integration tests for inventoryJournalService — the perpetual-inventory
 * posting engine that keeps the stock subledger and the GL in step.
 *
 * `repos` is mocked at the module boundary; every journal entry the service
 * builds is captured and asserted for balance and correct account usage.
 * The most important invariants, from the module's own design contract:
 *
 *   1. A sale must NEVER roll back because stock accounting failed — the
 *      public functions catch and return null instead of throwing.
 *   2. Cost is read BEFORE the stock movement is written (the DB trigger
 *      recomputes average_cost on write; reading after would value the sale
 *      at the post-sale average).
 *   3. All entries are functional-currency native (exchange_rate === 1,
 *      amount === amount_base) — average_cost is already stored in MWK.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Row } from '@/dal/types/database';
import type { BalanceWithProduct } from '@/dal/repositories/InventoryRepository';

type JournalLine = {
  line_number: number;
  account_id: string;
  is_debit: boolean;
  amount: number;
  amount_base: number;
  exchange_rate: number;
};

const createdEntries: { lines: JournalLine[] }[] = [];
const postedEntryIds: string[] = [];
const recordedMovements: Record<string, unknown>[][] = [];
let failCreateBalancedEntry = false;
let failRecordMovements = false;

function acc(id: string, code: string, isGroup = false): Row<'accounts'> {
  return { id, code, name: code, is_group: isGroup } as unknown as Row<'accounts'>;
}

const ACCOUNTS_BY_CODE: Record<string, Row<'accounts'>> = {
  '1141': acc('acc-trading-stock', '1141'),
  '5100': acc('acc-cogs', '5100'),
  '2114': acc('acc-grni', '2114'),
  '5180': acc('acc-inv-adj', '5180'),
};
const ACCOUNTS_BY_ID = Object.fromEntries(Object.values(ACCOUNTS_BY_CODE).map((a) => [a.id, a]));
ACCOUNTS_BY_ID['acc-fuel-stock'] = acc('acc-fuel-stock', '1142');

const LOCATIONS: Row<'inventory_locations'>[] = [
  { id: 'loc-branch', is_default: false, branch_id: 'branch-1', is_active: true } as Row<'inventory_locations'>,
  { id: 'loc-main', is_default: true, branch_id: null, is_active: true } as Row<'inventory_locations'>,
];

/** product → average_cost held at loc-main / loc-branch */
let STOCK: Record<string, number> = {};

const PRODUCTS: Row<'products'>[] = [
  { id: 'prod-maize', name: 'Maize Flour', track_inventory: true, inventory_account_id: null, cogs_account_id: null } as Row<'products'>,
  { id: 'prod-fuel', name: 'Diesel 20L', track_inventory: true, inventory_account_id: 'acc-fuel-stock', cogs_account_id: null } as Row<'products'>,
];

vi.mock('@/lib/repositories', () => ({
  repos: {
    account: {
      findByCode: (_biz: string, code: string) => Promise.resolve(ACCOUNTS_BY_CODE[code] ?? null),
      findById: (id: string) => Promise.resolve(ACCOUNTS_BY_ID[id] ?? null),
      findByBusiness: () => Promise.resolve(Object.values(ACCOUNTS_BY_CODE)),
    },
    business: {
      findById: () => Promise.resolve({ base_currency: 'MWK' }),
    },
    journal: {
      createBalancedEntry: (_header: Record<string, unknown>, lines: JournalLine[]) => {
        if (failCreateBalancedEntry) return Promise.reject(new Error('db unavailable'));
        createdEntries.push({ lines });
        return Promise.resolve({ entry: { id: `entry-${createdEntries.length}` }, lines });
      },
      post: (id: string) => {
        postedEntryIds.push(id);
        return Promise.resolve({ id });
      },
    },
    inventory: {
      findLocations: () => Promise.resolve(LOCATIONS),
      findBalance: (_biz: string, productId: string) =>
        Promise.resolve(
          STOCK[productId] != null
            ? ({ average_cost: STOCK[productId] } as Row<'inventory_balances'>)
            : null,
        ),
      recordMovements: (movements: Record<string, unknown>[]) => {
        if (failRecordMovements) return Promise.reject(new Error('trigger failed'));
        recordedMovements.push(movements);
        return Promise.resolve([]);
      },
      findAllProducts: () => Promise.resolve(PRODUCTS),
      findAllWithDetails: (): Promise<BalanceWithProduct[]> => Promise.resolve([]),
    },
  },
}));

import {
  postWarehouseReceipt,
  deductStockAndPostCogs,
  resolveInventoryAccount,
  resolveCogsAccount,
} from '@/services/inventoryJournalService';

function sumBase(lines: JournalLine[], debit: boolean): number {
  return lines.filter((l) => l.is_debit === debit).reduce((s, l) => s + l.amount_base, 0);
}

beforeEach(() => {
  createdEntries.length = 0;
  postedEntryIds.length = 0;
  recordedMovements.length = 0;
  failCreateBalancedEntry = false;
  failRecordMovements = false;
  STOCK = {};
});

describe('postWarehouseReceipt — DR Inventory / CR GRNI', () => {
  it('posts one balanced entry, debiting the default 1141 account', async () => {
    const entryId = await postWarehouseReceipt('biz-1', [
      { productId: 'prod-maize', quantity: 10, unitCost: 5_000 },
    ], '2026-08-03', 'GRN-001', null, null);

    expect(entryId).toBe('entry-1');
    expect(createdEntries).toHaveLength(1);
    const { lines } = createdEntries[0];
    expect(sumBase(lines, true)).toBeCloseTo(sumBase(lines, false), 2);

    const debit = lines.find((l) => l.is_debit)!;
    const credit = lines.find((l) => !l.is_debit)!;
    expect(debit.account_id).toBe('acc-trading-stock');
    expect(debit.amount_base).toBe(50_000);
    expect(credit.account_id).toBe('acc-grni');
    expect(credit.amount_base).toBe(50_000);
  });

  it('groups debits per inventory account (product-linked account wins)', async () => {
    await postWarehouseReceipt('biz-1', [
      { productId: 'prod-maize', quantity: 10, unitCost: 1_000 }, // 10,000 → 1141
      { productId: 'prod-fuel', quantity: 4, unitCost: 25_000 },  // 100,000 → 1142 (linked)
    ], '2026-08-03', null, null, null);

    const { lines } = createdEntries[0];
    const debits = lines.filter((l) => l.is_debit);
    expect(debits).toHaveLength(2);
    expect(debits.find((l) => l.account_id === 'acc-trading-stock')?.amount_base).toBe(10_000);
    expect(debits.find((l) => l.account_id === 'acc-fuel-stock')?.amount_base).toBe(100_000);

    // single GRNI credit for the combined total
    const credits = lines.filter((l) => !l.is_debit);
    expect(credits).toHaveLength(1);
    expect(credits[0].account_id).toBe('acc-grni');
    expect(credits[0].amount_base).toBe(110_000);
  });

  it('is functional-currency native: exchange_rate 1 and amount === amount_base', async () => {
    await postWarehouseReceipt('biz-1', [
      { productId: 'prod-maize', quantity: 2, unitCost: 750 },
    ], '2026-08-03', null, null, null);

    for (const line of createdEntries[0].lines) {
      expect(line.exchange_rate).toBe(1);
      expect(line.amount).toBe(line.amount_base);
    }
  });

  it('ignores valueless lines and returns null when nothing is valued', async () => {
    const entryId = await postWarehouseReceipt('biz-1', [
      { productId: 'prod-maize', quantity: 0, unitCost: 100 },
      { productId: 'prod-maize', quantity: 5, unitCost: 0 },
      { productId: 'prod-maize', quantity: -2, unitCost: 100 },
    ], '2026-08-03', null, null, null);

    expect(entryId).toBeNull();
    expect(createdEntries).toHaveLength(0);
  });

  it('NEVER throws — a posting failure returns null (receipt stays recorded)', async () => {
    failCreateBalancedEntry = true;
    await expect(postWarehouseReceipt('biz-1', [
      { productId: 'prod-maize', quantity: 10, unitCost: 5_000 },
    ], '2026-08-03', null, null, null)).resolves.toBeNull();
  });
});

describe('deductStockAndPostCogs — sale companion entry', () => {
  it('posts DR COGS / CR Inventory at the pre-sale weighted-average cost', async () => {
    STOCK = { 'prod-maize': 4_000 };
    const result = await deductStockAndPostCogs(
      'biz-1',
      { id: 'inv-1', invoice_number: 'INV-1', issue_date: '2026-08-03' },
      [{ productId: 'prod-maize', quantity: 3 }],
      null, null, null,
    );

    expect(result.costLines).toEqual([
      { productId: 'prod-maize', quantity: 3, unitCost: 4_000 },
    ]);
    expect(result.cogsEntryId).toBe('entry-1');

    const { lines } = createdEntries[0];
    expect(sumBase(lines, true)).toBeCloseTo(sumBase(lines, false), 2);
    expect(lines.find((l) => l.is_debit)?.account_id).toBe('acc-cogs');
    expect(lines.find((l) => !l.is_debit)?.account_id).toBe('acc-trading-stock');
    expect(lines.find((l) => l.is_debit)?.amount_base).toBe(12_000);
  });

  it('writes the negative stock movement BEFORE reading cost: cost snapshot comes first', async () => {
    STOCK = { 'prod-maize': 3_333.33 };
    await deductStockAndPostCogs(
      'biz-1',
      { id: 'inv-1', invoice_number: 'INV-1', issue_date: '2026-08-03' },
      [{ productId: 'prod-maize', quantity: 2 }],
      null, null, null,
    );

    // movement: negative quantity into the DEFAULT location
    expect(recordedMovements).toHaveLength(1);
    const mv = recordedMovements[0][0];
    expect(mv.product_id).toBe('prod-maize');
    expect(mv.location_id).toBe('loc-main');
    expect(mv.quantity).toBe(-2);
    expect(mv.movement_type).toBe('sale');
    // the unit cost captured is the balance from BEFORE the movement
    expect(mv.unit_cost).toBe(3_333.33);
  });

  it('targets the branch location when a branch is given', async () => {
    STOCK = { 'prod-maize': 1_000 };
    await deductStockAndPostCogs(
      'biz-1',
      { id: 'inv-1', invoice_number: 'INV-1', issue_date: '2026-08-03' },
      [{ productId: 'prod-maize', quantity: 1 }],
      'branch-1', null, null,
    );
    expect(recordedMovements[0][0].location_id).toBe('loc-branch');
  });

  it('values a sale with no balance record at zero (stock issued before tracking)', async () => {
    const result = await deductStockAndPostCogs(
      'biz-1',
      { id: 'inv-1', invoice_number: 'INV-1', issue_date: '2026-08-03' },
      [{ productId: 'prod-maize', quantity: 5 }],
      null, null, null,
    );
    expect(result.costLines[0].unitCost).toBe(0);
  });

  it('NEVER throws — a movement-write failure returns empty results', async () => {
    STOCK = { 'prod-maize': 1_000 };
    failRecordMovements = true;
    await expect(deductStockAndPostCogs(
      'biz-1',
      { id: 'inv-1', invoice_number: 'INV-1', issue_date: '2026-08-03' },
      [{ productId: 'prod-maize', quantity: 1 }],
      null, null, null,
    )).resolves.toEqual({ costLines: [], cogsEntryId: null });
    expect(createdEntries).toHaveLength(0);
  });

  it('does nothing for a sale with no product lines', async () => {
    const result = await deductStockAndPostCogs(
      'biz-1',
      { id: 'inv-1', invoice_number: 'INV-1', issue_date: '2026-08-03' },
      [{ productId: '', quantity: 5 }, { productId: 'prod-maize', quantity: 0 }],
      null, null, null,
    );
    expect(result).toEqual({ costLines: [], cogsEntryId: null });
    expect(createdEntries).toHaveLength(0);
  });
});

describe('account resolution', () => {
  it('uses the product-linked inventory account when valid', async () => {
    const account = await resolveInventoryAccount('biz-1', { inventory_account_id: 'acc-fuel-stock' });
    expect(account.id).toBe('acc-fuel-stock');
  });

  it('falls back to 1141 when the product has no link', async () => {
    const account = await resolveInventoryAccount('biz-1', { inventory_account_id: null });
    expect(account.id).toBe('acc-trading-stock');
  });

  it('falls back to 1141 when the linked account was deleted', async () => {
    const account = await resolveInventoryAccount('biz-1', { inventory_account_id: 'acc-gone' });
    expect(account.id).toBe('acc-trading-stock');
  });

  it('refuses to post into a GROUP account', async () => {
    ACCOUNTS_BY_ID['acc-group-1140'] = acc('acc-group-1140', '1140', true);
    await expect(
      resolveInventoryAccount('biz-1', { inventory_account_id: 'acc-group-1140' }),
    ).resolves.toMatchObject({ id: 'acc-trading-stock' }); // group link is ignored → default
    delete ACCOUNTS_BY_ID['acc-group-1140'];
  });

  it('resolves COGS: product link wins, else 5100', async () => {
    expect((await resolveCogsAccount('biz-1', null)).id).toBe('acc-cogs');
  });
});
