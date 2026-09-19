// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPosSaleQueuePayload, commitPosSaleDocuments } from '../posService';
import { repos } from '@/lib/repositories';
import { realSupabase } from '@/lib/supabase';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { usageService } from '@/lib/billing/UsageService';
import { webhookService } from '@/services/webhook/WebhookService';
import type { PosCartItem } from '@/types/pos';
import type { QueuePayloadFor } from '@/offline/payloads';

/**
 * What a till sale puts in the ledger.
 *
 * These are integration tests on purpose: `journalService` is NOT mocked, so
 * the double-entry the app would actually post is the thing under test. Only
 * the repository layer (and the stock release, which has its own tests) is
 * stubbed.
 *
 * Three properties are locked here, all of them easy to regress:
 *   1. Header money is stored the way every other invoice in the app stores
 *      it — subtotal VAT-exclusive and NET of discount — so the sale entry
 *      balances when a discount is given (the shop's normal case);
 *   2. A credit sale posts the receivable only: no cash line, because no cash
 *      was taken;
 *   3. A replay (queue retry, lost response, app killed mid-sync) does not
 *      post the same sale to the ledger or the stock ledger twice.
 */

vi.mock('@/services/inventoryJournalService', () => ({
  deductStockAndPostCogs: vi.fn().mockResolvedValue({ costLines: [], cogsEntryId: null }),
}));

const ACCOUNTS: Record<string, { id: string; code: string; name: string }> = {
  '1110': { id: 'acc-1110', code: '1110', name: 'Cash on Hand' },
  '1131': { id: 'acc-1131', code: '1131', name: 'Trade Debtors' },
  '2121': { id: 'acc-2121', code: '2121', name: 'VAT Payable' },
  '4112': { id: 'acc-rev', code: '4112', name: 'Service Revenue' },
  '4130': { id: 'acc-4130', code: '4130', name: 'Sales Discounts' },
};

/** One chicken at 1,000 with a 10% line discount → 900 payable. */
const discountedItem: PosCartItem = {
  product_id: 'prod-001',
  name: 'Whole Dressed Chicken 1.2kg',
  quantity: 1,
  unit_price: 1000,
  unit_cost: 700,
  discount: { type: 'percent', value: 10 },
  line_total: 900,
};

const paidSale = {
  businessId: 'biz-1',
  branchId: null,
  shiftId: null,
  cashierId: 'user-1',
  cashierName: 'Cashier',
  customerId: null as string | null,
  customerName: 'Walk-in Customer',
  items: [discountedItem],
  payments: [{ payment_method: 'cash' as const, amount: 900, tendered: 1000 }],
  totalPaid: 1000,
  changeGiven: 100,
};

const creditSale = {
  ...paidSale,
  customerId: 'cust-1',
  customerName: 'Chikondi Phiri',
  payments: [{ payment_method: 'credit_sale' as const, amount: 900 }],
  totalPaid: 0,
  changeGiven: 0,
  isCreditSale: true,
  dueDate: '2026-10-19',
};

type CapturedEntry = {
  header: Record<string, unknown>;
  lines: Array<Record<string, unknown> & { is_debit: boolean; amount_base: number }>;
};

function totalsOf(entry: CapturedEntry) {
  const debits = entry.lines.filter((l) => l.is_debit).reduce((s, l) => s + l.amount_base, 0);
  const credits = entry.lines.filter((l) => !l.is_debit).reduce((s, l) => s + l.amount_base, 0);
  return { debits, credits };
}

function lineFor(entry: CapturedEntry, accountId: string, isDebit: boolean) {
  return entry.lines.find((l) => l.account_id === accountId && l.is_debit === isDebit);
}

