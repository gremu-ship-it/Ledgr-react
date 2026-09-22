// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineDB } from '@/offline/db';
import {
  enqueue,
  getPendingCount,
  recoverStaleSyncClaims,
  STALE_SYNC_CLAIM_MS,
} from '@/offline/queueApi';
import { syncQueue } from '@/offline/syncEngine';
import { usageService } from '@/lib/billing/UsageService';
import { buildPosSaleQueuePayload } from '@/services/posService';
import { repos } from '@/lib/repositories';
import { realSupabase } from '@/lib/supabase';
import type { PosCartItem, PosSalePayload } from '@/types/pos';
import { missingPostPosSale } from '@/services/__tests__/helpers/postPosSaleStub';
import { useAppStore } from '@/store/useAppStore';

/**
 * R09.2 test identity: replay requires provenance matching the current
 * session. This suite models the same signed-in cashier capturing and later
 * replaying its own sales (Case A — the normal path).
 */
const TEST_CASHIER = { id: 'r09-pos-sync-cashier', email: 'cashier@r13.test', profile: null };
beforeEach(() => {
  useAppStore.setState({ currentUser: TEST_CASHIER });
});

/**
 * The end-to-end path this whole change is about: a sale taken at a till with
 * no connection is written into the app-wide queue, shows up in that queue's
 * counts, and — when connectivity returns — is replayed by the sync engine
 * into invoice + lines + payments + stock, exactly like an online sale.
 */

vi.mock('@/services/journalService', () => ({
  createInvoiceJournalEntry: vi.fn().mockResolvedValue({}),
  createInvoiceReceivableEntry: vi.fn().mockResolvedValue({}),
  createExpenseJournalEntry: vi.fn().mockResolvedValue({}),
  createInvoiceSettlementEntry: vi.fn().mockResolvedValue({}),
  createExpenseSettlementEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/inventoryJournalService', () => ({
  deductStockAndPostCogs: vi.fn().mockResolvedValue({}),
  resolveExpenseLineAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/quickSaveService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/quickSaveService')>()),
  saveQuickSaleViaRpc: vi.fn(),
  saveQuickExpenseViaRpc: vi.fn(),
}));

const items: PosCartItem[] = [
  {
    product_id: 'prod-001',
    name: 'Whole Dressed Chicken 1.2kg',
    quantity: 2,
    unit_price: 6500,
    line_total: 13000,
  },
];

const salePayload: PosSalePayload = {
  businessId: 'biz-till-1',
  shiftId: 'shift-1',
  cashierName: 'Thoko Mwale',
  customerName: 'Walk-in Customer',
  items,
  payments: [{ payment_method: 'cash', amount: 13000, tendered: 15000 }],
  totalPaid: 15000,
  changeGiven: 2000,
};

