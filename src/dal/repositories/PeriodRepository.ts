import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

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
   * Entry count and total debits/credits for a period, from posted
   * journal entries only. Used by the Period Management page.
   */
  async getSummary(periodId: string): Promise<{ entryCount: number; totalDebits: number; totalCredits: number }> {
    const period = await this.findById(periodId);

    const { data, error } = await this.client
      .from('journal_lines')
      .select('is_debit, amount_base, journal_entries!inner(period_id, status)')
      .eq('journal_entries.period_id', period.id)
      .eq('journal_entries.status', 'posted');

    if (error) throw toRepositoryError('accounting_periods', error);

    const lines = (data ?? []) as { is_debit: boolean; amount_base: number }[];
    const totalDebits = lines.filter((l) => l.is_debit).reduce((s, l) => s + Number(l.amount_base), 0);
    const totalCredits = lines.filter((l) => !l.is_debit).reduce((s, l) => s + Number(l.amount_base), 0);

    const { count } = await this.client
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('period_id', period.id)
      .eq('status', 'posted');

    return { entryCount: count ?? 0, totalDebits, totalCredits };
  }

  /**
   * Lock a period. The DB trigger fn_check_no_drafts_before_closing will
   * reject this if draft entries still exist in range, and auto-stamps
   * closed_by/closed_at.
   *
   * IMPORTANT: this method does NOT check the acting user's role. Callers
   * (UI layer) must verify membership.role is 'owner' or 'admin' before
   * invoking this — enforcing that here would require this repository to
   * know about business_users, which it currently does not.
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
    const { error } = await this.client.from('audit_log').insert({
      business_id: entry.business_id,
      user_id: entry.user_id,
      user_email: entry.user_email ?? null,
      event_type: entry.event_type,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      resource_ref: entry.resource_ref ?? null,
      old_values: entry.old_values ?? null,
      new_values: entry.new_values ?? null,
      notes: entry.notes ?? null,
    } as never);

    // Deliberate choice: a failed audit write does not roll back or throw
    // from the lock/unlock/reverse operation itself — the accounting action
    // already succeeded and should not be undone because logging failed.
    // It's still surfaced to the console for investigation.
    if (error) {
      console.error('Failed to write audit_log entry:', error);
    }
  }
}