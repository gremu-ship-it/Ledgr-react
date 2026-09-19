// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildPosSaleQueuePayload, commitPosSaleDocuments } from '../posService';
import { buildPosSaleRpcPayload } from '../posSaleRpc';
import { repos } from '@/lib/repositories';
import { realSupabase } from '@/lib/supabase';
import { deriveClientKey } from '@/lib/clientKeys';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { usageService } from '@/lib/billing/UsageService';
import type { PosCartItem } from '@/types/pos';
import { missingPostPosSale, POST_POS_SALE_MISSING, postedPosSale } from './helpers/postPosSaleStub';

/**
 * The server-side posting path (stage 2 of docs/database/pos-sale-posting-rpc.md).
 *
 * What matters here is not what the SQL does — tests/database/pos_sale_rpc.test.js
 * runs `post_pos_sale` against Postgres for that — but the switch itself:
 *
 *   1. A working RPC posts the whole sale server-side, so none of the legacy
 *      writes happen client-side. That is the property stage 3 depends on:
 *      if the till still writes invoices/journal entries itself, narrowing the
 *      POS roles' policies would simply break the till.
 *   2. Falling back happens for exactly one reason — the function is not there
 *      yet (PGRST202 on a frontend deployed ahead of the migration) — and the
 *      fallback uses the same keys the RPC was given, so the two paths cannot
 *      double-post whichever one wins.
 *   3. Anything else (a rejected policy, a malformed payload, a timeout that
 *      survived the retry) propagates. Nothing is written — the RPC is one
 *      transaction — and the caller must not silently re-post through a weaker
 *      path.
 */

vi.mock('@/services/journalService', () => ({
  createInvoiceJournalEntry: vi.fn().mockResolvedValue({}),
  createInvoiceReceivableEntry: vi.fn().mockResolvedValue('je-sale'),
  createInvoiceSettlementEntry: vi.fn().mockResolvedValue('je-receipt'),
}));

vi.mock('@/services/inventoryJournalService', () => ({
  deductStockAndPostCogs: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn().mockResolvedValue({}),
}));

const items: PosCartItem[] = [
  {
    product_id: 'prod-001',
    name: 'Whole Dressed Chicken 1.2kg',
    quantity: 2,
    unit_price: 6500,
    unit_cost: 4500,
    line_total: 13000,
  },
  {
    product_id: 'prod-002',
    name: 'Beef Sausage 500g',
    quantity: 3,
    unit_price: 3800,
    unit_cost: 2600,
    line_total: 11400,
  },
];

const salePayload = {
  businessId: 'biz-1',
  branchId: 'branch-1',
  shiftId: 'shift-7',
  cashierId: 'user-9',
  cashierName: 'Thoko Mwale',
  customerId: null as string | null,
  customerName: 'Chikondi Phiri',
  customerPhone: '+265991234567',
  items,
  payments: [
    { payment_method: 'airtel_money' as const, amount: 10000, reference: 'AIR-7788' },
    { payment_method: 'cash' as const, amount: 14400, tendered: 15000 },
  ],
  totalPaid: 25000,
  changeGiven: 600,
  notes: 'Market day order',
};

function queuePayload(clientKey = 'queue-key-1') {
  return buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-1', clientKey });
}

/** Every call to `post_pos_sale` — the legacy path also uses rpc (audit, sequence). */
function postCalls(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter(([name]) => name === 'post_pos_sale');
}

const committedInvoice = {
  id: 'inv-rpc-1',
  business_id: 'biz-1',
  invoice_number: 'INV-2026-0700',
  status: 'paid',
  total_amount: 24400,
  amount_paid: 24400,
  currency: 'MWK',
};

