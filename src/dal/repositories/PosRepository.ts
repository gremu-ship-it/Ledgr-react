import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';
import type {
  PosShift,
  PosCashMovement,
  PosSettings,
  PosPermission,
} from '@/types/pos';
import { DEFAULT_ROLE_PERMISSIONS } from '@/types/pos';
import { createLogger } from '@/lib/logger';

const log = createLogger('PosRepository');

const DEFAULT_SETTINGS: (businessId: string) => PosSettings = (businessId) => ({
  business_id: businessId,
  enabled_payment_methods: ['cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale'],
  max_cashier_discount_percent: 10,
  max_manager_discount_percent: 25,
  cashier_max_discount_percent: 10,
  manager_max_discount_percent: 25,
  require_manager_approval_discount: true,
  require_manager_approval_void: true,
  require_manager_approval_refund: true,
  require_manager_approval_price_override: true,
  require_approval_for_void: true,
  require_approval_for_refund: true,
  cash_variance_threshold: 500,
  require_explanation_variance_threshold: 500,
  allow_negative_stock_sales: false,
  default_tax_rate: 16.5,
  receipt_header: null,
  receipt_footer: 'Zikomo kwambiri! Thank you for your business.',
  show_tax_on_receipt: true,
  custom_role_permissions: DEFAULT_ROLE_PERMISSIONS,
});

interface RawPosSettingsData {
  id?: string;
  business_id?: string;
  enabled_payment_methods?: string[];
  max_cashier_discount_percent?: number;
  cashier_max_discount_percent?: number;
  max_manager_discount_percent?: number;
  manager_max_discount_percent?: number;
  require_manager_approval_discount?: boolean;
  require_manager_approval_void?: boolean;
  require_manager_approval_refund?: boolean;
  require_manager_approval_price_override?: boolean;
  require_approval_for_void?: boolean;
  require_approval_for_refund?: boolean;
  cash_variance_threshold?: number;
  require_explanation_variance_threshold?: number;
  allow_negative_stock_sales?: boolean;
  default_tax_rate?: number;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  show_tax_on_receipt?: boolean;
  custom_role_permissions?: Record<string, PosPermission[]>;
}

