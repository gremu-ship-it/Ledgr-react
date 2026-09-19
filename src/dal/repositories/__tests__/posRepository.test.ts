import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PosRepository } from '../PosRepository';
import type { Database } from '../../types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('PosRepository', () => {
  let mockClient: any;
  let repo: PosRepository;

  beforeEach(() => {
    mockClient = {
      from: vi.fn(),
      rpc: vi.fn(),
    };
    repo = new PosRepository(mockClient as SupabaseClient<Database>);
  });

  describe('getSettings', () => {
    it('returns default fallback settings if no custom record is saved', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockClient.from.mockReturnValue(selectChain);

      const settings = await repo.getSettings('biz-001');

      expect(settings.max_cashier_discount_percent).toBe(10);
      expect(settings.max_manager_discount_percent).toBe(25);
      expect(settings.cash_variance_threshold).toBe(500);
      expect(settings.enabled_payment_methods).toContain('cash');
      expect(settings.enabled_payment_methods).toContain('airtel_money');
    });

    it('returns custom settings when available in database', async () => {
      const customDbSettings = {
        id: 'set-1',
        business_id: 'biz-001',
        max_cashier_discount_percent: 5,
        max_manager_discount_percent: 15,
        cash_variance_threshold: 1000,
        receipt_header: 'Chikondi Supermarket',
        receipt_footer: 'Zikomo kwambiri',
        enabled_payment_methods: ['cash', 'tnm_mpamba'],
        require_manager_approval_discount: true,
        require_manager_approval_void: true,
        require_manager_approval_refund: true,
        require_manager_approval_price_override: true,
        allow_negative_stock_sales: true,
        default_tax_rate: 16.5,
      };

      const selectChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: customDbSettings, error: null }),
      };
      mockClient.from.mockReturnValue(selectChain);

      const settings = await repo.getSettings('biz-001');

      expect(settings.max_cashier_discount_percent).toBe(5);
      expect(settings.max_manager_discount_percent).toBe(15);
      expect(settings.cash_variance_threshold).toBe(1000);
      expect(settings.receipt_header).toBe('Chikondi Supermarket');
    });
  });

  describe('openShift & closeShift', () => {
    it('opens a new shift with generated shift number and opening float', async () => {
      const shiftRow = {
        id: 'shift-1',
        business_id: 'biz-001',
        branch_id: 'branch-001',
        cashier_id: 'user-001',
        shift_number: 'SH-2026-0001',
        opening_float: 50000,
        opening_cash: 50000,
        status: 'open',
        opened_at: '2026-09-19T08:00:00Z',
      };

      const insertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: shiftRow, error: null }),
      };
      mockClient.from.mockReturnValue(insertChain);

      const created = await repo.openShift({
        business_id: 'biz-001',
        cashier_id: 'user-001',
        opening_float: 50000,
      });

      expect(created.id).toBe('shift-1');
      expect(created.opening_float).toBe(50000);
      expect(created.status).toBe('open');
    });

    it('closes an active shift and records closing cash and variance', async () => {
      const updatedShiftRow = {
        id: 'shift-1',
        business_id: 'biz-001',
        status: 'closed',
        closing_cash_actual: 75000,
        closing_cash_expected: 75000,
        variance: 0,
        closed_at: '2026-09-19T17:00:00Z',
      };

      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: updatedShiftRow, error: null }),
      };
      mockClient.from.mockReturnValue(updateChain);

      const closed = await repo.closeShift('shift-1', {
        closing_cash_actual: 75000,
        variance: 0,
      });

      expect(closed.status).toBe('closed');
      expect(closed.variance).toBe(0);
    });
  });

  describe('cash movements', () => {
    it('records cash-in, petty cash or safe drop with justification', async () => {
      const movementRow = {
        id: 'mov-1',
        shift_id: 'shift-1',
        movement_type: 'cash_in',
        amount: 20000,
        reason: 'Added mid-day change float',
      };

      const insertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: movementRow, error: null }),
      };
      mockClient.from.mockReturnValue(insertChain);

      const recorded = await repo.recordCashMovement({
        business_id: 'biz-001',
        shift_id: 'shift-1',
        cashier_id: 'user-001',
        cashier_name: 'John Banda',
        movement_type: 'cash_in',
        amount: 20000,
        reason: 'Added mid-day change float',
      });

      expect(recorded.id).toBe('mov-1');
      expect(recorded.amount).toBe(20000);
      expect(recorded.reason).toBe('Added mid-day change float');
    });
  });
});
