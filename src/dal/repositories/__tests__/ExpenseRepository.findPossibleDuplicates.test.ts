import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ExpenseRepository } from '../ExpenseRepository';

/**
 * Regression cover for the duplicate-bill bug.
 *
 * THE INCIDENT
 * EXP-0478 was a MK 4,000,000 cash purchase: 1,100 bags of Pure Chicken
 * Manure at 3,636.36, Head Office, dated 2026-11-16. It was reversed on
 * 2026-11-24 and, minutes later, EXP-0490 was entered — same supplier, same
 * quantity, same unit cost, same branch, deliberately back-dated to 16 Nov,
 * 2,500,000 paid immediately. It was saved as an ordinary `approved` bill.
 *
 * Nothing stopped it. `expenses.reference` holds the supplier's own invoice
 * number and is nullable; both bills had it empty, so any matching built on
 * that column had nothing to compare. The construction matcher refuses a bill
 * that has already moved stock, but that only covers construction bills.
 *
 * These tests pin the content-based check that closes the gap: the same
 * supplier, total, date and stock lines must surface the earlier bill so the
 * user can confirm or abandon the save. It is a warning by design — two
 * identical loads in one day is a legitimate purchase.
 */

type Row = Record<string, unknown>;

/** PostgREST-shaped stub that records filters and returns canned per-table rows. */
function makeClient(tables: { expenses: Row[]; expense_lines: Row[] }) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];

  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'not', 'order', 'limit', 'gte', 'lte', 'in']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: { data: Row[]; error: null; count: null }) => unknown) =>
      Promise.resolve({
        data: tables[table as keyof typeof tables] ?? [],
        error: null,
        count: null,
      }).then(resolve);
    return builder;
  };

  return {
    client: { from: vi.fn((table: string) => makeBuilder(table)) } as unknown as SupabaseClient,
    calls,
  };
}

const CANDIDATE = {
  contactId: 'd8a12bbb-0000-0000-0000-000000000001',
  totalAmount: 4_000_000,
  expenseDate: '2026-11-16',
  lines: [{ productId: 'prod-manure', quantity: 1100, unitPrice: 3636.3636 }],
};

