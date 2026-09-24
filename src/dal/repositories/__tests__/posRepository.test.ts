import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PosRepository } from '../PosRepository';
import type { Database } from '../../types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('PosRepository', () => {
  let mockClient: {
    from: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
  };
  let repo: PosRepository;

  beforeEach(() => {
    mockClient = {
      from: vi.fn(),
      rpc: vi.fn(),
    };
    repo = new PosRepository(mockClient as unknown as SupabaseClient<Database>);
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

  describe('openShift & closeShift (R08 command surface)', () => {
    const shiftRow = {
      id: 'shift-1',
      business_id: 'biz-001',
      branch_id: 'branch-001',
      cashier_id: 'server-resolved-uid',
      opening_cash: 50000,
      expected_cash: 50000,
      status: 'open',
      opened_at: '2026-09-19T08:00:00Z',
    };

    const terminalChain = () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'till-1' }, error: null }),
    });
    const shiftReadChain = () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: shiftRow, error: null }),
    });
    const wireTables = () => {
      mockClient.from.mockImplementation((table: string) =>
        table === 'pos_terminals' ? terminalChain() : shiftReadChain());
    };

    it('opens via open_pos_shift_command: no caller-supplied cashier/branch/name in the payload', async () => {
      wireTables();
      mockClient.rpc.mockResolvedValue({ data: { result: 'open', shift_id: 'shift-1' }, error: null });

      const created = await repo.openShift({
        business_id: 'biz-001',
        branch_id: 'caller-claimed-branch',
        cashier_id: 'caller-claimed-uid',
        cashier_name: 'Caller Claimed Name',
        opening_float: 50000,
      });

      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
      const [fn, args] = mockClient.rpc.mock.calls[0];
      expect(fn).toBe('open_pos_shift_command');
      const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
      expect(Object.keys(payload).sort()).toEqual(['business_id', 'command_key', 'opening_cash', 'terminal_id']);
      expect(payload.business_id).toBe('biz-001');
      expect(payload.terminal_id).toBe('till-1');
      expect(payload.opening_cash).toBe(50000);
      expect(String(payload.command_key)).toMatch(/^open:[A-Za-z0-9:_-]{1,59}$/);
      expect(payload).not.toHaveProperty('cashier_id');
      expect(payload).not.toHaveProperty('branch_id');
      expect(created.id).toBe('shift-1');
      expect(created.opening_float).toBe(50000);
      expect(created.status).toBe('open');
    });

    it('fails honestly when no active till is registered (no claim forwarded, no fallback write)', async () => {
      mockClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }));
      await expect(repo.openShift({ business_id: 'biz-001', opening_float: 50000 }))
        .rejects.toThrow('No active POS terminal');
      expect(mockClient.rpc).not.toHaveBeenCalled();
    });

    it('closes via close_pos_shift_command and re-reads the server-signed row', async () => {
      wireTables();
      mockClient.rpc.mockResolvedValue({ data: { result: 'close', report_number: 'Z-2026-7' }, error: null });

      const closed = await repo.closeShift('shift-1', { closing_cash_actual: 75000, variance: 0 });

      const [fn, args] = mockClient.rpc.mock.calls[0];
      expect(fn).toBe('close_pos_shift_command');
      const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
      expect(Object.keys(payload).sort()).toEqual(['closing_cash', 'command_key', 'shift_id', 'variance_reason']);
      expect(payload.closing_cash).toBe(75000);
      expect(payload.shift_id).toBe('shift-1');
      expect(closed.id).toBe('shift-1');
    });
  });

  describe('cash movements (R08 command surface)', () => {
    it('records via record_pos_cash_movement_command: actor/branch server-resolved, safe_drop aliased, no counter side-effect', async () => {
      const movementRow = {
        id: 'mov-1',
        shift_id: 'shift-1',
        movement_type: 'safe_deposit',
        amount: 20000,
        reason: 'Added mid-day change float',
      };
      mockClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: movementRow, error: null }),
      }));
      mockClient.rpc.mockResolvedValue({
        data: { result: 'movement', movement_id: 'mov-1', shift_id: 'shift-1', movement_type: 'safe_deposit', amount: 20000 },
        error: null,
      });

      const recorded = await repo.recordCashMovement({
        business_id: 'biz-001',
        shift_id: 'shift-1',
        cashier_id: 'caller-claimed-uid',
        cashier_name: 'caller-claimedname',
        movement_type: 'safe_drop',
        amount: 20000,
        reason: 'Added mid-day change float',
      });

      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
      const [fn, args] = mockClient.rpc.mock.calls[0];
      expect(fn).toBe('record_pos_cash_movement_command');
      const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
      expect(Object.keys(payload).sort()).toEqual(['amount', 'command_key', 'movement_type', 'reason', 'shift_id']);
      expect(payload.movement_type).toBe('safe_deposit');
      expect(payload).not.toHaveProperty('business_id');
      expect(payload).not.toHaveProperty('cashier_id');
      expect(recorded.id).toBe('mov-1');
      expect(recorded.amount).toBe(20000);
    });

    it('getShiftReport surfaces the R08.4 tender-derived read (null on old backends)', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: { result: 'shift_report', cash_tenders: 1500, close: { report_number: 'Z-2026-9' } },
        error: null,
      });
      const report = await repo.getShiftReport('shift-1');
      expect((report as Record<string, unknown>).cash_tenders).toBe(1500);
      expect(mockClient.rpc.mock.calls[0][0]).toBe('get_pos_shift_report');

      mockClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function not found' } });
      await expect(repo.getShiftReport('shift-1')).resolves.toBeNull();
    });
  });
});
