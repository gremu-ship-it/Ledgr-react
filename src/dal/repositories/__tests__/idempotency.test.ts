import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InvoiceRepository } from '../InvoiceRepository';
import { ExpenseRepository } from '../ExpenseRepository';
import type { Database } from '../../types/database';
import { triggerWebhook } from '@/services/webhook/webhook-triggers';

vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn(async () => {}),
}));

/**
 * Regression cover for the offline idempotency gap — updated for the
 * IC 2026-09-25 atomic commands (P6/P7).
 *
 * Idempotency used to be a client-side "look up by client_key, return early"
 * followed by separate insert / increment / status requests. A failure after
 * the insert plus a retry therefore returned early and left amount_paid
 * permanently short. Replay is now decided INSIDE one server transaction
 * (record_invoice_payment / record_expense_payment / create_invoice_with_lines);
 * the database behaviour is proven by tests/release/ic-containment.test.ts.
 *
 * These tests pin the CLIENT contract: exactly one RPC carrying the caller's
 * key, no direct table writes, the committed row returned on replay, and no
 * duplicate side effects (webhooks) on replay.
 */

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  const from = vi.fn(() => { throw new Error('direct table access is not allowed on this path'); });
  return { client: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from };
}

beforeEach(() => vi.mocked(triggerWebhook).mockClear());

describe('offline idempotency', () => {
  it('createWithLines returns the existing invoice instead of duplicating', async () => {
    const existingInvoice = { id: 'inv-1', business_id: 'biz-1', status: 'sent' };
    const existingLines = [{ id: 'l1', invoice_id: 'inv-1' }];
    const { client, rpc, from } = rpcClient({
      data: { invoice: existingInvoice, lines: existingLines, idempotent: true }, error: null,
    });
    const repo = new InvoiceRepository(client);

    const result = await repo.createWithLines({ business_id: 'biz-1', status: 'sent' } as never, [] as never[], 'key-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_invoice_with_lines', {
      p_invoice: { business_id: 'biz-1', status: 'sent' }, p_lines: [], p_client_key: 'key-1',
    });
    expect(from).not.toHaveBeenCalled();
    expect(result.invoice).toEqual(existingInvoice);
    expect(result.lines).toEqual(existingLines);
    expect(triggerWebhook).not.toHaveBeenCalled(); // replay: no second invoice.created
  });

  it('recordPayment returns the existing payment without re-incrementing', async () => {
    const existingPayment = { id: 'pay-1', invoice_id: 'inv-1', business_id: 'biz-1', amount: 50 };
    const invoice = { id: 'inv-1', business_id: 'biz-1', status: 'paid', amount_paid: 100, total_amount: 100 };
    const { client, rpc, from } = rpcClient({
      data: { payment: existingPayment, invoice, journal_entry_id: 'je-1', idempotent: true }, error: null,
    });
    const repo = new InvoiceRepository(client);

    const result = await repo.recordPayment(
      { business_id: 'biz-1', invoice_id: 'inv-1', amount: 50 } as never, 'key-1',
    );

    // One atomic command; never a separate increment_amount_paid call.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_invoice_payment', {
      p_payment: { business_id: 'biz-1', invoice_id: 'inv-1', amount: 50 }, p_client_key: 'key-1',
    });
    expect(from).not.toHaveBeenCalled();
    expect(result.payment).toEqual(existingPayment);
    expect(result.idempotent).toBe(true);
    expect(triggerWebhook).not.toHaveBeenCalled(); // replay: no second invoice.paid
  });

  it('expense recordPayment returns the existing payment without re-incrementing', async () => {
    const existingPayment = { id: 'pay-2', expense_id: 'exp-1', business_id: 'biz-1', amount: 30 };
    const expense = { id: 'exp-1', business_id: 'biz-1', amount_paid: 30 };
    const { client, rpc, from } = rpcClient({
      data: { payment: existingPayment, expense, journal_entry_id: 'je-2', idempotent: true }, error: null,
    });
    const repo = new ExpenseRepository(client);

    const result = await repo.recordPayment(
      { business_id: 'biz-1', expense_id: 'exp-1', amount: 30 } as never, 'key-2',
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_expense_payment', {
      p_payment: { business_id: 'biz-1', expense_id: 'exp-1', amount: 30 }, p_client_key: 'key-2',
    });
    expect(from).not.toHaveBeenCalled();
    expect(result.payment).toEqual(existingPayment);
    expect(result.expense).toEqual(expense);
  });

  it('recordPayment without an explicit key still sends a key (server requires one)', async () => {
    const { client, rpc } = rpcClient({
      data: { payment: { id: 'p' }, invoice: { id: 'i', business_id: 'b', status: 'partially_paid' }, journal_entry_id: 'j', idempotent: false },
      error: null,
    });
    await new InvoiceRepository(client).recordPayment({ business_id: 'b', invoice_id: 'i', amount: 1 } as never);
    const args = (rpc.mock.calls[0] as unknown as [string, { p_client_key: string }])[1];
    expect(args.p_client_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a first-time payment that settles the invoice fires invoice.paid exactly once', async () => {
    const invoice = { id: 'i', business_id: 'b', status: 'paid' };
    const { client } = rpcClient({
      data: { payment: { id: 'p' }, invoice, journal_entry_id: 'j', idempotent: false }, error: null,
    });
    await new InvoiceRepository(client).recordPayment({ business_id: 'b', invoice_id: 'i', amount: 1 } as never, 'k');
    expect(triggerWebhook).toHaveBeenCalledTimes(1);
    expect(triggerWebhook).toHaveBeenCalledWith('b', 'invoice.paid', invoice);
  });

  it('a null RPC result is an error, never a silent success', async () => {
    const { client } = rpcClient({ data: null, error: null });
    await expect(
      new InvoiceRepository(client).recordPayment({ business_id: 'b', invoice_id: 'i', amount: 1 } as never, 'k'),
    ).rejects.toThrow(/not confirmed/);
    await expect(
      new InvoiceRepository(client).createWithLines({ business_id: 'b' } as never, [] as never[], 'k'),
    ).rejects.toThrow(/nothing was confirmed/);
  });
});
