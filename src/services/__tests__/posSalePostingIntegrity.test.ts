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
import { missingPostPosSale } from './helpers/postPosSaleStub';

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
  '1125': { id: 'acc-1125', code: '1125', name: 'Mobile Money — Airtel Money' },
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
  let paymentSeq = 0;

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

    // `next_journal_entry_number` answers with a number; post_pos_sale is stubbed
    // as not-yet-migrated so this suite keeps testing the client-side path
    // (its fallback) rather than the RPC.
    vi.spyOn(realSupabase, 'rpc').mockImplementation(
      missingPostPosSale(() => ({ data: 'JNL-20260919-000001', error: null })) as never,
    );
    // The plan guard runs before the document write (see the dedicated test
    // below); stubbed here so the ledger tests do not need a network.
    vi.spyOn(usageService, 'assertWithinTransactionLimit').mockResolvedValue(undefined);
    // No keyed posting exists yet on the happy path.
    vi.spyOn(repos.journal, 'findByPostingKey').mockResolvedValue(null as never);
    vi.spyOn(repos.account, 'findBankAccounts').mockResolvedValue([] as never);
    vi.spyOn(webhookService, 'triggerWebhooks').mockResolvedValue(undefined);
    vi.spyOn(repos.business, 'findById').mockResolvedValue({ id: 'biz-1', plan_tier: 'pro' } as never);
    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0500');
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([ACCOUNTS['4112']] as never);
    vi.spyOn(repos.account, 'findById').mockImplementation(
      // Resolve the account by id, the way the server does: the settlement
      // posting debits whatever account the payment points at.
      async (id: string) =>
        (Object.values(ACCOUNTS).find((account) => account.id === id) ??
          ACCOUNTS['4112']) as never,
    );
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
    paymentSeq = 0;
    vi.spyOn(repos.invoice, 'recordPayment').mockImplementation(async (payment) => {
      paymentSeq += 1;
      return {
        // Echo what the server would store: the settlement posting reads the
        // row's amounts and currency.
        payment: { id: `pmt-${paymentSeq}`, ...payment } as never,
        invoice: {} as never,
      };
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
    // Both halves are already in the ledger under their posting keys — that is
    // what a replay of a committed sale meets.
    vi.mocked(repos.journal.findByPostingKey).mockImplementation(
      async (_businessId, key) =>
        ({ id: key.includes('settlement') ? 'je-receipt' : 'je-sale', status: 'posted' }) as never,
    );

    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-3',
      clientKey: 'key-post-3',
    });

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-3' });

    expect(vi.mocked(repos.journal.createBalancedEntry)).not.toHaveBeenCalled();
    expect(vi.mocked(repos.journal.post)).not.toHaveBeenCalled();
  });

  it('finishes a keyed entry left as a draft by a crash instead of posting it again', async () => {
    vi.mocked(repos.journal.findByPostingKey).mockImplementation(
      async (_businessId, key) =>
        ({ id: key.includes('settlement') ? 'je-receipt' : 'je-sale', status: 'draft' }) as never,
    );

    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-5',
      clientKey: 'key-post-5',
    });

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-5' });

    // Nothing new is created; the two drafts are posted.
    expect(vi.mocked(repos.journal.createBalancedEntry)).not.toHaveBeenCalled();
    expect(vi.mocked(repos.journal.post).mock.calls.map(([id]) => id).sort()).toEqual([
      'je-receipt',
      'je-sale',
    ]);
  });

  it('settles each tender into the account the money actually landed in', async () => {
    const splitSale = {
      ...paidSale,
      payments: [
        { payment_method: 'airtel_money' as const, amount: 300 },
        { payment_method: 'cash' as const, amount: 600 },
      ],
      totalPaid: 900,
      changeGiven: 0,
    };

    const queuePayload = buildPosSaleQueuePayload(splitSale, {
      receiptNumber: 'REC-POST-6',
      clientKey: 'key-post-6',
    });

    await commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-6' });

    // The mobile-money leg is recorded against the Airtel float account, not
    // dropped into the cash drawer...
    const paymentArgs = vi.mocked(repos.invoice.recordPayment).mock.calls.map(([payment]) => payment);
    expect(paymentArgs).toHaveLength(2);
    expect(paymentArgs[0]).toMatchObject({ payment_method: 'airtel_money', bank_account_id: 'acc-1125' });
    expect(paymentArgs[1]).toMatchObject({ payment_method: 'cash', bank_account_id: null });

    // ...and the ledger settles each leg into its own account.
    const entries = vi.mocked(repos.journal.createBalancedEntry).mock.calls.map(
      ([header, lines]) => ({ header, lines }) as unknown as CapturedEntry,
    );
    expect(entries).toHaveLength(3); // sale + two receipts (one per tender)
    const settlements = entries.slice(1);
    expect(lineFor(settlements[0], 'acc-1125', true)?.amount_base).toBe(300);
    expect(lineFor(settlements[1], 'acc-1110', true)?.amount_base).toBe(600);
    for (const settlement of settlements) {
      expect(lineFor(settlement, 'acc-1131', false)).toBeTruthy();
      const { debits, credits } = totalsOf(settlement);
      expect(debits).toBeCloseTo(credits, 2);
    }
  });

  it('refuses the sale when the plan limit is reached, before anything is written', async () => {
    vi.mocked(usageService.assertWithinTransactionLimit).mockRejectedValue(
      new Error('Monthly transaction limit reached (50). Please upgrade your plan.'),
    );
    const findByClientKey = vi
      .spyOn(repos.invoice, 'findByClientKey')
      .mockResolvedValue(null as never);

    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-7',
      clientKey: 'key-post-7',
    });

    await expect(
      commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-7' }),
    ).rejects.toThrow(/Monthly transaction limit reached/);

    // Nothing was written: no orphan invoice, no ledger, no stock release.
    expect(vi.mocked(repos.invoice.createWithLines)).not.toHaveBeenCalled();
    expect(vi.mocked(repos.journal.createBalancedEntry)).not.toHaveBeenCalled();
    expect(deductStockAndPostCogs).not.toHaveBeenCalled();

    // A replay of an already-committed sale is not blocked by the limit: its
    // document is on the books and the retry has to finish the job.
    findByClientKey.mockResolvedValue({ id: 'inv-1' } as never);
    await expect(
      commitPosSaleDocuments(queuePayload, { businessId: 'biz-1', clientKey: 'key-post-7' }),
    ).resolves.toBeDefined();
    expect(vi.mocked(repos.invoice.createWithLines)).toHaveBeenCalled();
  });

  it('still posts the ledger when the posting_key column is not migrated yet', async () => {
    // The deploy pipeline ships the frontend before it runs `supabase db push`,
    // so for a few minutes `journal_entries.posting_key` does not exist and the
    // insert is rejected (PGRST204). Losing the ledger entry would be far worse
    // than losing the key, so the post is retried without it.
    vi.mocked(repos.journal.createBalancedEntry).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "Could not find the 'posting_key' column of 'journal_entries' in the schema cache",
        ),
        { code: 'PGRST204' },
      ),
    );

    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-8',
      clientKey: 'key-post-8',
    });

    const result = await commitPosSaleDocuments(queuePayload, {
      businessId: 'biz-1',
      clientKey: 'key-post-8',
    });

    const headers = vi
      .mocked(repos.journal.createBalancedEntry)
      .mock.calls.map(([header]) => header);

    // The first attempt carried the key; exactly one retry dropped it...
    expect(headers[0]).toHaveProperty('posting_key');
    expect(headers.filter((header) => !('posting_key' in header))).toHaveLength(1);
    // ...and the entry reached the books, so the sale carries no warning.
    expect(result.warnings).toEqual([]);
    expect(repos.journal.post).toHaveBeenCalled();
  });

  it('does not treat an unrelated ledger failure as a missing column', async () => {
    // The fallback must stay narrow: a real insert failure has to keep
    // surfacing as a warning, not quietly retry keyless and mask the problem.
    vi.mocked(repos.journal.createBalancedEntry).mockRejectedValue(
      Object.assign(new Error('permission denied for table journal_entries'), { code: '42501' }),
    );

    const queuePayload = buildPosSaleQueuePayload(paidSale, {
      receiptNumber: 'REC-POST-9',
      clientKey: 'key-post-9',
    });

    const result = await commitPosSaleDocuments(queuePayload, {
      businessId: 'biz-1',
      clientKey: 'key-post-9',
    });

    const headers = vi
      .mocked(repos.journal.createBalancedEntry)
      .mock.calls.map(([header]) => header);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((header) => 'posting_key' in header)).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/sales journal entry could not be posted/i);
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