describe('buildPosSaleRpcPayload', () => {
  it('maps the queue payload to the RPC shape, keying each tender like the legacy path', () => {
    const payload = buildPosSaleRpcPayload(queuePayload('parent-key'), 'biz-1', 'parent-key');

    expect(payload).toMatchObject({
      business_id: 'biz-1',
      client_key: 'parent-key',
      shift_id: 'shift-7',
      receipt_number: 'REC-1',
      cash_sales: 14400,
      other_sales: 10000,
      is_credit_sale: false,
      customer: {
        name: 'Chikondi Phiri',
        phone: '+265991234567',
        email: null,
      },
    });
    expect(payload.lines).toHaveLength(2);
    expect(payload.invoice).toMatchObject({ total_amount: 24400 });

    // The tender keys are the whole idempotency story: the legacy path derives
    // them with the same helper from the same parent key, so a sale posted by
    // one path is recognised by the other.
    const payments = payload.payments as Array<Record<string, unknown>>;
    expect(payments.map((p) => p.client_key)).toEqual([
      deriveClientKey('parent-key', 0),
      deriveClientKey('parent-key', 1),
    ]);
    expect(payments[0]).toMatchObject({
      payment_method: 'airtel_money',
      amount: 10000,
      reference: 'AIR-7788',
    });
  });
});

