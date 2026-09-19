import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, UpdateDto } from '../types/database';
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
    const branchId = typeof arg1 === 'string' ? (arg2?.branchId ?? null) : (arg1.branch_id ?? arg1.branchId ?? null);
    const cashierId = typeof arg1 === 'string' ? (arg2?.cashierId ?? null) : (arg1.cashier_id ?? arg1.cashierId ?? null);
    const cashierName = typeof arg1 === 'string' ? (arg2?.cashierName ?? null) : (arg1.cashier_name ?? arg1.cashierName ?? null);
    const openingFloat = typeof arg1 === 'string'
      ? Number(arg2?.openingCash ?? arg2?.opening_float ?? 0)
      : Number(arg1.opening_float ?? arg1.openingCash ?? 0);
    const notes = typeof arg1 === 'string' ? (arg2?.notes ?? null) : (arg1.notes ?? null);

    const newShift: InsertDto<'pos_shifts'> = {
      business_id: businessId,
      branch_id: branchId,
      cashier_id: cashierId,
      cashier_name: cashierName,
      opened_at: new Date().toISOString(),
      opening_cash: openingFloat,
      expected_cash: openingFloat,
      actual_cash: null,
      cash_variance: null,
      variance_reason: null,
      total_sales_amount: 0,
      cash_sales_amount: 0,
      other_sales_amount: 0,
      refunds_amount: 0,
      cash_in_amount: 0,
      cash_out_amount: 0,
      status: 'open',
      notes,
    };

    const { data, error } = await this.client
      .from('pos_shifts')
      .insert(newShift)
      .select('*')
      .single();

    if (error) throw toRepositoryError('pos_shifts', error);
    return {
      ...(data as unknown as PosShift),
      opening_float: data.opening_cash,
      start_time: data.opened_at,
      expectedCash: data.expected_cash,
      status: 'open',
    } as PosShift;
  }

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
    notesArg?: string,
  ): Promise<PosShift> {
    const { data: shift, error: fetchErr } = await this.client
      .from('pos_shifts')
      .select('*')
      .eq('id', shiftId)
      .single();

    if (fetchErr) throw toRepositoryError('pos_shifts', fetchErr);

    const actualCash = typeof payload === 'number'
      ? payload
      : Number(payload.closingCashActual ?? payload.closing_cash_actual ?? payload.actualCash ?? 0);
    const variance = typeof payload === 'number' ? undefined : payload.variance;
    const varianceReason = typeof payload === 'number' ? null : (payload.varianceReason || payload.variance_reason || null);
    const notes = typeof payload === 'number' ? (notesArg ?? null) : (payload.notes ?? null);

    const expectedCash =
      Number(shift.opening_cash || 0) +
      Number(shift.cash_sales_amount || 0) +
      Number(shift.cash_in_amount || 0) -
      Number(shift.cash_out_amount || 0) -
      Number(shift.refunds_amount || 0);

    const calculatedVariance = variance !== undefined ? variance : actualCash - expectedCash;

    const updatePayload: UpdateDto<'pos_shifts'> = {
      closed_at: new Date().toISOString(),
      actual_cash: actualCash,
      expected_cash: expectedCash,
      cash_variance: calculatedVariance,
      variance_reason: varianceReason,
      status: 'closed',
      notes: notes || shift.notes,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('pos_shifts')
      .update(updatePayload)
      .eq('id', shiftId)
      .select('*')
      .single();

    if (error) throw toRepositoryError('pos_shifts', error);
    return {
      ...(data as unknown as PosShift),
      opening_float: data.opening_cash,
      start_time: data.opened_at,
      expectedCash: data.expected_cash,
      status: 'closed',
    } as PosShift;
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
    const businessId = payload.business_id || payload.businessId || 'biz-default';
    const branchId = payload.branch_id ?? payload.branchId ?? null;
    const shiftId = payload.shift_id ?? payload.shiftId ?? null;
    const cashierId = payload.cashier_id ?? payload.cashierId ?? payload.userId ?? payload.created_by ?? null;
    const cashierName = payload.cashier_name ?? payload.cashierName ?? payload.userName ?? null;
    const movementType = payload.type || payload.movement_type || payload.movementType || 'cash_in';
    const amount = Math.abs(Number(payload.amount) || 0);

    const row: InsertDto<'pos_cash_movements'> = {
      business_id: businessId,
      branch_id: branchId,
      shift_id: shiftId,
      user_id: cashierId,
      user_name: cashierName,
      movement_type: movementType,
      amount,
      reason: payload.reason,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('pos_cash_movements')
      .insert(row)
      .select('*')
      .single();

    if (error) throw toRepositoryError('pos_cash_movements', error);

    // If linked to an open shift, update shift cash movement totals
    if (shiftId) {
      const isCashIn = movementType === 'cash_in';
      await this.updateShiftTotals(shiftId, {
        cashIn: isCashIn ? amount : 0,
        cashOut: !isCashIn ? amount : 0,
      }).catch((e) => log.warn('Failed to sync cash movement with shift totals', { error: e }));
    }

    return data as PosCashMovement;
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
