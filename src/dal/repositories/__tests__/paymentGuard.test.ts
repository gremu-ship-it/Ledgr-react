import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InvoiceRepository } from '../InvoiceRepository';
import { ExpenseRepository } from '../ExpenseRepository';
import { ValidationError } from '../../errors/RepositoryError';
import type { Database } from '../../types/database';

vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn(async () => {}),
}));

/**
 * Regression cover for C-03 (payments against void / credit-note documents),
 * updated for IC 2026-09-25 P6.
 *
 * The guard now lives in the atomic server commands record_invoice_payment /
 * record_expense_payment (plus the 20260813000002 trigger backstop): the
 * document is locked and its status checked in the same transaction as the
 * insert, so there is no read-then-write gap. The server raises SQLSTATE
 * 23514; the repository must surface that as a ValidationError and must not
 * attempt any direct write of its own. The SQL behaviour itself is proven on
 * real PostgreSQL in tests/release/ic-containment.test.ts.
 */

function serverRejects(message: string) {
  const rpc = vi.fn(async () => ({ data: null, error: { code: '23514', message } }));
  const from = vi.fn(() => { throw new Error('no direct table writes expected'); });
  return { client: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from };
}

describe('payment guard against cancelled documents', () => {
  it('rejects a payment against a void invoice before writing', async () => {
    const { client, rpc, from } = serverRejects('Cannot record a payment against a void invoice.');
    await expect(
      new InvoiceRepository(client).recordPayment({ business_id: 'biz-1', invoice_id: 'inv-1', amount: 10 } as never, 'k'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(rpc).toHaveBeenCalledWith('record_invoice_payment', expect.anything());
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a payment against a credit_note invoice before writing', async () => {
    const { client, from } = serverRejects('Cannot record a payment against a credit_note invoice.');
    await expect(
      new InvoiceRepository(client).recordPayment({ business_id: 'biz-1', invoice_id: 'inv-1', amount: 10 } as never, 'k'),
    ).rejects.toThrow(/credit_note/);
    expect(from).not.toHaveBeenCalled();
  });

  it('allows a payment against a live invoice', async () => {
    const rpc = vi.fn(async () => ({
      data: { payment: { id: 'pay-1' }, invoice: { id: 'inv-1', business_id: 'biz-1', status: 'partially_paid' }, journal_entry_id: 'je', idempotent: false },
      error: null,
    }));
    const client = { rpc, from: vi.fn() } as unknown as SupabaseClient<Database>;
    const result = await new InvoiceRepository(client).recordPayment(
      { business_id: 'biz-1', invoice_id: 'inv-1', amount: 10 } as never, 'k',
    );
    expect(result.payment).toEqual({ id: 'pay-1' });
    expect(result.invoice.status).toBe('partially_paid');
  });

  it('surfaces an overpayment rejection as a ValidationError', async () => {
    const { client } = serverRejects('Payment of 150.00 exceeds the outstanding balance of 100.00 on invoice INV-1.');
    await expect(
      new InvoiceRepository(client).recordPayment({ business_id: 'b', invoice_id: 'i', amount: 150 } as never, 'k'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('expense payment guard', () => {
  it('rejects a payment against a void expense before writing', async () => {
    const { client, rpc, from } = serverRejects('Cannot record a payment against a void expense.');
    await expect(
      new ExpenseRepository(client).recordPayment({ business_id: 'biz-1', expense_id: 'exp-1', amount: 10 } as never, 'k'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(rpc).toHaveBeenCalledWith('record_expense_payment', expect.anything());
    expect(from).not.toHaveBeenCalled();
  });
});
