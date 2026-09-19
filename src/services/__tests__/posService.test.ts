// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { posService } from '../posService';
import type { PosCartItem, PosDiscount } from '@/types/pos';
import { repos } from '@/lib/repositories';
import { realSupabase } from '@/lib/supabase';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { usageService } from '@/lib/billing/UsageService';
import { missingPostPosSale } from './helpers/postPosSaleStub';

/**
 * The canonical offline queue is Dexie-backed, which these unit tests do not
 * stand up. The enqueue call itself is what matters here: the payload it is
 * handed is asserted in full below.
 */
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));

vi.mock('@/offline/queueApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/offline/queueApi')>()),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

const { journalEntryMock, receivableEntryMock, settlementEntryMock } = vi.hoisted(() => ({
  journalEntryMock: vi.fn().mockResolvedValue({}),
  receivableEntryMock: vi.fn().mockResolvedValue('je-sale'),
  settlementEntryMock: vi.fn().mockResolvedValue('je-receipt'),
}));

vi.mock('@/services/journalService', () => ({
  createInvoiceJournalEntry: (...args: unknown[]) => journalEntryMock(...args),
  createInvoiceReceivableEntry: (...args: unknown[]) => receivableEntryMock(...args),
  createInvoiceSettlementEntry: (...args: unknown[]) => settlementEntryMock(...args),
}));

vi.mock('@/services/inventoryJournalService', () => ({
  deductStockAndPostCogs: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/webhook/webhook-triggers', () => ({
  triggerWebhook: vi.fn().mockResolvedValue({}),
}));