export class PosRepository extends BaseRepository<'pos_shifts'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'pos_shifts');
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  async getSettings(businessId: string): Promise<PosSettings> {
    try {
      const { data, error } = await this.client
        .from('pos_settings')
        .select('*')
        .eq('business_id', businessId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        log.warn('Could not load pos_settings, using defaults', { error });
      }

      if (!data) return DEFAULT_SETTINGS(businessId);

      const d = data as unknown as RawPosSettingsData;
      const cashierMax = Number(
        d.max_cashier_discount_percent ??
        d.cashier_max_discount_percent ??
        10
      );
      const managerMax = Number(
        d.max_manager_discount_percent ??
        d.manager_max_discount_percent ??
        25
      );
      const varianceThresh = Number(
        d.cash_variance_threshold ??
        d.require_explanation_variance_threshold ??
        500
      );

      return {
        id: d.id,
        business_id: d.business_id || businessId,
        enabled_payment_methods: d.enabled_payment_methods ?? [
          'cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale',
        ],
        max_cashier_discount_percent: cashierMax,
        max_manager_discount_percent: managerMax,
        cashier_max_discount_percent: cashierMax,
        manager_max_discount_percent: managerMax,
        require_manager_approval_discount: Boolean(d.require_manager_approval_discount ?? d.require_approval_for_void ?? true),
        require_manager_approval_void: Boolean(d.require_manager_approval_void ?? d.require_approval_for_void ?? true),
        require_manager_approval_refund: Boolean(d.require_manager_approval_refund ?? d.require_approval_for_refund ?? true),
        require_manager_approval_price_override: Boolean(d.require_manager_approval_price_override ?? true),
        require_approval_for_void: Boolean(d.require_manager_approval_void ?? d.require_approval_for_void ?? true),
        require_approval_for_refund: Boolean(d.require_manager_approval_refund ?? d.require_approval_for_refund ?? true),
        cash_variance_threshold: varianceThresh,
        require_explanation_variance_threshold: varianceThresh,
        allow_negative_stock_sales: Boolean(d.allow_negative_stock_sales ?? false),
        default_tax_rate: Number(d.default_tax_rate ?? 16.5),
        receipt_header: d.receipt_header,
        receipt_footer: d.receipt_footer || 'Zikomo kwambiri! Thank you for your business.',
        show_tax_on_receipt: Boolean(d.show_tax_on_receipt ?? true),
        custom_role_permissions: d.custom_role_permissions || DEFAULT_ROLE_PERMISSIONS,
      };
    } catch {
      return DEFAULT_SETTINGS(businessId);
    }
  }

  async updateSettings(businessId: string, settings: Partial<PosSettings>): Promise<PosSettings> {
    const existing = await this.getSettings(businessId);
    const merged = { ...existing, ...settings, business_id: businessId, updated_at: new Date().toISOString() };

    const updatePayload: InsertDto<'pos_settings'> = {
      business_id: businessId,
      enabled_payment_methods: merged.enabled_payment_methods as never,
      cashier_max_discount_percent: merged.max_cashier_discount_percent,
      manager_max_discount_percent: merged.max_manager_discount_percent,
      require_approval_for_void: merged.require_approval_for_void ?? true,
      require_approval_for_refund: merged.require_approval_for_refund ?? true,
      require_explanation_variance_threshold: merged.cash_variance_threshold,
      receipt_header: merged.receipt_header,
      receipt_footer: merged.receipt_footer || 'Zikomo kwambiri! Thank you for your business.',
      show_tax_on_receipt: merged.show_tax_on_receipt ?? true,
      custom_role_permissions: (merged.custom_role_permissions || DEFAULT_ROLE_PERMISSIONS) as never,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.client
      .from('pos_settings')
      .upsert(updatePayload as never)
      .select('*')
      .single();

    if (error) {
      log.warn('Failed to upsert pos_settings, returning in-memory settings', { error });
      return merged;
    }

    return merged;
  }

  // ── Shifts ───────────────────────────────────────────────────────────────

  async findActiveShift(
    businessId: string,
    cashierId?: string | null,
    branchId?: string | null,
  ): Promise<PosShift | null> {
    let query = this.client
      .from('pos_shifts')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (cashierId) query = query.eq('cashier_id', cashierId);
    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      log.warn('Could not query current open shift', { error });
      return null;
    }
    if (!data) return null;

    return {
      ...(data as unknown as PosShift),
      opening_float: data.opening_cash,
      start_time: data.opened_at,
      expectedCash: data.expected_cash,
      status: (data.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
    };
  }

  async getCurrentShift(cashierId: string, branchId?: string | null): Promise<PosShift | null> {
    let query = this.client
      .from('pos_shifts')
      .select('*')
      .eq('cashier_id', cashierId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query.limit(1).maybeSingle();
    if (error || !data) return null;

    return {
      ...(data as unknown as PosShift),
      opening_float: data.opening_cash,
      start_time: data.opened_at,
      expectedCash: data.expected_cash,
      status: (data.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
    };
  }

  /** Idempotency key for the R08 command surface (server enforces ^[A-Za-z0-9:_-]{4,64}$). */
  private newCommandKey(prefix: string): string {
    const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}:${uuid}`;
  }

  /**
   * R08.5 rewire: tills are server-registered (`pos_terminals`). The client
   * never claims a branch — the till's branch is the only branch the server
   * will stamp. Resolves the business's first active till; till assignment
   * per device lands with the terminal-assignment surface (documented gap).
   */
  private async resolveActiveTerminalId(businessId: string): Promise<string | null> {
    // Generated row types predate the R08 `pos_terminals` table; query it
    // through an untyped handle (row contract: { id } only).
    const untyped = this.client as unknown as SupabaseClient;
    const { data, error } = await untyped
      .from('pos_terminals')
      .select('id')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { id: string }).id;
  }

  private toShift(data: Record<string, unknown>): PosShift {
    return {
      ...(data as unknown as PosShift),
      opening_float: data.opening_cash as number,
      start_time: data.opened_at as string,
      expectedCash: data.expected_cash as number,
      status: (data.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
    } as PosShift;
  }

  private async readShiftRow(shiftId: string): Promise<PosShift> {
    const { data, error } = await this.client
      .from('pos_shifts')
      .select('*')
      .eq('id', shiftId)
      .single();
    if (error) throw toRepositoryError('pos_shifts', error);
    return this.toShift(data as Record<string, unknown>);
  }

  /**
   * R08.5: raw INSERT on `pos_shifts` is revoked (R08.2). The canonical
   * command resolves cashier identity (auth.uid → user_profiles) and branch
   * (from the till) server-side — caller-supplied cashier/branch/name values
   * are intentionally NOT forwarded, and `notes` is not part of the command
   * contract. Rejection surfaces as an honest error (zero server mutation).
   */
  async openShift(
    arg1: string | {
      business_id?: string;
      businessId?: string;
      branch_id?: string | null;
      branchId?: string | null;
      cashier_id?: string;
      cashierId?: string;
      cashier_name?: string;
      cashierName?: string;
      opening_float?: number;
      openingCash?: number;
      terminal_id?: string;
      notes?: string | null;
    },
    arg2?: {
      branchId?: string | null;
      cashierId: string;
      cashierName: string;
      openingCash?: number;
      opening_float?: number;
      notes?: string;
    },
  ): Promise<PosShift> {
    const businessId = typeof arg1 === 'string' ? arg1 : (arg1.business_id || arg1.businessId || 'biz-default');
    const openingFloat = typeof arg1 === 'string'
      ? Number(arg2?.openingCash ?? arg2?.opening_float ?? 0)
      : Number(arg1.opening_float ?? arg1.openingCash ?? 0);

    const terminalId = await this.resolveActiveTerminalId(businessId);
    if (!terminalId) {
      throw new Error('No active POS terminal is registered for this business. Ask an administrator to register a till before opening a shift.');
    }

    const { data, error } = await this.client.rpc('open_pos_shift_command' as never, {
      p_payload: {
        business_id: businessId,
        terminal_id: terminalId,
        command_key: this.newCommandKey('open'),
        opening_cash: openingFloat,
      },
    } as never);
    if (error) throw toRepositoryError('pos_shifts', error);
    const shiftId = (data as { shift_id?: string } | null)?.shift_id;
    if (!shiftId) throw new Error('open_pos_shift_command returned no shift id.');
    return this.readShiftRow(shiftId);
  }

  /**
   * R08.5: raw UPDATE on `pos_shifts` is revoked. The canonical command
   * derives expected cash from invoice_payments/pos_corrections/movements
   * (never client counters), signs the immutable close, and returns the
   * server-computed expected/actual/variance + sequential Z report number.
   * `notes` is not part of the command contract; the read-back row carries
   * the server-set values.
   */
  async closeShift(
    shiftId: string,
    payload: {
      closingCashActual?: number;
      closing_cash_actual?: number;
      actualCash?: number;
      variance?: number;
      varianceReason?: string;
      variance_reason?: string;
      notes?: string | null;
    } | number,
  ): Promise<PosShift> {
    const actualCash = typeof payload === 'number'
      ? payload
      : Number(payload.closingCashActual ?? payload.closing_cash_actual ?? payload.actualCash ?? 0);
    const varianceReason = typeof payload === 'number' ? null : (payload.varianceReason || payload.variance_reason || null);

    const { error } = await this.client.rpc('close_pos_shift_command' as never, {
      p_payload: {
        shift_id: shiftId,
        command_key: this.newCommandKey('close'),
        closing_cash: actualCash,
        variance_reason: varianceReason,
      },
    } as never);
    if (error) throw toRepositoryError('pos_shifts', error);
    return this.readShiftRow(shiftId);
  }

  /**
   * Fetch one shift by id.
   *
   * Used where the caller must know whether a shift is still open *before*
   * changing it — e.g. an offline sale syncing days later: adding its takings
   * to a shift that has already been counted and Z-reported would silently
   * rewrite a signed document.
   */
  async findShiftById(shiftId: string): Promise<PosShift | null> {
    try {
      const { data, error } = await this.client
        .from('pos_shifts')
        .select('*')
        .eq('id', shiftId)
        .maybeSingle();

      if (error || !data) return null;
      return {
        ...(data as unknown as PosShift),
        opening_float: data.opening_cash,
        start_time: data.opened_at,
        expectedCash: data.expected_cash,
        status: (data.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
      } as PosShift;
    } catch {
      return null;
    }
  }

  async listShifts(
    businessId: string,
    branchId?: string | null,
    limit = 50,
  ): Promise<PosShift[]> {
    let query = this.client
      .from('pos_shifts')
      .select('*')
      .eq('business_id', businessId)
      .order('opened_at', { ascending: false })
      .limit(limit);

    if (branchId) query = query.eq('branch_id', branchId);

    const { data, error } = await query;
    if (error) throw toRepositoryError('pos_shifts', error);
    return (data ?? []).map((d) => ({
      ...(d as unknown as PosShift),
      opening_float: d.opening_cash,
      start_time: d.opened_at,
      expectedCash: d.expected_cash,
      status: (d.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
    })) as PosShift[];
  }

  async updateShiftTotals(
    shiftId: string,
    delta: {
      cashSales?: number;
      otherSales?: number;
      refunds?: number;
      cashIn?: number;
      cashOut?: number;
    },
  ): Promise<PosShift | null> {
    try {
      const { data: shift, error: fetchErr } = await this.client
        .from('pos_shifts')
        .select('*')
        .eq('id', shiftId)
        .single();

      if (fetchErr || !shift) return null;

      const cashSales = Number(shift.cash_sales_amount || 0) + (Number(delta.cashSales) || 0);
      const otherSales = Number(shift.other_sales_amount || 0) + (Number(delta.otherSales) || 0);
      const totalSales = cashSales + otherSales;
      const refunds = Number(shift.refunds_amount || 0) + (Number(delta.refunds) || 0);
      const cashIn = Number(shift.cash_in_amount || 0) + (Number(delta.cashIn) || 0);
      const cashOut = Number(shift.cash_out_amount || 0) + (Number(delta.cashOut) || 0);

      const expectedCash =
        Number(shift.opening_cash || 0) + cashSales + cashIn - cashOut - refunds;

      const { data, error } = await this.client
        .from('pos_shifts')
        .update({
          cash_sales_amount: cashSales,
          other_sales_amount: otherSales,
          total_sales_amount: totalSales,
          refunds_amount: refunds,
          cash_in_amount: cashIn,
          cash_out_amount: cashOut,
          expected_cash: expectedCash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', shiftId)
        .select('*')
        .single();

      if (error) {
        log.warn('Failed to update shift totals', { error });
        return null;
      }
      return {
        ...(data as unknown as PosShift),
        opening_float: data.opening_cash,
        start_time: data.opened_at,
        expectedCash: data.expected_cash,
        status: (data.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
      } as PosShift;
    } catch {
      return null;
    }
  }

  // ── Cash Movements ────────────────────────────────────────────────────────

  /**
   * R08.5: raw INSERT on `pos_cash_movements` is revoked; the command writes
   * movement row + drawer totals atomically with server-resolved actor and
   * branch. Caller-supplied names/ids are intentionally NOT forwarded.
   * 'safe_drop' aliases to the canonical 'safe_deposit'.
   */
  async recordCashMovement(payload: {
    business_id?: string;
    businessId?: string;
    branch_id?: string | null;
    branchId?: string | null;
    shift_id?: string | null;
    shiftId?: string | null;
    cashier_id?: string | null;
    cashierId?: string | null;
    cashier_name?: string | null;
    cashierName?: string | null;
    userId?: string;
    userName?: string;
    type?: 'cash_in' | 'cash_out';
    movement_type?: 'cash_in' | 'cash_out' | 'petty_cash' | 'safe_drop' | 'safe_deposit';
    movementType?: 'cash_in' | 'cash_out' | 'petty_cash' | 'safe_drop' | 'safe_deposit';
    amount: number;
    reason: string;
    notes?: string | null;
    authorized_by?: string | null;
    created_by?: string | null;
  }): Promise<PosCashMovement> {
    const shiftId = payload.shift_id ?? payload.shiftId ?? null;
    const movementType = payload.type || payload.movement_type || payload.movementType || 'cash_in';
    const serverType = movementType === 'safe_drop' ? 'safe_deposit' : movementType;
    const amount = Math.abs(Number(payload.amount) || 0);

    const { data, error } = await this.client.rpc('record_pos_cash_movement_command' as never, {
      p_payload: {
        shift_id: shiftId,
        command_key: this.newCommandKey('movement'),
        movement_type: serverType,
        amount,
        reason: payload.reason,
      },
    } as never);
    if (error) throw toRepositoryError('pos_cash_movements', error);

    const movementId = (data as { movement_id?: string } | null)?.movement_id ?? null;
    if (movementId) {
      const { data: row } = await this.client
        .from('pos_cash_movements')
        .select('*')
        .eq('id', movementId)
        .maybeSingle();
      if (row) return row as PosCashMovement;
    }
    return {
      id: movementId ?? 'rpc',
      shift_id: shiftId,
      movement_type: serverType,
      amount,
      reason: payload.reason,
    } as PosCashMovement;
  }

  /**
   * R08.4 read surface: tender-derived shift report (live derivation + the
   * immutable close snapshot after signing). Returns null when the backend
   * predates the R08 migration or the caller may not read the shift.
   */
  async getShiftReport(shiftId: string): Promise<Record<string, unknown> | null> {
    try {
      const { data, error } = await this.client.rpc('get_pos_shift_report' as never, {
        p_shift_id: shiftId,
      } as never);
      if (error) return null;
      return (data ?? null) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  async listCashMovements(businessId: string, shiftId?: string): Promise<PosCashMovement[]> {
    let query = this.client
      .from('pos_cash_movements')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (shiftId) query = query.eq('shift_id', shiftId);

    const { data, error } = await query;
    if (error) throw toRepositoryError('pos_cash_movements', error);
    return (data ?? []) as PosCashMovement[];
  }
}