describe('a POS sale queued offline', () => {
  beforeEach(async () => {
    await offlineDB.queue.clear();
    vi.restoreAllMocks();
    // The client-side path is the fallback: it runs when post_pos_sale is not
    // applied yet (stage 2 of docs/database/pos-sale-posting-rpc.md). This suite
    // covers the client-side write, so the RPC is stubbed as missing.
    vi.spyOn(realSupabase, 'rpc').mockImplementation(
      missingPostPosSale(() => ({ data: null, error: null })) as never,
    );
    // The sync pass checks the plan limit before writing a document.
    vi.spyOn(usageService, 'assertCanCreateDocument').mockResolvedValue(undefined);
  });

  it('appears in the shared queue and syncs into the books', async () => {
    const payload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-OFF-1' });

    const localId = await enqueue('pos_sale', 'biz-till-1', payload);

    // This is what the header's offline drawer and its badge count.
    const queued = await offlineDB.queue.get(localId);
    expect(queued).toMatchObject({ operationType: 'pos_sale', status: 'pending' });
    expect(await offlineDB.queue.where('status').anyOf('pending', 'failed').count()).toBe(1);

    // Nothing has reached the server yet.
    const createWithLines = vi.spyOn(repos.invoice, 'createWithLines');
    expect(createWithLines).not.toHaveBeenCalled();

    // ── Connectivity returns ──────────────────────────────────────────────
    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0100');
    vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({
      id: 'uuid-walkin',
      name: 'Walk-in Customer',
    } as never);
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
    createWithLines.mockResolvedValue({
      invoice: {
        id: 'inv-offline-1',
        business_id: 'biz-till-1',
        invoice_number: 'INV-2026-0100',
        subtotal: 13000,
        vat_amount: 0,
      } as never,
      lines: [],
    });
    const recordPayment = vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
      payment: { id: 'pmt-1' } as never,
      invoice: {} as never,
    });
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-1', status: 'open' } as never);
    const updateShiftTotals = vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null);

    const progress = await syncQueue();

    expect(progress).toMatchObject({ total: 1, completed: 1, failed: 0 });

    // The offline placeholder number and sentinel contact are replaced.
    expect(createWithLines).toHaveBeenCalledTimes(1);
    expect(createWithLines.mock.calls[0][0]).toMatchObject({
      invoice_number: 'INV-2026-0100',
      contact_id: 'uuid-walkin',
      total_amount: 13000,
    });
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment.mock.calls[0][0]).toMatchObject({
      invoice_id: 'inv-offline-1',
      payment_method: 'cash',
      amount: 13000,
    });
    expect(updateShiftTotals).toHaveBeenCalledWith('shift-1', {
      cashSales: 13000,
      otherSales: 0,
    });

    // The item is done, and the drawer's counts drop back to zero.
    const synced = await offlineDB.queue.get(localId);
    expect(synced).toMatchObject({ status: 'synced', resolvedServerId: 'inv-offline-1' });
    expect(await offlineDB.queue.where('status').anyOf('pending', 'failed').count()).toBe(0);
  });

  it('reports a failure on the item instead of losing the sale', async () => {
    const payload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-OFF-2' });
    const localId = await enqueue('pos_sale', 'biz-till-1', payload);

    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0101');
    vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({ id: 'uuid-walkin' } as never);
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.invoice, 'createWithLines').mockRejectedValue(new Error('duplicate key value'));

    const progress = await syncQueue();

    expect(progress).toMatchObject({ total: 1, completed: 0, failed: 1 });
    const item = await offlineDB.queue.get(localId);
    expect(item?.status).toBe('failed');
    // Surfaced in the drawer as "needs attention", with the real reason.
    expect(item?.lastError).toContain('duplicate key value');
    expect(item?.attemptCount).toBe(1);
  });

  it('retries a sale the app abandoned mid-sync instead of leaving it invisible', async () => {
    const payload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-OFF-3' });
    const localId = await enqueue('pos_sale', 'biz-till-1', payload);

    // A tab killed while this item was being sent: the claim is old, so it is
    // abandoned rather than in flight.
    await offlineDB.queue.update(localId, {
      status: 'syncing',
      attemptCount: 1,
      lastAttemptAt: new Date(Date.now() - STALE_SYNC_CLAIM_MS - 60_000).toISOString(),
    });

    // The badge counts it — the sale is not on the server, and the till must
    // not be left believing it is.
    expect(await getPendingCount()).toBe(1);

    vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0102');
    vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({ id: 'uuid-walkin' } as never);
    vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
    vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
      invoice: {
        id: 'inv-offline-3',
        business_id: 'biz-till-1',
        invoice_number: 'INV-2026-0102',
        total_amount: 13000,
      } as never,
      lines: [],
    });
    vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
      payment: { id: 'pmt-3' } as never,
      invoice: {} as never,
    });
    vi.spyOn(repos.pos, 'findShiftById').mockResolvedValue({ id: 'shift-1', status: 'open' } as never);
    vi.spyOn(repos.pos, 'updateShiftTotals').mockResolvedValue(null);

    const progress = await syncQueue();

    expect(progress).toMatchObject({ total: 1, completed: 1, failed: 0 });
    expect((await offlineDB.queue.get(localId))?.status).toBe('synced');
    expect(await getPendingCount()).toBe(0);
  });

  it('leaves a claim that is still inside its lease alone', async () => {
    const payload = buildPosSaleQueuePayload(salePayload, { receiptNumber: 'REC-OFF-4' });
    const localId = await enqueue('pos_sale', 'biz-till-1', payload);

    // Fresh claim: another tab may still be writing this sale.
    await offlineDB.queue.update(localId, {
      status: 'syncing',
      lastAttemptAt: new Date().toISOString(),
    });

    expect(await getPendingCount()).toBe(0);
    expect(await recoverStaleSyncClaims()).toBe(0);
    expect((await offlineDB.queue.get(localId))?.status).toBe('syncing');
  });
});