describe('posService', () => {
  const sampleItems: PosCartItem[] = [
    {
      product_id: 'prod-001',
      name: 'Whole Dressed Chicken 1.2kg',
      quantity: 2,
      unit_price: 6500,
      unit_cost: 4500,
      stock_on_hand: 20,
      tax_rate: 16.5,
      line_total: 13000,
    },
    {
      product_id: 'prod-002',
      name: 'Beef Sausage 500g',
      quantity: 3,
      unit_price: 3800,
      unit_cost: 2600,
      stock_on_hand: 15,
      tax_rate: 16.5,
      line_total: 11400,
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    // The client-side path is the fallback: it runs when post_pos_sale is not
    // applied yet (stage 2 of docs/database/pos-sale-posting-rpc.md). These tests
    // are about that path, so the RPC is stubbed as missing.
    vi.spyOn(realSupabase, 'rpc').mockImplementation(
      missingPostPosSale(() => ({ data: null, error: null })) as never,
    );
    // The plan guard runs before the document write and needs the server for
    // the plan tier and the month's document count; stubbed here.
    vi.spyOn(usageService, 'assertCanCreateDocument').mockResolvedValue(undefined);
  });

  describe('calculateCartTotals', () => {
    it('calculates gross, subtotal, tax and net payable without discounts', () => {
      const totals = posService.calculateCartTotals(sampleItems, undefined, 16.5);
      expect(totals.gross_total).toBe(24400);
      expect(totals.discount_total).toBe(0);
      expect(totals.net_payable).toBe(24400);
      expect(totals.item_count).toBe(5);
      expect(totals.tax_total).toBeCloseTo(3455.79, 1);
    });

    it('applies percentage line discounts correctly', () => {
      const itemsWithLineDiscount: PosCartItem[] = [
        {
          ...sampleItems[0],
          discount: { type: 'percent', value: 10 },
          line_total: 11700,
        },
        sampleItems[1],
      ];

      const totals = posService.calculateCartTotals(itemsWithLineDiscount, undefined, 0);
      expect(totals.gross_total).toBe(24400);
      expect(totals.discount_total).toBe(1300);
      expect(totals.net_payable).toBe(23100);
    });

    it('applies overall order discount correctly', () => {
      const orderDiscount: PosDiscount = { type: 'fixed', value: 2000, reason: 'Loyalty Reward' };
      const totals = posService.calculateCartTotals(sampleItems, orderDiscount, 0);

      expect(totals.gross_total).toBe(24400);
      expect(totals.discount_total).toBe(2000);
      expect(totals.net_payable).toBe(22400);
    });

    it('combines line discounts and order discounts without exceeding gross total', () => {
      const itemsWithLineDiscount: PosCartItem[] = [
        {
          ...sampleItems[0],
          discount: { type: 'fixed', value: 3000 },
          line_total: 10000,
        },
      ];
      const orderDiscount: PosDiscount = { type: 'fixed', value: 12000 };
      const totals = posService.calculateCartTotals(itemsWithLineDiscount, orderDiscount, 0);

      expect(totals.gross_total).toBe(13000);
      expect(totals.discount_total).toBe(13000);
      expect(totals.net_payable).toBe(0);
    });
  });

  describe('offline queue management', () => {
    it('queues an offline sale as a complete pos_sale item on the shared queue', async () => {
      enqueueMock.mockReset();
      enqueueMock.mockResolvedValue(1);

      const payload = {
        businessId: 'biz-001',
        branchId: 'branch-001',
        items: sampleItems,
        totals: posService.calculateCartTotals(sampleItems),
        payments: [{ payment_method: 'cash' as const, amount: 24400 }],
        totalPaid: 24400,
        changeGiven: 0,
      };

      const result = await posService.processSale(payload, { isOnline: false });

      expect(result.isOffline).toBe(true);
      expect(result.invoiceNumber).toMatch(/^POS-OFFLINE-/);

      expect(enqueueMock).toHaveBeenCalledTimes(1);
      const [operationType, businessId, queuePayload] = enqueueMock.mock.calls[0];
      expect(operationType).toBe('pos_sale');
      expect(businessId).toBe('biz-001');

      // The queued item has to be the whole sale, not a summary of it: the
      // sync handler writes the invoice, its lines, the cash and the stock
      // from this payload alone.
      expect(queuePayload.receiptNumber).toBe(result.receiptNumber);
      expect(queuePayload.invoice).toMatchObject({
        business_id: 'biz-001',
        contact_id: 'offline_walk_in_customer',
        total_amount: 24400,
        amount_paid: 0,
      });
      expect(queuePayload.invoice.invoice_number).toMatch(/^POS-OFFLINE-/);
      expect(queuePayload.lines).toHaveLength(2);
      expect(queuePayload.payments).toEqual([
        expect.objectContaining({ payment_method: 'cash', amount: 24400 }),
      ]);
      expect(queuePayload.cashSales).toBe(24400);
      expect(queuePayload.otherSales).toBe(0);

      // The POS-only localStorage queue this used to write is retired — a sale
      // parked there was invisible to the rest of the app.
      expect(localStorage.getItem('ledgr_pos_offline_queue')).toBeNull();
    });

    it('refuses to queue a sale without a business rather than inventing a tenant', async () => {
      enqueueMock.mockReset();

      await expect(
        posService.processSale(
          {
            items: sampleItems,
            totals: posService.calculateCartTotals(sampleItems),
            payments: [{ payment_method: 'cash' as const, amount: 24400 }],
            totalPaid: 24400,
            changeGiven: 0,
          },
          { isOnline: false },
        ),
      ).rejects.toThrow(/without a business/i);

      expect(enqueueMock).not.toHaveBeenCalled();
    });
  });

  describe('amount paid and stock are written once', () => {
    it('leaves amount_paid to the payment rows instead of pre-setting it on the header', async () => {
      const businessId = 'biz-test-02';
      const mockCreateWithLines = vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
        invoice: { id: 'inv-1', business_id: businessId, invoice_number: 'INV-1' } as never,
        lines: [],
      });
      const mockRecordPayment = vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
        payment: { id: 'pmt-1' } as never,
        invoice: {} as never,
      });
      vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-1');
      vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({ id: 'cont-1' } as never);
      vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
      vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);

      const totals = posService.calculateCartTotals(sampleItems);
      await posService.processSale(
        {
          businessId,
          items: sampleItems,
          totals,
          payments: [{ payment_method: 'cash' as const, amount: totals.net_payable }],
          totalPaid: totals.net_payable,
          changeGiven: 0,
        },
        { isOnline: true },
      );

      // amount_paid is incremented atomically by recordPayment(). Setting it on
      // the header as well counted every payment twice (amount_paid = 2× total,
      // negative amount due). The header now carries only what no payment row
      // covers — nothing, for a fully paid sale.
      const header = mockCreateWithLines.mock.calls[0][0] as Record<string, unknown>;
      expect(header).toMatchObject({ amount_paid: 0, status: 'sent', total_amount: totals.net_payable });
      expect(mockRecordPayment).toHaveBeenCalledTimes(1);

      mockCreateWithLines.mockRestore();
      mockRecordPayment.mockRestore();
    });

    it('deducts stock once, through the COGS service that records the movements', async () => {
      const businessId = 'biz-test-03';
      vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
        invoice: { id: 'inv-2', business_id: businessId, invoice_number: 'INV-2' } as never,
        lines: [],
      });
      vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
        payment: { id: 'pmt-2' } as never,
        invoice: {} as never,
      });
      vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2');
      vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({ id: 'cont-1' } as never);
      vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
      vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);
      const mockRecordMovement = vi.spyOn(repos.inventory, 'recordMovement').mockResolvedValue({} as never);
      const stockSpy = vi.mocked(deductStockAndPostCogs);
      stockSpy.mockClear();

      const totals = posService.calculateCartTotals(sampleItems);
      await posService.processSale(
        {
          businessId,
          items: sampleItems,
          totals,
          payments: [{ payment_method: 'cash' as const, amount: totals.net_payable }],
          totalPaid: totals.net_payable,
          changeGiven: 0,
        },
        { isOnline: true },
      );

      // deductStockAndPostCogs writes the movements itself. The extra
      // per-item recordMovement loop that used to run before it deducted every
      // sale twice — once as 'pos_sale', once as 'invoice'.
      expect(mockRecordMovement).not.toHaveBeenCalled();
      expect(stockSpy).toHaveBeenCalledTimes(1);
      expect(stockSpy.mock.calls[0][2]).toEqual([
        { productId: 'prod-001', quantity: 2 },
        { productId: 'prod-002', quantity: 3 },
      ]);

      mockRecordMovement.mockRestore();
    });
  });

  describe('sale execution and stock movements', () => {
    it('creates invoice, lines, payments, stock movements, and journal entry', async () => {
      const businessId = 'biz-test-01';
      const branchId = 'branch-test-01';

      // Mock repository calls
      const mockReserveNumber = vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0001');
      const mockDefaultContact = vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({ id: 'cont-1', name: 'Walk-in' } as never);
      // Replay guard for the stock ledger: no movements exist for a new sale.
      vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);

      const mockCreateWithLines = vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
        invoice: {
          id: 'inv-test-1',
          business_id: businessId,
          invoice_number: 'INV-2026-0001',
          issue_date: '2026-09-19',
          total_amount: 24400,
          amount_paid: 24400,
          amount_due: 0,
          status: 'paid',
          currency: 'MWK',
        } as never,
        lines: [],
      });

      const mockRecordPayment = vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
        payment: { id: 'pmt-1', amount: 24400, payment_method: 'cash' } as never,
        invoice: {} as never,
      });

      const mockFindLocation = vi.spyOn(repos.branch, 'findLocationByBranch').mockResolvedValue({
        id: 'loc-1',
        name: 'Main Store',
        business_id: businessId,
      } as never);

      const mockRecordMovement = vi.spyOn(repos.inventory, 'recordMovement').mockResolvedValue({
        movement: { id: 'mov-1' } as never,
        balance: { id: 'bal-1', quantity_on_hand: 18 } as never,
      });

      const mockFindAccounts = vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([
        { id: 'acc-cash', account_number: '1010', name: 'Cash on Hand', classification: 'asset' },
        { id: 'acc-sales', account_number: '4000', name: 'Sales Revenue', classification: 'revenue' },
        { id: 'acc-cogs', account_number: '5000', name: 'Cost of Goods Sold', classification: 'expense' },
        { id: 'acc-inv', account_number: '1200', name: 'Inventory Asset', classification: 'asset' },
      ] as never);

      const payload = {
        businessId,
        branchId,
        cashierId: 'cashier-1',
        cashierName: 'John Banda',
        items: sampleItems,
        totals: posService.calculateCartTotals(sampleItems, undefined, 0),
        payments: [{ payment_method: 'cash' as const, amount: 25000 }],
        totalPaid: 25000,
        changeGiven: 600,
      };

      const result = await posService.processSale(payload, { isOnline: true });

      expect(result.invoiceNumber).toBe('INV-2026-0001');
      expect(result.totalPaid).toBe(25000);
      expect(result.changeGiven).toBe(600);
      expect(mockCreateWithLines).toHaveBeenCalled();

      mockReserveNumber.mockRestore();
      mockDefaultContact.mockRestore();
      mockCreateWithLines.mockRestore();
      mockRecordPayment.mockRestore();
      mockFindLocation.mockRestore();
      mockRecordMovement.mockRestore();
      mockFindAccounts.mockRestore();
    });
  });

  describe('returns and voids', () => {
    it('processes returns by creating credit note, replenishing inventory, and posting GL entry', async () => {
      const businessId = 'biz-test-01';
      const branchId = 'branch-1';

      const mockInvoiceFind = vi.spyOn(repos.invoice, 'findById').mockResolvedValue({
        id: 'inv-orig-1',
        business_id: businessId,
        invoice_number: 'INV-2026-0001',
        branch_id: branchId,
        status: 'paid',
        total_amount: 13000,
        currency: 'MWK',
      } as never);

      const mockCreateWithLines = vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
        invoice: { id: 'cn-1', invoice_number: 'CN-2026-0001', total_amount: -6500 } as never,
        lines: [],
      });

      const mockFindLocation = vi.spyOn(repos.branch, 'findLocationByBranch').mockResolvedValue({
        id: 'loc-1',
        business_id: businessId,
      } as never);

      const mockDefaultLocation = vi.spyOn(repos.inventory, 'findDefaultLocation').mockResolvedValue({
        id: 'loc-1',
        business_id: businessId,
      } as never);

      const mockRecordMovement = vi.spyOn(repos.inventory, 'recordMovement').mockResolvedValue({
        movement: { id: 'mov-ret-1' } as never,
        balance: { id: 'bal-1', quantity_on_hand: 21 } as never,
      });

      const returnResult = await posService.processReturn({
        businessId,
        branchId,
        originalInvoiceId: 'inv-orig-1',
        receiptNumber: 'RCPT-001',
        reason: 'Defective product',
        refundMethod: 'cash',
        items: [
          {
            productId: 'prod-001',
            productName: 'Whole Dressed Chicken 1.2kg',
            quantity: 1,
            unitPrice: 6500,
            refundAmount: 6500,
          },
        ],
        totalRefund: 6500,
        cashierName: 'John Banda',
      });

      expect(returnResult.returnInvoiceId).toBe('cn-1');
      expect(mockRecordMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movement_type: 'return_in',
          quantity: 1,
        }),
      );

      mockInvoiceFind.mockRestore();
      mockCreateWithLines.mockRestore();
      mockFindLocation.mockRestore();
      mockDefaultLocation.mockRestore();
      mockRecordMovement.mockRestore();
    });

    it('voids a sale by marking invoice void, reversing inventory, and writing audit log', async () => {
      const businessId = 'biz-test-01';

      const mockFindWithLines = vi.spyOn(repos.invoice, 'findByIdWithLines').mockResolvedValue({
        invoice: {
          id: 'inv-void-1',
          business_id: businessId,
          invoice_number: 'INV-2026-0002',
          branch_id: 'branch-1',
          status: 'paid',
          total_amount: 13000,
        } as never,
        lines: [
          {
            id: 'line-1',
            product_id: 'prod-001',
            quantity: 2,
            unit_price: 6500,
          } as never,
        ],
      });

      const mockUpdate = vi.spyOn(repos.invoice, 'update').mockResolvedValue({
        id: 'inv-void-1',
        status: 'void',
      } as never);

      const mockFindLocation = vi.spyOn(repos.branch, 'findLocationByBranch').mockResolvedValue({
        id: 'loc-1',
        business_id: businessId,
      } as never);

      const mockRecordMovement = vi.spyOn(repos.inventory, 'recordMovement').mockResolvedValue({
        movement: { id: 'mov-void-1' } as never,
        balance: { id: 'bal-1', quantity_on_hand: 22 } as never,
      });

      const voidResult = await posService.processVoid({
        businessId,
        invoiceId: 'inv-void-1',
        receiptNumber: 'RCPT-002',
        reason: 'Cashier entered wrong customer',
        cashierName: 'John Banda',
      });

      expect(voidResult.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('inv-void-1', expect.objectContaining({ status: 'void' }));
      expect(mockRecordMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movement_type: 'adjustment_in',
          quantity: 2,
        }),
      );

      mockFindWithLines.mockRestore();
      mockUpdate.mockRestore();
      mockFindLocation.mockRestore();
      mockRecordMovement.mockRestore();
    });
  });
});
