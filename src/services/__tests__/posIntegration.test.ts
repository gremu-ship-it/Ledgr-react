// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { posService } from '../posService';
import { repos } from '@/lib/repositories';
import { realSupabase } from '@/lib/supabase';
import { usageService } from '@/lib/billing/UsageService';
import type { PosCartItem } from '@/types/pos';
import { missingPostPosSale } from './helpers/postPosSaleStub';

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

describe('POS Integration & Acceptance Criteria', () => {
  const chickenItem: PosCartItem = {
    product_id: 'prod-001',
    name: 'Whole Dressed Chicken 1.2kg',
    quantity: 3,
    unit_price: 6500,
    unit_cost: 4500,
    stock_on_hand: 25,
    tax_rate: 16.5,
    line_total: 19500,
  };

  const sausageItem: PosCartItem = {
    product_id: 'prod-002',
    name: 'Beef Sausage 500g',
    quantity: 2,
    unit_price: 3800,
    unit_cost: 2600,
    stock_on_hand: 10,
    tax_rate: 16.5,
    line_total: 7600,
  };

  beforeEach(() => {
    localStorage.clear();
    // The client-side path is the fallback: it runs when post_pos_sale is not
    // applied yet (stage 2 of docs/database/pos-sale-posting-rpc.md). These tests
    // are about that path, so the RPC is stubbed as missing.
    vi.spyOn(realSupabase, 'rpc').mockImplementation(
      missingPostPosSale(() => ({ data: null, error: null })) as never,
    );
    vi.spyOn(usageService, 'assertCanCreateDocument').mockResolvedValue(undefined);
    // Tender routing resolves the mobile-money leg to its float account
    // (1125 Airtel Money) at commit time.
    vi.spyOn(repos.account, 'findByCode').mockImplementation(
      async (_businessId: string, code: string) =>
        (code === '1125' ? { id: 'acc-airtel', code: '1125' } : null) as never,
    );
    vi.spyOn(repos.account, 'findBankAccounts').mockResolvedValue([] as never);
    // Replay guard for the stock ledger — no movements exist for a fresh sale.
    vi.spyOn(repos.inventory, 'hasMovementsForSource').mockResolvedValue(false as never);
  });

  describe('Split Payment & Change Computation', () => {
    it('accurately splits payment across Airtel Money and Cash with change returned', async () => {
      const businessId = 'biz-001';
      const branchId = 'branch-001';

      vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0005');
      vi.spyOn(repos.contact, 'findDefaultSaleContact').mockResolvedValue({ id: 'cust-walkin', name: 'Walk-in' } as never);

      const mockCreateWithLines = vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
        invoice: {
          id: 'inv-split-1',
          business_id: businessId,
          invoice_number: 'INV-2026-0005',
          issue_date: '2026-09-19',
          total_amount: 27100,
          amount_paid: 27100,
          amount_due: 0,
          status: 'paid',
        } as never,
        lines: [],
      });

      const mockRecordPayment = vi.spyOn(repos.invoice, 'recordPayment').mockResolvedValue({
        payment: { id: 'pmt-1' } as never,
        invoice: {} as never,
      });

      vi.spyOn(repos.branch, 'findLocationByBranch').mockResolvedValue({ id: 'loc-1' } as never);
      vi.spyOn(repos.inventory, 'recordMovement').mockResolvedValue({} as never);
      vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);

      const items = [chickenItem, sausageItem];
      const totals = posService.calculateCartTotals(items); // Gross: 27100

      // Split: 10,000 via Airtel Money, 17,100 via Cash (Customer hands 20,000 note -> change 2,900)
      const payments = [
        { payment_method: 'airtel_money' as const, amount: 10000, reference: 'AIR-TXN-9847' },
        { payment_method: 'cash' as const, amount: 17100, tendered: 20000 },
      ];

      const result = await posService.processSale({
        businessId,
        branchId,
        cashierId: 'user-001',
        cashierName: 'John Banda',
        items,
        totals,
        payments,
        totalPaid: 30000,
        changeGiven: 2900,
      }, { isOnline: true });

      expect(result.invoiceNumber).toBe('INV-2026-0005');
      expect(result.netPayable).toBe(27100);
      expect(result.totalPaid).toBe(30000);
      expect(result.changeGiven).toBe(2900);
      expect(result.payments).toHaveLength(2);
      expect(mockRecordPayment).toHaveBeenCalledTimes(2);

      // amount_paid reaches 27,100 through the two payment rows, which
      // increment it atomically. Pre-setting it on the header as well counted
      // the sale twice (amount_paid = 2× total, negative amount due).
      expect(mockCreateWithLines).toHaveBeenCalledWith(
        expect.objectContaining({ amount_paid: 0, status: 'sent', total_amount: 27100 }),
        expect.any(Array),
        expect.any(String),
      );

      mockCreateWithLines.mockRestore();
      mockRecordPayment.mockRestore();
    });
  });

  describe('Credit Sales Workflow', () => {
    it('creates credit sale marked as sent with zero immediate cash payment and customer due date', async () => {
      const businessId = 'biz-001';
      const branchId = 'branch-001';

      vi.spyOn(repos.business, 'reserveNextInvoiceNumber').mockResolvedValue('INV-2026-0006');
      // The customer here is selected from the contacts list, so no lookup is
      // needed; stubbed anyway so an accidental one cannot hit the network.
      vi.spyOn(repos.contact, 'findByBusiness').mockResolvedValue([] as never);

      const mockCreateWithLines = vi.spyOn(repos.invoice, 'createWithLines').mockResolvedValue({
        invoice: {
          id: 'inv-credit-1',
          business_id: businessId,
          invoice_number: 'INV-2026-0006',
          issue_date: '2026-09-19',
          due_date: '2026-10-19',
          total_amount: 19500,
          amount_paid: 0,
          amount_due: 19500,
          status: 'sent',
        } as never,
        lines: [],
      });

      const mockRecordPayment = vi.spyOn(repos.invoice, 'recordPayment');
      vi.spyOn(repos.branch, 'findLocationByBranch').mockResolvedValue({ id: 'loc-1' } as never);
      vi.spyOn(repos.inventory, 'recordMovement').mockResolvedValue({} as never);
      vi.spyOn(repos.account, 'findByBusiness').mockResolvedValue([] as never);

      const items = [chickenItem];
      const totals = posService.calculateCartTotals(items);

      const result = await posService.processSale({
        businessId,
        branchId,
        customerId: 'cust-corp-01',
        customerName: 'Limbe Leaf Tobacco Ltd',
        cashierId: 'user-001',
        cashierName: 'John Banda',
        items,
        totals,
        payments: [{ payment_method: 'credit_sale', amount: 19500 }],
        totalPaid: 0,
        changeGiven: 0,
        dueDate: '2026-10-19',
        notes: 'Monthly corporate account supply',
      }, { isOnline: true });

      expect(result.invoiceNumber).toBe('INV-2026-0006');
      expect(mockCreateWithLines).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'sent',
          due_date: '2026-10-19',
          amount_paid: 0,
        }),
        expect.any(Array),
        expect.any(String),
      );

      // No immediate payment records for credit sale
      expect(mockRecordPayment).not.toHaveBeenCalled();

      mockCreateWithLines.mockRestore();
    });
  });
});
