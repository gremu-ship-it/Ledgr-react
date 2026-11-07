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

  describe('registers (canonical pos_terminals)', () => {
    it('lists terminals scoped to the business, including their branch and defaults', async () => {
      const row = {
        id: 'register-1', business_id: 'biz-001', name: 'Front till', code: 'REG-01',
        branch_id: 'branch-001', preferred_location_id: 'location-001', default_cash_account_id: null,
        is_active: true, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
        branch: { id: 'branch-001', name: 'Main branch' }, location: { id: 'location-001', name: 'Shop' }, cash_account: null,
      };
      const result = { data: [row], error: null };
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      mockClient.from.mockReturnValue(chain);

      const registers = await repo.getRegisters('biz-001');

      expect(mockClient.from).toHaveBeenCalledWith('pos_terminals');
      expect(chain.eq).toHaveBeenCalledWith('business_id', 'biz-001');
      expect(registers[0]).toMatchObject({ id: 'register-1', code: 'REG-01', branch: { name: 'Main branch' } });
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

    it('opens on the explicitly selected canonical register without trusting caller branch/cashier data', async () => {
      wireTables();
      mockClient.rpc.mockResolvedValue({ data: { result: 'open', shift_id: 'shift-1' }, error: null });

      await repo.openShift({ businessId: 'biz-001', terminalId: 'selected-terminal', openingFloat: 0 });

      const [, args] = mockClient.rpc.mock.calls[0];
      const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
      expect(payload.terminal_id).toBe('selected-terminal');
      expect(payload.opening_cash).toBe(0);
      expect(payload).not.toHaveProperty('branch_id');
      expect(payload).not.toHaveProperty('cashier_id');
    });

    it('leaves duplicate-open-shift rejection to the canonical server command', async () => {
      mockClient.rpc.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'An open shift already exists for this register.' },
      });

      await expect(repo.openShift({ businessId: 'biz-001', terminalId: 'till-1', openingFloat: 0 })).rejects.toThrow();
      expect(mockClient.rpc).toHaveBeenCalledWith('open_pos_shift_command', expect.anything());
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

      const closed = await repo.closeShift('shift-1', { closingCash: 75000, varianceReason: 'Counted at handover' });

      const [fn, args] = mockClient.rpc.mock.calls[0];
      expect(fn).toBe('close_pos_shift_command');
      const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
      expect(Object.keys(payload).sort()).toEqual(['closing_cash', 'command_key', 'shift_id', 'variance_reason']);
      expect(payload.closing_cash).toBe(75000);
      expect(payload.variance_reason).toBe('Counted at handover');
      expect(payload).not.toHaveProperty('variance');
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

    it('merges the shift-scoped authoritative report with server report details', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({
          data: { result: 'shift_report', shift_id: 'shift-1', cash_tenders: 1500, close: { report_number: 'Z-2026-9' } },
          error: null,
        })
        .mockResolvedValueOnce({ data: { shift_id: 'shift-1', gross_sales: 2000, tax_breakdown: {} }, error: null });
      const report = await repo.getShiftReport('shift-1');
      expect(report).toMatchObject({ cash_tenders: 1500, gross_sales: 2000, shift_id: 'shift-1' });
      expect(mockClient.rpc.mock.calls.map(([name]) => name)).toEqual([
        'get_pos_shift_report',
        'get_pos_shift_report_details',
      ]);

      mockClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function not found' } });
      await expect(repo.getShiftReport('shift-1')).resolves.toBeNull();
    });

    it('calls server POS analytics with business, branch, and date boundaries', async () => {
      const analytics = { order_count: 2, gross_sales: 120, net_sales: 100, discount_total: 20, average_ticket: 50, return_count: 0, refunds_total: 0, payment_breakdown: {} };
      mockClient.rpc.mockResolvedValueOnce({ data: analytics, error: null });

      await expect(repo.getOwnerAnalytics('biz-1', 'branch-1', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'))
        .resolves.toEqual(analytics);
      expect(mockClient.rpc).toHaveBeenCalledWith('get_pos_owner_analytics', {
        p_business_id: 'biz-1',
        p_branch_id: 'branch-1',
        p_from: '2026-11-01T00:00:00Z',
        p_to: '2026-11-02T00:00:00Z',
      });
    });
  });

  describe('held-order command surface', () => {
    const heldOrder = {
      id: 'held-1', business_id: 'biz-001', branch_id: 'branch-1', shift_id: 'shift-1',
      cashier_id: 'user-1', cashier_name: 'Cashier', customer_id: null, customer_snapshot: null,
      reference_note: 'Collect later', cart_items: [{ product_id: 'product-1', quantity: 1, unit_price: 125 }],
      subtotal: 125, discount_amount: 0, total_amount: 125, order_discount: null, cart_notes: null,
      status: 'held', resumed_at: null, resumed_by: null, expired_at: null, created_at: '2026-11-05T12:00:00Z', updated_at: '2026-11-05T12:00:00Z',
    };

    it('creates a held order through the injected RPC and derives actor/register data on the server', async () => {
      mockClient.rpc.mockResolvedValue({ data: heldOrder, error: null });
      const result = await repo.holdOrder({
        businessId: 'biz-001', commandKey: '11111111-1111-4111-8111-111111111111', shiftId: 'shift-1', referenceNote: 'Collect later',
        cartItems: heldOrder.cart_items as never, customerId: null, customerSnapshot: null,
        subtotal: 125, discountAmount: 0, totalAmount: 125,
      });
      const [fn, args] = mockClient.rpc.mock.calls[0];
      expect(fn).toBe('hold_pos_order_command');
      expect(args).toMatchObject({ p_business_id: 'biz-001', p_shift_id: 'shift-1' });
      const payload = (args as { p_payload: Record<string, unknown> }).p_payload;
      expect(payload.command_key).toBe('11111111-1111-4111-8111-111111111111');
      expect(payload.reference_note).toBe('Collect later');
      expect(payload).not.toHaveProperty('cashier_id');
      expect(payload).not.toHaveProperty('branch_id');
      expect(payload).not.toHaveProperty('register_id');
      expect(result.id).toBe('held-1');
    });

    it('loads active/history rows and resumes with shift-bound commands', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: [heldOrder], error: null });
      await expect(repo.getHeldOrders('shift-1', true)).resolves.toMatchObject([{ id: 'held-1' }]);
      expect(mockClient.rpc.mock.calls[0]).toEqual(['list_pos_held_orders', { p_shift_id: 'shift-1', p_include_history: true }]);

      mockClient.rpc.mockResolvedValueOnce({ data: { ...heldOrder, status: 'resumed' }, error: null });
      await expect(repo.resumeHeldOrder('held-1', 'shift-1')).resolves.toMatchObject({ status: 'resumed' });
      expect(mockClient.rpc.mock.calls[1]).toEqual(['resume_pos_held_order_command', { p_held_order_id: 'held-1', p_shift_id: 'shift-1' }]);
    });

    it('surfaces server errors when settings writes are rejected by the Growth plan guard', async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'Growth plan required' } }),
      };
      mockClient.from.mockReturnValue(chain);
      await expect(repo.updateSettings('biz-001', { max_cashier_discount_percent: 18 }))
        .rejects.toThrow('Growth plan required');
    });
  });

  describe('manager price-override commands', () => {
    it('lists pending requests through the server-authorized injected RPC', async () => {
      const request = {
        id: 'override-1', token: 'server-token', kind: 'price', product_id: 'product-1',
        product_name: 'Maize flour', unit_price: 1300, max_discount_percent: null,
        reason: 'Price match', requested_by: 'cashier-1', created_at: '2026-11-05T12:00:00Z',
        expires_at: '2026-11-05T12:15:00Z',
      };
      mockClient.rpc.mockResolvedValue({ data: [request], error: null });
      await expect(repo.listPendingPriceOverrides('biz-001')).resolves.toEqual([request]);
      expect(mockClient.rpc).toHaveBeenCalledWith('list_pos_price_override_requests', { p_business_id: 'biz-001' });
    });

    it('authorizes only by passing the server-minted token to the existing authorization RPC', async () => {
      mockClient.rpc.mockResolvedValue({ data: { status: 'authorized' }, error: null });
      await expect(repo.authorizePriceOverride('server-token')).resolves.toBeUndefined();
      expect(mockClient.rpc).toHaveBeenCalledWith('authorize_pos_price_override', { p_token: 'server-token' });
    });
  });
});