describe('commitPosSaleDocuments — server-side posting', () => {
  const createWithLines = () =>
    vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
      invoice: committedInvoice as never,
      lines: [],
    });
  const recordPayment = () =>
    vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
      payment: { id: 'pmt' } as never,
      invoice: {} as never,
    });
  const legacyWrites = () => [
    createWithLines(),
    recordPayment(),
    vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null as never),
    vi.spyOn(repos.journal, 'findByPostingKey').mockResolvedValue(null as never),
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(usageService, 'assertCanCreateDocument').mockResolvedValue(undefined);
    vi.spyOn(repos.account, 'findByCode').mockResolvedValue(null as never);
    vi.spyOn(repos.account, 'findBankAccounts').mockResolvedValue([] as never);
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0042');
    vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({
      id: 'uuid-walkin',
      name: 'Walk-in Customer',
    } as never);
    vi.spyOn(repos.invoice, 'findByIdWithLines').mockResolvedValue({
      invoice: committedInvoice as never,
      lines: [{ id: 'line-1', line_number: 1 }] as never,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the sale with post_pos_sale and writes nothing client-side', async () => {
    const rpc = vi.spyOn(realSupabase, 'rpc').mockResolvedValue(postedPosSale() as never);
    const [create, pay, shift, journal] = legacyWrites();

    const result = await commitPosSaleDocuments(queuePayload(), {
      businessId: 'biz-1',
      clientKey: 'queue-key-1',
    });

    expect(postCalls(rpc)).toHaveLength(1);
    const [payloadArg] = Object.values(postCalls(rpc)[0][1] as Record<string, unknown>);
    expect(payloadArg).toMatchObject({ client_key: 'queue-key-1', business_id: 'biz-1' });

    // The property that makes the cashier lockout possible: no invoice, no
    // payments, no stock movement, no shift rewrite, no keyed journal posting
    // from the client. All of it happened inside the RPC.
    expect(create).not.toHaveBeenCalled();
    expect(pay).not.toHaveBeenCalled();
    expect(deductStockAndPostCogs).not.toHaveBeenCalled();
    expect(shift).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();

    // The caller still gets the same shape it got before the switch.
    expect(result.invoice.id).toBe('inv-rpc-1');
    expect(result.invoice.invoice_number).toBe('INV-2026-0700');
    expect(result.lines).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('falls back to the client-side path when the migration is not applied yet, with the same keys', async () => {
    const rpc = vi
      .spyOn(realSupabase, 'rpc')
      .mockImplementation(missingPostPosSale(() => ({ data: null, error: null })) as never);
    const create = createWithLines().mockResolvedValue({
      invoice: { ...committedInvoice, id: 'inv-legacy-1' } as never,
      lines: [],
    });
    const pay = recordPayment();
    vi.spyOn(repos.contact, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'open' } as never);
    const shift = vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null);

    const result = await commitPosSaleDocuments(queuePayload('queue-key-1'), {
      businessId: 'biz-1',
      clientKey: 'queue-key-1',
    });

    // Tried once, recognised the missing function, and fell back rather than
    // erroring the till out.
    expect(postCalls(rpc)).toHaveLength(1);
    expect(create).toHaveBeenCalled();
    expect(result.invoice.id).toBe('inv-legacy-1');

    // Same parent key on the invoice, and the same derived tender keys the RPC
    // was handed — so if the RPC had actually committed before the response was
    // lost, the fallback would find its rows instead of duplicating them.
    expect(create.mock.calls[0][2]).toBe('queue-key-1');
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[0][1]).toBe(deriveClientKey('queue-key-1', 0));
    expect(pay.mock.calls[1][1]).toBe(deriveClientKey('queue-key-1', 1));
    expect(shift).toHaveBeenCalledWith('shift-7', { cashSales: 14400, otherSales: 10000 });
  });

  it('rethrows a real rejection without falling back — nothing was written', async () => {
    vi.spyOn(realSupabase, 'rpc').mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'new row violates row-level security policy for table "invoices"',
      },
    } as never);
    const [create, pay] = legacyWrites();

    await expect(
      commitPosSaleDocuments(queuePayload(), { businessId: 'biz-1', clientKey: 'queue-key-1' }),
    ).rejects.toThrow(/row-level security/);

    expect(create).not.toHaveBeenCalled();
    expect(pay).not.toHaveBeenCalled();
  });

  it('retries a transient failure once, under the same client key', async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi
        .spyOn(realSupabase, 'rpc')
        .mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch' } } as never)
        .mockResolvedValueOnce(postedPosSale() as never);
      const [create] = legacyWrites();

      const pending = commitPosSaleDocuments(queuePayload(), {
        businessId: 'biz-1',
        clientKey: 'queue-key-1',
      });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(postCalls(rpc)).toHaveLength(2);
      const first = (postCalls(rpc)[0][1] as { p_payload: Record<string, unknown> }).p_payload;
      const second = (postCalls(rpc)[1][1] as { p_payload: Record<string, unknown> }).p_payload;
      expect(first.client_key).toBe('queue-key-1');
      expect(second.client_key).toBe('queue-key-1');
      expect(create).not.toHaveBeenCalled();
      expect(result.invoice.id).toBe('inv-rpc-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a backend with no such function (demo client) as "fall back", never as a sale', async () => {
    // The demo client answers `null` for every function it does not emulate,
    // so the switch must not mistake that for a committed sale.
    const rpc = vi.spyOn(realSupabase, 'rpc').mockResolvedValue({ data: null, error: null } as never);
    const create = createWithLines().mockResolvedValue({
      invoice: { ...committedInvoice, id: 'inv-legacy-1' } as never,
      lines: [],
    });
    recordPayment();
    vi.spyOn(repos.contact, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'open' } as never);
    vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null);

    const result = await commitPosSaleDocuments(queuePayload(), { businessId: 'biz-1' });

    expect(postCalls(rpc)).toHaveLength(1);
    expect(create).toHaveBeenCalled();
    expect(result.invoice.id).toBe('inv-legacy-1');
  });

  it('does not retry the missing function, and never retries a real rejection', async () => {
    const rpc = vi
      .spyOn(realSupabase, 'rpc')
      .mockResolvedValue({ data: null, error: POST_POS_SALE_MISSING } as never);
    createWithLines().mockResolvedValue({ invoice: committedInvoice as never, lines: [] });
    recordPayment();
    vi.spyOn(repos.contact, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'open' } as never);
    vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null);

    await commitPosSaleDocuments(queuePayload(), { businessId: 'biz-1' });

    expect(postCalls(rpc)).toHaveLength(1);
  });
});
