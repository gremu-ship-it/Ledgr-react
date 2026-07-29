import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateAfterExpense,
  invalidateAfterIncome,
  invalidateAfterSync,
} from '../queryInvalidation';

/**
 * Recording a transaction used to end with a bare
 * `queryClient.invalidateQueries()`, which marks every cached query stale and
 * refetches all mounted ones — payroll, team, partner billing, settings — none
 * of which an expense or invoice can change. That was the lag after the
 * success tick.
 *
 * These assert the replacement stays scoped, and keep the two competing
 * failure modes visible: too wide brings the delay back, too narrow leaves
 * stale figures on screen.
 */

function mockClient() {
  const invalidateQueries = vi.fn();
  const client = { invalidateQueries } as unknown as QueryClient;
  const keys = () =>
    invalidateQueries.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
  return { client, invalidateQueries, keys };
}

describe('invalidateAfterExpense', () => {
  it('refreshes the expense list and the ledger', () => {
    const { client, keys } = mockClient();
    invalidateAfterExpense(client);

    for (const key of ['expenses', 'journal', 'accounts']) {
      expect(keys()).toContain(key);
    }
  });

  it('refreshes the financial statements, which are derived from the ledger', () => {
    const { client, keys } = mockClient();
    invalidateAfterExpense(client);

    for (const key of ['sofp', 'profit_or_loss', 'cash_flow']) {
      expect(keys(), `${key} would show stale figures`).toContain(key);
    }
  });

  it('leaves unrelated caches alone', () => {
    const { client, keys } = mockClient();
    invalidateAfterExpense(client);

    // The point of the change: these cannot be affected by an expense.
    for (const key of ['employees', 'payroll_runs', 'team', 'partner', 'webhooks']) {
      expect(keys(), `${key} should not be refetched`).not.toContain(key);
    }
  });

  it('skips stock caches when no tracked product was involved', () => {
    const { client, keys } = mockClient();
    invalidateAfterExpense(client, { touchedInventory: false });

    expect(keys()).not.toContain('inventory_balances');
    expect(keys()).not.toContain('products');
  });

  it('refreshes stock caches when a tracked product was involved', () => {
    const { client, keys } = mockClient();
    invalidateAfterExpense(client, { touchedInventory: true });

    expect(keys()).toContain('inventory_balances');
    expect(keys()).toContain('products');
  });
});

describe('invalidateAfterIncome', () => {
  it('refreshes invoices, contacts and the ledger', () => {
    const { client, keys } = mockClient();
    invalidateAfterIncome(client);

    // contacts matters: an invoice changes the customer's balance and ageing.
    for (const key of ['invoices', 'contacts', 'journal']) {
      expect(keys()).toContain(key);
    }
  });

  it('leaves payroll and admin caches alone', () => {
    const { client, keys } = mockClient();
    invalidateAfterIncome(client, { touchedInventory: true });

    for (const key of ['employees', 'payroll_runs', 'team']) {
      expect(keys()).not.toContain(key);
    }
  });
});

describe('invalidateAfterSync', () => {
  it('covers both expenses and invoices, since the queue mixes them', () => {
    const { client, keys } = mockClient();
    invalidateAfterSync(client);

    for (const key of ['expenses', 'invoices', 'inventory_balances', 'journal']) {
      expect(keys()).toContain(key);
    }
  });

  it('is still narrower than invalidating everything', () => {
    const { client, keys } = mockClient();
    invalidateAfterSync(client);

    for (const key of ['payroll_runs', 'team', 'partner']) {
      expect(keys()).not.toContain(key);
    }
  });
});
