// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildPosSaleQueuePayload,
  commitPosSaleDocuments,
  processSale,
  PosSalePostCommitError,
} from '../posService';
import { repos } from '@/lib/repositories';
import { realSupabase } from '@/lib/supabase';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { usageService } from '@/lib/billing/UsageService';
import { deriveClientKey } from '@/lib/clientKeys';
import type { PosCartItem } from '@/types/pos';
import { missingPostPosSale } from './helpers/postPosSaleStub';

/**
 * The offline POS path, end to end but without a browser: what gets queued,
 * and what the sync engine writes when the queue item is replayed.
 *
 * The property under test throughout is that a sale taken offline produces
 * the *same server records* as the same sale taken online — an invoice, its
 * lines, one payment row per leg, stock with COGS, and the shift delta —
 * under keys that make a retry safe.
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

/** 13,000 + 11,400 = 24,400 payable. */
const salePayload = {
  businessId: 'biz-remote-01',
  branchId: 'branch-remote-01',
  shiftId: 'shift-7',
  cashierId: 'user-9',
  cashierName: 'Thoko Mwale',
  customerId: 'cust-created-offline' as string | null,
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

describe('buildPosSaleQueuePayload', () => {
  it('captures the whole sale, with placeholders where the server owns the value', () => {
    const payload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-TEST-1' });

    expect(payload.receiptNumber).toBe('REC-TEST-1');
    expect(payload.invoice.invoice_number).toMatch(/^POS-OFFLINE-/);
    expect(payload.invoice).toMatchObject({
      business_id: 'biz-remote-01',
      branch_id: 'branch-remote-01',
      contact_id: 'cust-created-offline',
      total_amount: 24400,
      // amount_paid is owned by the payment rows (see commitPosSaleDocuments).
      amount_paid: 0,
      status: 'sent',
    });
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0]).toMatchObject({
      line_number: 1,
      product_id: 'prod-001',
      quantity: 2,
      unit_price: 6500,
      line_total: 13000,
    });
    expect(payload.payments).toHaveLength(2);
    expect(payload.payments[0]).toMatchObject({
      payment_method: 'airtel_money',
      amount: 10000,
      reference: 'AIR-7788',
    });
    // Drawer split, so the shift totals come out right on sync.
    expect(payload.cashSales).toBe(14400);
    expect(payload.otherSales).toBe(10000);
    expect(payload.customer).toEqual({
      name: 'Chikondi Phiri',
      phone: '+265991234567',
      email: null,
    });
  });

  it('keeps a credit sale out of the cash rows', () => {
    const payload = buildPosSaleQueuePayload(
      {
        businessId: 'biz-remote-01',
        items,
        customerId: 'cust-corp',
        customerName: 'Limbe Leaf Tobacco',
        payments: [{ payment_method: 'credit_sale', amount: 24400 }],
        totalPaid: 0,
        changeGiven: 0,
        isCreditSale: true,
        dueDate: '2026-10-19',
      },
      { receiptNumber: 'REC-TEST-2' },
    );

    expect(payload.isCreditSale).toBe(true);
    expect(payload.payments).toEqual([]);
    expect(payload.cashSales).toBe(0);
    expect(payload.otherSales).toBe(0);
    expect(payload.invoice).toMatchObject({ amount_paid: 0, due_date: '2026-10-19' });
  });
});

