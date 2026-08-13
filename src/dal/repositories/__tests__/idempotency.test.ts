import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InvoiceRepository } from '../InvoiceRepository';
import { ExpenseRepository } from '../ExpenseRepository';
import type { Database } from '../../types/database';

vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn(async () => {}),
}));

/**
 * Regression cover for the offline idempotency gap.
 *
 * The sync engine used to perform plain inserts with no idempotency: if the
 * network dropped after the server committed but before the queue item was
 * marked 'synced', the retry inserted a duplicate invoice/expense/payment and
 * re-incremented amount_paid.
 *
 * Each queue item now carries a client_key; the repositories return the
 * existing record when a prior attempt already committed it, instead of
 * inserting again. These tests pin that behaviour with a mocked client.
 */

function makeSelectChain<T>(final: { data: T; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    maybeSingle: async () => final,
    then: async (resolveFn: (v: unknown) => unknown) => resolveFn(final),
  };
  return chain;
}

describe('offline idempotency', () => {
  it('createWithLines returns the existing invoice instead of duplicating', async () => {
    const existingInvoice = { id: 'inv-1', business_id: 'biz-1', status: 'sent' };
    const existingLines = [{ id: 'l1', invoice_id: 'inv-1' }];

    const invoicesChain = makeSelectChain({ data: existingInvoice, error: null });
    const linesChain = makeSelectChain({ data: existingLines, error: null });

    const from = vi.fn((table: string) => {
      if (table === 'invoices') return invoicesChain;
      if (table === 'invoice_lines') return linesChain;
      throw new Error(`unexpected table ${table}`);
    });

    const client = { from } as unknown as SupabaseClient<Database>;
    const repo = new InvoiceRepository(client);

    const result = await repo.createWithLines(
      { business_id: 'biz-1', status: 'sent' } as never,
      [] as never[],
      'key-1',
    );

    // The existing invoice is returned, not a new insert (an insert would
    // throw, since the chain has no .insert()).
    expect(result.invoice).toEqual(existingInvoice);
    expect(result.lines).toEqual(existingLines);
  });

  it('recordPayment returns the existing payment without re-incrementing', async () => {
    const existingPayment = { id: 'pay-1', invoice_id: 'inv-1', amount: 50, business_id: 'biz-1' };
    const invoice = { id: 'inv-1', business_id: 'biz-1', status: 'sent' };

    const paymentsChain = makeSelectChain({ data: existingPayment, error: null });
    const invoicesChain = makeSelectChain({ data: invoice, error: null });

    const from = vi.fn((table: string) => {
      if (table === 'invoice_payments') return paymentsChain;
      if (table === 'invoices') return invoicesChain;
      throw new Error(`unexpected table ${table}`);
    });
    const rpc = vi.fn(async () => ({ error: null }));

    const client = { from, rpc } as unknown as SupabaseClient<Database>;
    const repo = new InvoiceRepository(client);

    const result = await repo.recordPayment(
      { invoice_id: 'inv-1', amount: 50, business_id: 'biz-1' } as never,
      'key-1',
    );

    expect(result.payment).toEqual(existingPayment);
    // Crucially, amount_paid is NOT incremented a second time.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('expense recordPayment returns the existing payment without re-incrementing', async () => {
    const existingPayment = { id: 'pay-1', expense_id: 'exp-1', amount: 50, business_id: 'biz-1' };
    const expense = { id: 'exp-1', business_id: 'biz-1', status: 'paid' };

    const paymentsChain = makeSelectChain({ data: existingPayment, error: null });
    const expensesChain = makeSelectChain({ data: expense, error: null });

    const from = vi.fn((table: string) => {
      if (table === 'expense_payments') return paymentsChain;
      if (table === 'expenses') return expensesChain;
      throw new Error(`unexpected table ${table}`);
    });
    const rpc = vi.fn(async () => ({ error: null }));

    const client = { from, rpc } as unknown as SupabaseClient<Database>;
    const repo = new ExpenseRepository(client);

    const result = await repo.recordPayment(
      { expense_id: 'exp-1', amount: 50, business_id: 'biz-1' } as never,
      'key-1',
    );

    expect(result.payment).toEqual(existingPayment);
    expect(rpc).not.toHaveBeenCalled();
  });
});