describe('ExpenseRepository.findPossibleDuplicates', () => {
  it('flags an earlier bill with the same supplier, date, total and stock line', async () => {
    const { client } = makeClient({
      expenses: [
        {
          id: 'exp-478',
          expense_number: 'EXP-0478',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'void',
          contact_id: CANDIDATE.contactId,
        },
      ],
      expense_lines: [
        {
          expense_id: 'exp-478',
          product_id: 'prod-manure',
          quantity: 1100,
          unit_price: 3636.3636,
        },
      ],
    });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', CANDIDATE);

    expect(found).toHaveLength(1);
    expect(found[0].expense_number).toBe('EXP-0478');
  });

  it('includes reversed and voided bills — re-creating a deliberately reversed bill is the case that matters', async () => {
    const { client } = makeClient({
      expenses: [
        {
          id: 'exp-478',
          expense_number: 'EXP-0478',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'reversed',
          contact_id: CANDIDATE.contactId,
        },
      ],
      expense_lines: [{ expense_id: 'exp-478', product_id: 'prod-manure', quantity: 1100, unit_price: 3636.3636 }],
    });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', CANDIDATE);

    expect(found.map((f) => f.expense_number)).toEqual(['EXP-0478']);
  });

  it('does NOT flag the same total when the goods differ', async () => {
    const { client } = makeClient({
      expenses: [
        {
          id: 'exp-500',
          expense_number: 'EXP-0500',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'approved',
          contact_id: CANDIDATE.contactId,
        },
      ],
      // Same money, different product — two different purchases.
      expense_lines: [{ expense_id: 'exp-500', product_id: 'prod-fert', quantity: 1100, unit_price: 3636.3636 }],
    });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', CANDIDATE);

    expect(found).toHaveLength(0);
  });

  it('does NOT flag the same goods when the quantity differs', async () => {
    const { client } = makeClient({
      expenses: [
        {
          id: 'exp-501',
          expense_number: 'EXP-0501',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'approved',
          contact_id: CANDIDATE.contactId,
        },
      ],
      expense_lines: [{ expense_id: 'exp-501', product_id: 'prod-manure', quantity: 1100, unit_price: 3636.3636 }],
    });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', {
      ...CANDIDATE,
      lines: [{ productId: 'prod-manure', quantity: 1100, unitPrice: 3636.3636 }],
    });
    expect(found).toHaveLength(1);

    // Now a genuinely different quantity against the same recorded bill.
    const { client: client2 } = makeClient({
      expenses: [
        {
          id: 'exp-501',
          expense_number: 'EXP-0501',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'approved',
          contact_id: CANDIDATE.contactId,
        },
      ],
      expense_lines: [{ expense_id: 'exp-501', product_id: 'prod-manure', quantity: 500, unit_price: 3636.3636 }],
    });
    const found2 = await new ExpenseRepository(client2).findPossibleDuplicates('biz-1', CANDIDATE);
    expect(found2).toHaveLength(0);
  });

  it('treats a split quantity as the same purchase — 550 + 550 is 1,100', async () => {
    const { client } = makeClient({
      expenses: [
        {
          id: 'exp-502',
          expense_number: 'EXP-0502',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'approved',
          contact_id: CANDIDATE.contactId,
        },
      ],
      expense_lines: [
        { expense_id: 'exp-502', product_id: 'prod-manure', quantity: 550, unit_price: 3636.3636 },
        { expense_id: 'exp-502', product_id: 'prod-manure', quantity: 550, unit_price: 3636.3636 },
      ],
    });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', CANDIDATE);

    expect(found).toHaveLength(1);
  });

  it('matches unsupplied bills only against other unsupplied bills', async () => {
    const { client, calls } = makeClient({
      expenses: [],
      expense_lines: [],
    });

    await new ExpenseRepository(client).findPossibleDuplicates('biz-1', {
      ...CANDIDATE,
      contactId: null,
    });

    const nullSupplierFilter = calls.some(
      (c) => c.table === 'expenses' && c.method === 'is' && c.args[0] === 'contact_id' && c.args[1] === null,
    );
    expect(nullSupplierFilter).toBe(true);
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'contact_id')).toBe(false);
  });

  it('scopes every query to the business and ignores soft-deleted bills', async () => {
    const { client, calls } = makeClient({ expenses: [], expense_lines: [] });

    await new ExpenseRepository(client).findPossibleDuplicates('biz-1', CANDIDATE);

    expect(calls).toContainEqual({ table: 'expenses', method: 'eq', args: ['business_id', 'biz-1'] });
    expect(calls).toContainEqual({ table: 'expenses', method: 'is', args: ['deleted_at', null] });
    expect(calls).toContainEqual({ table: 'expenses', method: 'eq', args: ['expense_date', '2026-11-16'] });
    expect(calls).toContainEqual({ table: 'expenses', method: 'eq', args: ['total_amount', 4_000_000] });
  });

  it('does nothing when the date is blank — a wildcard would flag every bill', async () => {
    const { client, calls } = makeClient({ expenses: [], expense_lines: [] });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', {
      ...CANDIDATE,
      expenseDate: '',
    });

    expect(found).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('skips the line comparison for a bill with no stock lines but still reports the header match', async () => {
    const { client } = makeClient({
      expenses: [
        {
          id: 'exp-503',
          expense_number: 'EXP-0503',
          expense_date: '2026-11-16',
          total_amount: 4_000_000,
          status: 'approved',
          contact_id: CANDIDATE.contactId,
        },
      ],
      expense_lines: [],
    });

    const found = await new ExpenseRepository(client).findPossibleDuplicates('biz-1', {
      ...CANDIDATE,
      lines: [],
    });

    expect(found.map((f) => f.expense_number)).toEqual(['EXP-0503']);
  });
});
