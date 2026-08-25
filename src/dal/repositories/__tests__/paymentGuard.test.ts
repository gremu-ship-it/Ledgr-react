import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InvoiceRepository } from '../InvoiceRepository';
import { ExpenseRepository } from '../ExpenseRepository';
import type { Database } from '../../types/database';

// InvoiceRepository imports triggerWebhook -> webhook-triggers -> supabase,
// which throws at import time without env vars. The guard under test never
// reaches the webhook, so stub the module out of the import graph.
vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn(async () => {}),
}));

/**
 * Regression cover for C-03: payments were only blocked on void/credit_note
 * documents in the UI (and via non-existent status values 'voided'/'credited').
 * A direct client/API write could still record a payment and inflate
 * amount_paid on a cancelled document.
 *
 * The repository now rejects such a payment with a clear ValidationError
 * before any insert; the DB trigger (20260813000002) is the backstop. These
 * tests pin the repository-level guard.
 */

function invoiceClient(status: string) {
  const invoice = { id: 'inv-1', business_id: 'biz-1', status, total_amount: 100, amount_paid: 0 };

  const invoicesChain = () => ({
    select: () => ({
      eq: () => ({
        is: () => ({
          maybeSingle: async () => ({ data: invoice, error: null }),
        }),
      }),
    }),
  });

  const paymentsChain = () => ({
    insert: () => ({
      select: () => ({
        single: async () => ({ data: { id: 'pay-1' }, error: null }),
      }),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'invoices') return invoicesChain();
    if (table === 'invoice_payments') return paymentsChain();
    throw new Error(`unexpected table: ${table}`);
  });

  const rpc = vi.fn(async () => ({ error: null }));

  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    from,
    rpc,
  };
}

describe('payment guard against cancelled documents', () => {
  it('rejects a payment against a void invoice before writing', async () => {
    const { client, from } = invoiceClient('void');
    const repo = new InvoiceRepository(client);

    await expect(
      repo.recordPayment({ invoice_id: 'inv-1', amount: 10, business_id: 'biz-1' } as never),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    const paymentWrites = from.mock.calls.filter(([t]) => t === 'invoice_payments');
    expect(paymentWrites).toHaveLength(0);
  });

  it('rejects a payment against a credit_note invoice before writing', async () => {
    const { client, from } = invoiceClient('credit_note');
    const repo = new InvoiceRepository(client);

    await expect(
      repo.recordPayment({ invoice_id: 'inv-1', amount: 10, business_id: 'biz-1' } as never),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    expect(from.mock.calls.filter(([t]) => t === 'invoice_payments')).toHaveLength(0);
  });

  it('rejects a payment whose business differs from its parent invoice', async () => {
    const { client, from } = invoiceClient('sent');
    const repo = new InvoiceRepository(client);

    await expect(
      repo.recordPayment({ invoice_id: 'inv-1', amount: 10, business_id: 'biz-2' } as never),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    expect(from.mock.calls.filter(([t]) => t === 'invoice_payments')).toHaveLength(0);
  });

  it('allows a payment against a live invoice', async () => {
    const { client } = invoiceClient('sent');
    const repo = new InvoiceRepository(client);

    // amount_paid stays 0, status stays 'sent' → no update, no webhook.
    await expect(
      repo.recordPayment({ invoice_id: 'inv-1', amount: 10, business_id: 'biz-1' } as never),
    ).resolves.toMatchObject({ invoice: { status: 'sent' } });
  });
});

describe('expense payment guard', () => {
  it('rejects a payment against a void expense before writing', async () => {
    const expense = { id: 'exp-1', business_id: 'biz-1', status: 'void' };

    const expensesChain = () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({ data: expense, error: null }),
          }),
        }),
      }),
    });

    const from = vi.fn((table: string) => {
      if (table === 'expenses') return expensesChain();
      throw new Error(`unexpected table: ${table}`);
    });
    const client = { from } as unknown as SupabaseClient<Database>;
    const repo = new ExpenseRepository(client);

    await expect(
      repo.recordPayment({ expense_id: 'exp-1', amount: 10, business_id: 'biz-1' } as never),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    expect(from.mock.calls.filter(([t]) => t === 'expense_payments')).toHaveLength(0);
  });

  it('rejects a payment whose business differs from its parent expense', async () => {
    const expense = { id: 'exp-1', business_id: 'biz-1', status: 'approved' };
    const from = vi.fn((table: string) => {
      if (table === 'expenses') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: async () => ({ data: expense, error: null }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const repo = new ExpenseRepository({ from } as unknown as SupabaseClient<Database>);

    await expect(
      repo.recordPayment({ expense_id: 'exp-1', amount: 10, business_id: 'biz-2' } as never),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    expect(from.mock.calls.filter(([t]) => t === 'expense_payments')).toHaveLength(0);
  });
});
