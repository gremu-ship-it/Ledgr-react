import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ExpenseRepository } from '../ExpenseRepository';

/**
 * Regression cover for the invisible-payable bug.
 *
 * THE INCIDENT
 * A MK 4,000,000 supplier bill was recorded through the Expense Builder. The
 * builder wrote the row as `status: 'draft'` but posted the journal entry
 * (DR Inventory / CR Trade Creditors) straight away. `findOutstanding` excluded
 * `draft`, so the AP summary on the dashboard reported nothing while the ledger
 * carried a four-million-kwacha liability.
 *
 * These tests pin the query the repository actually sends, and the amount
 * filter that keeps settled rows out regardless of status.
 */

type Row = Record<string, unknown>;

/** Minimal thenable PostgREST-shaped stub that records every filter call. */
function makeClient(rows: Row[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };

  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'not', 'order', 'limit', 'gte', 'lte', 'range']) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: { data: Row[]; error: null; count: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null, count: null }).then(resolve);

  return {
    client: { from: vi.fn(() => builder) } as unknown as SupabaseClient,
    calls,
  };
}

const bill = (overrides: Row = {}): Row => ({
  id: 'bill-1',
  expense_number: 'EXP-0478',
  status: 'draft',
  due_date: '2026-11-30',
  expense_date: '2026-11-16',
  total_amount: 4_000_000,
  amount_paid: 0,
  functional_amount: 4_000_000,
  functional_currency: 'MWK',
  exchange_rate: 1,
  ...overrides,
});

describe('ExpenseRepository.findOutstanding', () => {
  it('includes draft bills — a recorded bill is a liability the moment it posts', async () => {
    const { client, calls } = makeClient([bill()]);
    const repo = new ExpenseRepository(client);

    const result = await repo.findOutstanding('business-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('bill-1');

    // The status filter must not mention `draft`.
    const statusFilter = calls.find((c) => c.method === 'not' && c.args[0] === 'status');
    expect(statusFilter).toBeDefined();
    const list = String(statusFilter!.args[2]);
    expect(list).not.toContain('draft');
    expect(list).toContain('void');
    expect(list).toContain('paid');
  });

  it('still excludes void, rejected and cancelled rows at the query level', async () => {
    const { client, calls } = makeClient([]);
    const repo = new ExpenseRepository(client);

    await repo.findOutstanding('business-1');

    const statusFilter = calls.find((c) => c.method === 'not' && c.args[0] === 'status');
    const list = String(statusFilter!.args[2]);
    for (const excluded of ['void', 'rejected', 'cancelled']) {
      expect(list).toContain(excluded);
    }
  });

  it('drops rows that are already settled, whatever their status', async () => {
    const { client } = makeClient([
      bill({ id: 'unpaid', total_amount: 4_000_000, amount_paid: 0 }),
      bill({ id: 'part-paid', total_amount: 4_000_000, amount_paid: 1_200_000 }),
      bill({ id: 'settled', total_amount: 4_000_000, amount_paid: 4_000_000 }),
    ]);
    const repo = new ExpenseRepository(client);

    const result = await repo.findOutstanding('business-1');

    expect(result.map((r) => r.id)).toEqual(['unpaid', 'part-paid']);
  });
});