describe('POS sale posting integrity', () => {
  let storedInvoiceOverrides: Record<string, unknown>;

  /** The row the server would hand back from createWithLines. */
  function committedRow(payload: QueuePayloadFor<'pos_sale'>) {
    return {
      id: 'inv-1',
      business_id: 'biz-1',
      invoice_number: 'INV-2026-0500',
      contact_id: 'uuid-walkin',
      issue_date: '2026-09-19',
      due_date: '2026-09-19',
      currency: 'MWK',
      original_currency: null,
      exchange_rate: 1,
      functional_amount: payload.invoice.total_amount,
      subtotal: payload.invoice.subtotal,
      discount_amount: payload.invoice.discount_amount,
      taxable_amount: payload.invoice.taxable_amount,
      vat_amount: 0,
      total_amount: payload.invoice.total_amount,
      amount_paid: payload.invoice.amount_paid,
      status: 'sent',
      branch_id: null,
      department_id: null,
      created_by: 'Cashier',
      revenue_account_id: 'acc-rev',
      journal_entry_id: null,
      ...storedInvoiceOverrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    storedInvoiceOverrides = {};

    vi.spyOn(realSupabase, 'rpc').mockResolvedValue({ data: 'JNL-20260919-000001', error: null } as never);
    vi.spyOn(usageService, 'getCurrentMonthUsage').mockResolvedValue(0);
    vi.spyOn(webhookService, 'triggerWebhooks').mockResolvedValue(undefined);
    vi.spyOn(repos.business, 'findById').mockResolvedValue({ id: 'biz-1', plan_tier: 'pro' } as never);
    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0500');
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([ACCOUNTS['4112']] as never);
    vi.spyOn(repos.account, 'findById').mockResolvedValue(ACCOUNTS['4112'] as never);
    vi.spyOn(repos.account, 'findByCode').mockImplementation(
      async (_businessId: string, code: string) => (ACCOUNTS[code] ?? null) as never,
    );
    vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({
      id: 'uuid-walkin',
      name: 'Walk-in Customer',
    } as never);
    vi.spyOn(repos.contact, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.invoice, 'createWithLines').mockImplementation(
      async (invoice) => {
        const queuePayload = { invoice } as unknown as QueuePayloadFor<'pos_sale'>;
        return { invoice: committedRow(queuePayload) as never, lines: [] };
      },
    );
    vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
      payment: { id: 'pmt-1' } as never,
      invoice: {} as never,
    });
    vi.spyOn(repos.invoice, 'update').mockResolvedValue({} as never);
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue(null as never);

    vi.spyOn(repos.journal, 'createBalancedEntry').mockResolvedValue({
      entry: { id: 'je-1' } as never,
      lines: [],
    });
    vi.spyOn(repos.journal, 'post').mockResolvedValue({} as never);
  });

  it('stores subtotal net of discount so the sale entry balances', async () => {
    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-1',
      clientKey: 'key-post-1',
    });

    // The app-wide invoice convention: subtotal is VAT-exclusive and net of
    // discount, so subtotal + VAT = total and the journal can gross it up.
    expect(queuePayload.invoice.subtotal).toBe(900);
    expect(queuePayload.invoice.discount_amount).toBe(100);
    expect(
      Number(queuePayload.invoice.subtotal) + Number(queuePayload.invoice.vat_amount),
    ).toBe(Number(queuePayload.invoice.total_amount));

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-1' });

    const entries = vi.mocked(repos.journal.createBalancedEntry).mock.calls.map(
      ([header, lines]) => ({ header, lines }) as unknown as CapturedEntry,
    );
    expect(entries).toHaveLength(2); // the sale and its auto-receipt
    for (const entry of entries) {
      const { debits, credits } = totalsOf(entry);
      expect(debits).toBeCloseTo(credits, 2);
    }

    const [saleEntry, receiptEntry] = entries;

    // DR Trade Debtors 900 / DR Sales Discounts 100 / CR Revenue 1,000.
    expect(lineFor(saleEntry, 'acc-1131', true)?.amount_base).toBe(900);
    expect(lineFor(saleEntry, 'acc-4130', true)?.amount_base).toBe(100);
    expect(lineFor(saleEntry, 'acc-rev', false)?.amount_base).toBe(1000);

    // The money is in the drawer, so the receipt entry moves cash against the
    // receivable for the full total.
    expect(lineFor(receiptEntry, 'acc-1110', true)?.amount_base).toBe(900);
    expect(lineFor(receiptEntry, 'acc-1131', false)?.amount_base).toBe(900);
  });

  it('posts a credit sale as a receivable, with no cash line and no receipt', async () => {
    const queuePayload = buildPosSaleQueuePayload(creditSale, {
      receiptNumber: 'REC-POST-2',
      clientKey: 'key-post-2',
    });

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-2' });

    const entries = vi.mocked(repos.journal.createBalancedEntry).mock.calls.map(
      ([header, lines]) => ({ header, lines }) as unknown as CapturedEntry,
    );
    expect(entries).toHaveLength(1); // receivable only — nothing was received
    expect(vi.mocked(repos.journal.post)).toHaveBeenCalledTimes(1);

    const [saleEntry] = entries;
    const { debits, credits } = totalsOf(saleEntry);
    expect(debits).toBeCloseTo(credits, 2);
    expect(debits).toBe(1000); // 900 receivable + 100 discount

    expect(lineFor(saleEntry, 'acc-1131', true)?.amount_base).toBe(900);
    expect(lineFor(saleEntry, 'acc-4130', true)?.amount_base).toBe(100);
    expect(lineFor(saleEntry, 'acc-rev', false)?.amount_base).toBe(1000);
    // No cash anywhere: the ledger must not claim money the shop never took.
    expect(entries.some((entry) => lineFor(entry, 'acc-1110', true))).toBe(false);
  });

  it('does not post the ledger twice when the sale is replayed', async () => {
    storedInvoiceOverrides = { journal_entry_id: 'je-from-first-attempt' };
    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-3',
      clientKey: 'key-post-3',
    });

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-3' });

    expect(vi.mocked(repos.journal.createBalancedEntry)).not.toHaveBeenCalled();
    expect(vi.mocked(repos.journal.post)).not.toHaveBeenCalled();
  });

  it('does not release stock twice when the sale is replayed', async () => {
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(true as never);
    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-4',
      clientKey: 'key-post-4',
    });

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-4' });

    expect(deductStockAndPostCogs).not.toHaveBeenCalled();
  });
});