describe('commitPosSaleDocuments', () => {
  const committedInvoice = {
    id: 'inv-synced-1',
    business_id: 'biz-remote-01',
    invoice_number: 'INV-2026-0042',
    branch_id: 'branch-remote-01',
    department_id: null,
    created_by: 'Thoko Mwale',
    subtotal: 24400,
    vat_amount: 0,
  };

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
  const findByBusiness = () =>
    vi.spyOn(repos.contact, 'findByBusiness').mockResolvedValue([
      { id: 'uuid-chikondi', name: 'Chikondi Phiri', contact_type: 'customer' } as never,
    ]);
  const accounts = () =>
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([
      { id: 'acc-revenue', code: '4000', account_type: 'income' } as never,
    ]);

  beforeEach(() => {
    vi.restoreAllMocks();
    // The client-side path is the fallback: it runs when post_pos_sale is not
    // applied yet (stage 2 of docs/database/pos-sale-posting-rpc.md). These tests
    // are about that path, so the RPC is stubbed as missing.
    vi.spyOn(realSupabase, 'rpc').mockImplementation(
      missingPostPosSale(() => ({ data: null, error: null })) as never,
    );
    // The plan guard runs before the document write; stubbed here so the sale
    // path does not need the server for its usage count.
    vi.spyOn(usageService, 'assertCanCreateDocument').mockResolvedValue(undefined);
    // Tender routing resolves the mobile-money leg to its float account
    // (1125 Airtel Money) at commit time.
    vi.spyOn(repos.account, 'findByCode').mockImplementation(
      async (_businessId: string, code: string) =>
        (code === '1125' ? { id: 'acc-airtel', code: '1125' } : null) as never,
    );
    vi.spyOn(repos.account, 'findBankAccounts').mockResolvedValue([] as never);
    // The commit checks the stock ledger before releasing stock again (replay
    // guard); these tests stub the repositories wholesale, so answer it here.
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0042');
    vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({
      id: 'uuid-walkin',
      name: 'Walk-in Customer',
    } as never);
  });

  it('writes the sale under the queue item’s keys, so a replay cannot duplicate it', async () => {
    const create = createWithLines();
    const pay = recordPayment();
    findByBusiness();
    accounts();
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'open' } as never);
    const updateShiftTotals = vi
      .spyOn(repos.pos, 'updateShiftTotals')
      .mockResolvedValue(null);

    const queuePayload = buildPosSaleQueuePayload(salePayload, {
      receiptNumber: 'REC-TEST-3',
      clientKey: 'queue-client-key-1',
    });

    const result = await commitPosSaleDocuments(queuePayload, {
      businessId: 'biz-remote-01',
      clientKey: 'queue-client-key-1',
    });

    // The placeholder number is replaced, and the offline-created customer id
    // (which would fail the contacts foreign key) is resolved to a real one.
    const [invoiceArg, , clientKey] = create.mock.calls[0];
    expect(invoiceArg).toMatchObject({
      invoice_number: 'INV-2026-0042',
      contact_id: 'uuid-chikondi',
      revenue_account_id: 'acc-revenue',
    });
    expect(clientKey).toBe('queue-client-key-1');

    // Each payment leg gets its own deterministic key, derived from the queue
    // item's key: a retry returns the existing row instead of taking the money
    // twice. Derived, not spelled `<key>:pmt:<n>` — `client_key` is a uuid
    // column and Postgres rejects a compound string, which would leave the
    // payment unrecorded on a live server (the repositories are mocked here).
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[0][1]).toBe(deriveClientKey('queue-client-key-1', 0));
    expect(pay.mock.calls[1][1]).toBe(deriveClientKey('queue-client-key-1', 1));
    for (const [, key] of pay.mock.calls) {
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(pay.mock.calls[0][0]).toMatchObject({
      invoice_id: 'inv-synced-1',
      business_id: 'biz-remote-01',
      payment_method: 'airtel_money',
      amount: 10000,
    });

    // Stock and COGS are posted once, for the tracked lines only.
    expect(deductStockAndPostCogs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deductStockAndPostCogs).mock.calls[0][2]).toEqual([
      { productId: 'prod-001', quantity: 2 },
      { productId: 'prod-002', quantity: 3 },
    ]);

    expect(updateShiftTotals).toHaveBeenCalledWith('shift-7', {
      cashSales: 14400,
      otherSales: 10000,
    });

    expect(result.invoice.id).toBe('inv-synced-1');
    expect(result.warnings).toEqual([]);
  });

  it('leaves a closed shift alone and says so instead of rewriting a signed Z-report', async () => {
    createWithLines();
    recordPayment();
    findByBusiness();
    accounts();
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'closed' } as never);
    const updateShiftTotals = vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null);

    const queuePayload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-TEST-4' });
    const result = await commitPosSaleDocuments(queuePayload, { clientKey: 'key-4' });

    expect(updateShiftTotals).not.toHaveBeenCalled();
    expect(result.warnings.join(' ')).toMatch(/REC-TEST-4/);
    expect(result.warnings.join(' ')).toMatch(/reconcile the drawer manually/i);
  });

  it('keeps an online sale that was already saved, and warns about the failed follow-up', async () => {
    createWithLines();
    findByBusiness();
    accounts();
    vi.spyOn(repos.invoice, 'recordPayment').mockRejectedValue(
      new Error('permission denied for table invoice_payments'),
    );
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'open' } as never);

    const result = await processSale(salePayload, { isOnline: true });

    // Rejecting the sale here would have the cashier ring it up a second time,
    // duplicating revenue and stock. The customer walked out with the goods:
    // the sale stands and the problem is surfaced instead.
    expect(result.isOffline).toBe(false);
    expect(result.invoiceNumber).toBe('INV-2026-0042');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toMatch(/payment 1\/2/);
    expect(result.warnings?.[0]).toMatch(/INV-2026-0042/);
  });

  it('names the invoice when a payment row fails, so the sale is not re-rung', async () => {
    createWithLines();
    findByBusiness();
    accounts();
    vi.spyOn(repos.invoice, 'recordPayment').mockRejectedValue(new Error('network is unreachable'));
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-7', status: 'open' } as never);

    const queuePayload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-TEST-5' });

    await expect(commitPosSaleDocuments(queuePayload, { clientKey: 'key-5' })).rejects.toBeInstanceOf(
      PosSalePostCommitError,
    );

    try {
      await commitPosSaleDocuments(queuePayload, { clientKey: 'key-5' });
      throw new Error('expected the commit to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(PosSalePostCommitError);
      expect((err as PosSalePostCommitError).invoiceId).toBe('inv-synced-1');
      expect((err as PosSalePostCommitError).stage).toBe('payment');
      expect((err as PosSalePostCommitError).message).toContain('REC-TEST-5');
    }
  });
});
