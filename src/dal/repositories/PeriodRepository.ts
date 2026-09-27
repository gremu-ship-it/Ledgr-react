import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import type { Json } from '../types/database.generated';
import { fetchAllRows } from '@/lib/paginateQuery';
import { BaseRepository } from './BaseRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';
import { createLogger } from '@/lib/logger';

const log = createLogger('PeriodRepository');

interface AuditLogEntry {
  business_id: string;
  user_id: string | null;
  user_email?: string | null;
  event_type: string;
  resource_type: string;
  resource_id: string;
  resource_ref?: string | null;
  old_values?: Json;
  new_values?: Json;
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

    const lines = await fetchAllRows<{ is_debit: boolean; amount_base: number }>(
      this.client
        .from('journal_lines')
        .select('is_debit, amount_base, journal_entries!inner(entry_date, status, business_id)')
        .eq('business_id', period.business_id)
        .eq('journal_entries.business_id', period.business_id)
        .gte('journal_entries.entry_date', period.period_start)
        .lte('journal_entries.entry_date', period.period_end)
        .in('journal_entries.status', ['posted', 'reversed']),
    );
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
   * Close (lock) a period through the server command `close_accounting_period`
   * (owner decision 2026-09-26, migration 20261014000000). The server checks
   * the role (owner / admin / accountant), refuses a period that has not ended
   * or still has draft journal entries, logs the close, and from then on
   * refuses any write dated inside the period. A direct `is_closed` update is
   * rejected by the database.
   */
  async lock(periodId: string, userId: string, userEmail?: string | null, reason?: string): Promise<Row<'accounting_periods'>> {
    const before = await this.findById(periodId);
    await this.callPeriodCommand('close_accounting_period', { p_period_id: periodId, p_reason: reason ?? null });
    const updated = await this.findById(periodId);

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

  /** Reopen a closed period (`reopen_accounting_period`): OWNER only, with a written reason (≥ 10 characters). */
  async unlock(periodId: string, userId: string, userEmail?: string | null, reason = ''): Promise<Row<'accounting_periods'>> {
    const before = await this.findById(periodId);
    await this.callPeriodCommand('reopen_accounting_period', { p_period_id: periodId, p_reason: reason });
    const updated = await this.findById(periodId);

    await this.writeAuditLog({
      business_id: updated.business_id,
      user_id: userId,
      user_email: userEmail ?? null,
      event_type: 'period_unlocked',
      resource_type: 'accounting_periods',
      resource_id: updated.id,
      resource_ref: updated.name,
      old_values: { is_closed: before.is_closed },
      new_values: { is_closed: updated.is_closed, reason },
    });

    return updated;
  }

  private async callPeriodCommand(fn: 'close_accounting_period' | 'reopen_accounting_period', args: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new RPCs (20261014000000) are not in the generated types yet
    const { error } = await (this.client.rpc as any)(fn, args);
    if (error) throw new ValidationError('accounting_periods', (error as { message?: string }).message || 'The period command failed.');
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated `rpc` signature doesn't include 'log_manual_audit_event' (the function exists in the DB but isn't surfaced by supabase gen types); verified against the live DB
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
    log.error('Failed to write audit_log entry', error as Error);
  }
}}
