import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';

interface AuditLogEntry {
  business_id: string;
  user_id: string | null;
  user_email?: string | null;
  event_type: string;
  resource_type: string;
  resource_id: string;
  resource_ref?: string | null;
  old_values?: unknown;
  new_values?: unknown;
  notes?: string | null;
}

export class PeriodRepository extends BaseRepository<'accounting_periods'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'accounting_periods');
  }

  async findByBusiness(businessId: string): Promise<Row<'accounting_periods'>[]> {
    const { data, error } = await this.client
      .from('accounting_periods')
      .select('*')
      .eq('business_id', businessId)
      .order('period_start', { ascending: false });
    if (error) throw toRepositoryError('accounting_periods', error);
    return data ?? [];
  }

  /**
   * Find the accounting period (if any) that contains the given date,
   * for the given business. Used when posting reversal entries so they
   * land in the correct open period rather than inheriting a possibly
   * locked original period_id.
   */
  async findContainingDate(businessId: string, date: string): Promise<Row<'accounting_periods'> | null> {
    const { data, error } = await this.client
      .from('accounting_periods')
      .select('*')
      .eq('business_id', businessId)
      .lte('period_start', date)
      .gte('period_end', date)
      .maybeSingle();
    if (error) throw toRepositoryError('accounting_periods', error);
    return data ?? null;
  }

  /**
   * Create a new accounting period, rejecting date ranges that overlap
   * an existing period for the same business. Overlap is checked
   * app-side (not DB-enforced) — if this becomes a real risk area later,
   * consider adding a DB exclusion constraint (btree_gist + EXCLUDE)
   * for a guaranteed race-condition-safe check.
   */
  async createPeriod(dto: InsertDto<'accounting_periods'>): Promise<Row<'accounting_periods'>> {
    if (dto.period_end < dto.period_start) {
      throw new ValidationError('accounting_periods', 'Period end date must be on or after the start date.');
    }

    const existing = await this.findByBusiness(dto.business_id);
    const overlapping = existing.find(
      (p) => dto.period_start <= p.period_end && dto.period_end >= p.period_start,
    );
    if (overlapping) {
      throw new ValidationError(
        'accounting_periods',
        `This date range overlaps with an existing period: "${overlapping.name}" (${overlapping.period_start} to ${overlapping.period_end}).`,
      );
    }

    return this.create(dto);
  }

  /**
   * Entry count and total debits/credits for a period.
   *
   * FIX: journal_entries.period_id is not populated by journalService.ts
   * on any entry-creation path (confirmed via DB query: 0 of 21 existing
   * entries have period_id set). This method matches entries by
   * entry_date falling within [period_start, period_end] instead of
   * relying on the unpopulated period_id FK.
   *
   * FIX: status filter includes both 'posted' and 'reversed' entries —
   * a reversed original's status becomes 'reversed' (not 'posted'), and
   * excluding it would break the net-zero cancellation a correct
   * original+reversal pair should produce in the totals.
   */
  async getSummary(periodId: string): Promise<{ entryCount: number; totalDebits: number; totalCredits: number }> {
    const period = await this.findById(periodId);

    const { data, error } = await this.client
      .from('journal_lines')
      .select('is_debit, amount_base, journal_entries!inner(entry_date, status, business_id)')
      .eq('business_id', period.business_id)
      .eq('journal_entries.business_id', period.business_id)
      .gte('journal_entries.entry_date', period.period_start)
      .lte('journal_entries.entry_date', period.period_end)
      .in('journal_entries.status', ['posted', 'reversed']);

    if (error) throw toRepositoryError('accounting_periods', error);

    const lines = (data ?? []) as { is_debit: boolean; amount_base: number }[];
    const totalDebits = lines.filter((l) => l.is_debit).reduce((s, l) => s + Number(l.amount_base), 0);
    const totalCredits = lines.filter((l) => !l.is_debit).reduce((s, l) => s + Number(l.amount_base), 0);

    const { count, error: countError } = await this.client
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', period.business_id)
      .gte('entry_date', period.period_start)
      .lte('entry_date', period.period_end)
      .in('status', ['posted', 'reversed']);

    if (countError) throw toRepositoryError('accounting_periods', countError);

    return { entryCount: count ?? 0, totalDebits, totalCredits };
  }

  /**
   * Lock a period. The DB trigger fn_check_no_drafts_before_closing will
   * reject this if draft entries still exist in range, and auto-stamps
   * closed_by/closed_at.
   *
   * IMPORTANT: this method does NOT check the acting user's role. Callers
   * (UI layer) must verify membership.role is 'owner' or 'admin' before
   * invoking this.
   */
  async lock(periodId: string, userId: string, userEmail?: string | null): Promise<Row<'accounting_periods'>> {
    const before = await this.findById(periodId);
    const updated = await this.update(periodId, { is_closed: true } as UpdateDto<'accounting_periods'>);

    await this.writeAuditLog({
      business_id: updated.business_id,
      user_id: userId,
      user_email: userEmail ?? null,
      event_type: 'period_locked',
      resource_type: 'accounting_periods',
      resource_id: updated.id,
      resource_ref: updated.name,
      old_values: { is_closed: before.is_closed },
      new_values: { is_closed: updated.is_closed, closed_by: updated.closed_by, closed_at: updated.closed_at },
    });

    return updated;
  }

  async unlock(periodId: string, userId: string, userEmail?: string | null): Promise<Row<'accounting_periods'>> {
    const before = await this.findById(periodId);
    const updated = await this.update(periodId, { is_closed: false } as UpdateDto<'accounting_periods'>);

    await this.writeAuditLog({
      business_id: updated.business_id,
      user_id: userId,
      user_email: userEmail ?? null,
      event_type: 'period_unlocked',
      resource_type: 'accounting_periods',
      resource_id: updated.id,
      resource_ref: updated.name,
      old_values: { is_closed: before.is_closed },
      new_values: { is_closed: updated.is_closed },
    });

    return updated;
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
  const { error } = await (this.client.rpc as any)('log_manual_audit_event', {
    p_business_id: entry.business_id,
    p_event_type: entry.event_type,
    p_resource_type: entry.resource_type,
    p_resource_id: entry.resource_id,
    p_resource_ref: entry.resource_ref ?? null,
    p_old_values: entry.old_values ?? null,
    p_new_values: entry.new_values ?? null,
    p_notes: entry.notes ?? null,
  });

  if (error) {
    console.error('Failed to write audit_log entry:', error);
  }
}}
