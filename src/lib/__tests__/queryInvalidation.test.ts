import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import {
  invalidateAfterExpense,
  invalidateAfterIncome,
  invalidateAfterSync,
  invalidateAfterPayroll,
  invalidateAfterInventory,
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
    invalidateQueries.mock.calls.flatMap((call) => {
      const queryKey = (call[0] as { queryKey?: string[] }).queryKey;
      return queryKey ? [queryKey[0]] : [];
    });
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

    for (const key of ['sofp', 'profit_or_loss', 'profit_loss', 'cash_flow', 'trial_balance', 'vat', 'trend']) {
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

describe('payroll and inventory invalidation', () => {
  it('refreshes payroll-derived tax and ledger data', () => {
    const { client, keys } = mockClient();
    invalidateAfterPayroll(client);
    for (const key of ['payroll_runs', 'paye', 'journal', 'profit_loss', 'tax_returns']) {
      expect(keys()).toContain(key);
    }
  });

  it('refreshes every stock alias and affected reports', () => {
    const { client, keys } = mockClient();
    invalidateAfterInventory(client);
    for (const key of ['balances', 'inventory_balances', 'reorder_alerts', 'movements', 'sofp']) {
      expect(keys()).toContain(key);
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

describe('tenant-first detail invalidation', () => {
  it('marks affected business detail families stale without touching unrelated details', () => {
    const client = new QueryClient();
    const invoice = queryKeys.invoiceLines('business-a', 'invoice-a');
    const contact = queryKeys.contact('business-a', 'contact-a');
    const journal = queryKeys.journalEntry('business-b', 'journal-b');
    const webhook = queryKeys.webhookDeliveries('business-a', 'webhook-a');
    const payroll = queryKeys.payrollRun('business-a', 'payroll-a');

    for (const key of [invoice, contact, journal, webhook, payroll]) {
      client.setQueryData(key, { cached: true });
    }

    invalidateAfterIncome(client);

    expect(client.getQueryState(invoice)?.isInvalidated).toBe(true);
    expect(client.getQueryState(contact)?.isInvalidated).toBe(true);
    expect(client.getQueryState(journal)?.isInvalidated).toBe(true);
    expect(client.getQueryState(webhook)?.isInvalidated).toBe(false);
    expect(client.getQueryState(payroll)?.isInvalidated).toBe(false);
  });

  it('invalidates payroll and transfer detail families from their matching write paths', () => {
    const client = new QueryClient();
    const payroll = queryKeys.payrollRun('business-a', 'payroll-a');
    const transfer = queryKeys.transfer('business-a', 'transfer-a');
    client.setQueryData(payroll, { cached: true });
    client.setQueryData(transfer, { cached: true });

    invalidateAfterPayroll(client);
    expect(client.getQueryState(payroll)?.isInvalidated).toBe(true);
    expect(client.getQueryState(transfer)?.isInvalidated).toBe(false);

    invalidateAfterInventory(client);
    expect(client.getQueryState(transfer)?.isInvalidated).toBe(true);
  });
});
