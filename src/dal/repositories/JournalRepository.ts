import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';

export interface JournalEntryWithLines {
  entry: Row<'journal_entries'>;
  lines: Row<'journal_lines'>[];
}

export class JournalRepository extends BaseRepository<'journal_entries'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'journal_entries');
  }

  /**
   * Fetch a journal entry along with all of its lines.
   *
   * FIX [#5 Missing business_id tenant filtering]:
   * Previous version queried `journal_lines` by `journal_entry_id` only.
   * `journal_lines.business_id` is NOT NULL in the schema. Added explicit
   * `business_id` filter using the parent entry's business_id.
   */
  async findByIdWithLines(id: string): Promise<JournalEntryWithLines> {
    const entry = await this.findById(id);

    const { data, error } = await this.client
      .from('journal_lines')
      .select('*')
      .eq('journal_entry_id', id)
      .eq('business_id', entry.business_id) // FIX: tenant-scope
      .order('line_number', { ascending: true });

    if (error) throw toRepositoryError('journal_entries', error);
    return { entry, lines: data ?? [] };
  }

  /**
   * Fetch all journal entries for a business within a date range.
   */
  async findByBusinessAndDateRange(
    businessId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Row<'journal_entries'>[]> {
    const { data, error } = await this.client
      .from('journal_entries')
      .select('*')
      .eq('business_id', businessId)
      .gte('entry_date', fromDate)
      .lte('entry_date', toDate)
      .order('entry_date', { ascending: false });

    if (error) throw toRepositoryError('journal_entries', error);
    return data ?? [];
  }

  /**
   * Create a balanced journal entry with its lines in one operation.
   *
   * FIX [#7 Accounting/IFRS logic — balance check uses wrong field]:
   * Previous version used `amount_base ?? amount` for the balance check.
   * Schema states: "amount_base stores the MWK-equivalent for multi-currency
   * entries." Balancing MUST use `amount_base` (functional currency) only.
   * Falling back to `amount` would compare, e.g., USD debits against MWK
   * credits — a balance check that passes when it should fail.
   * `amount_base` is NOT NULL in the schema, so no fallback is needed.
   *
   * The DB also enforces this via a DEFERRED trigger, but the application-
   * layer check provides a cleaner error message before the round-trip.
   */
  async createBalancedEntry(
    entry: InsertDto<'journal_entries'>,
    lines: Omit<InsertDto<'journal_lines'>, 'journal_entry_id' | 'business_id'>[],
  ): Promise<JournalEntryWithLines> {
    if (lines.length < 2) {
      throw new ValidationError(
        'journal_entries',
        'A journal entry requires at least two lines.',
      );
    }

    // FIX: use amount_base exclusively — it is the MWK functional-currency
    // amount and is NOT NULL, so no fallback to `amount` is needed or safe.
    const totalDebits = lines
      .filter((l) => l.is_debit)
      .reduce((sum, l) => sum + Number(l.amount_base), 0);

    const totalCredits = lines
      .filter((l) => !l.is_debit)
      .reduce((sum, l) => sum + Number(l.amount_base), 0);

    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      throw new ValidationError(
        'journal_entries',
        `Journal entry does not balance in functional currency (MWK): ` +
        `debits ${totalDebits.toFixed(2)} ≠ credits ${totalCredits.toFixed(2)}.`,
      );
    }

    const createdEntry = await this.create(entry);

    const lineRows: InsertDto<'journal_lines'>[] = lines.map((line) => ({
      ...line,
      journal_entry_id: createdEntry.id,
      business_id: createdEntry.business_id,
    }));

    const { data, error } = await this.client
      .from('journal_lines')
      .insert(lineRows as never)
      .select('*');

    if (error) {
      await this.client.from('journal_entries').delete().eq('id', createdEntry.id);
      throw toRepositoryError('journal_entries', error);
    }

    return { entry: createdEntry, lines: data ?? [] };
  }

  /**
   * Mark a draft journal entry as posted.
   *
   * FIX [#7 Accounting/IFRS logic — posting immutability]:
   * Schema states: "A posted entry is IMMUTABLE. To correct a posted entry,
   * create a new reversal entry." The previous version applied the status
   * update unconditionally — it would silently re-post an already-posted
   * or reversed entry.
   *
   * Fixed: reads the current status first and throws a `ValidationError`
   * if the entry is not in `draft` status.
   *
   * @param id - The journal entry id.
   * @param postedBy - The authenticated user's id.
   * @throws {ValidationError} If the entry is not in `draft` status.
   * @throws {NotFoundError} If no entry with the given id exists.
   */
  async post(id: string, postedBy: string): Promise<Row<'journal_entries'>> {
    const current = await this.findById(id);

    // FIX: guard against posting a non-draft entry
    if (current.status !== 'draft') {
      throw new ValidationError(
        'journal_entries',
        `Cannot post journal entry ${id}: current status is '${current.status}'. ` +
        `Only 'draft' entries may be posted. To correct a posted entry, create a reversal.`,
      );
    }

    return this.update(id, {
      status: 'posted',
      posted_by: postedBy,
      posted_at: new Date().toISOString(),
    });
  }

  /**
   * Create a reversal journal entry for a posted entry.
   *
   * Creates a new journal entry with all debit/credit sides swapped,
   * sets `reversal_of` on the new entry, and sets `reversed_by` on the
   * original — maintaining the immutability of the original posted entry.
   *
   * Schema: `reversal_of uuid FK journal_entries`, `reversed_by uuid FK journal_entries`.
   *
   * @param originalId - The id of the posted entry to reverse.
   * @param entryNumber - The entry number for the new reversal entry.
   * @param reversalDate - The date of the reversal (ISO `YYYY-MM-DD`).
   * @param postedBy - The authenticated user's id.
   */
  async reverse(
    originalId: string,
    entryNumber: string,
    reversalDate: string,
    postedBy: string,
    reason: string,
  ): Promise<JournalEntryWithLines> {
    if (!reason || !reason.trim()) {
      throw new ValidationError(
        'journal_entries',
        'A reason is required to reverse a journal entry.',
      );
    }

    const { entry: original, lines: originalLines } = await this.findByIdWithLines(originalId);

    if (original.status !== 'posted') {
      throw new ValidationError(
        'journal_entries',
        `Cannot reverse journal entry ${originalId}: status is '${original.status}'. ` +
        `Only 'posted' entries can be reversed.`,
      );
    }

    if (original.reversed_by) {
      throw new ValidationError(
        'journal_entries',
        `Journal entry ${originalId} has already been reversed by ${original.reversed_by}.`,
      );
    }

    // Reversals are final: an entry that is itself a reversal cannot be
    // reversed again.
    if (original.reversal_of) {
      throw new ValidationError(
        'journal_entries',
        `Journal entry ${originalId} is itself a reversal entry and cannot be reversed again.`,
      );
    }

    // FIX: derive the reversal's period from reversalDate, not the
    // original entry's period_id. Copying the original's period_id would
    // try to post the reversal into the same (possibly locked) period as
    // the mistake it's correcting — exactly the case a reversal exists
    // to handle. If no period covers reversalDate, period_id is left null.
    const reversalPeriodId = await this.findPeriodIdForDate(original.business_id, reversalDate);

    const reversalLines = originalLines.map((line, i) => ({
      line_number: i + 1,
      account_id: line.account_id,
      description: `Reversal of: ${line.description ?? original.description}`,
      is_debit: !line.is_debit,
      amount: line.amount,
      amount_base: line.amount_base,
      currency: line.currency,
      exchange_rate: line.exchange_rate,
      tax_code: line.tax_code,
      tax_amount: line.tax_amount,
      branch_id: line.branch_id,
      department_id: line.department_id,
      reconciled: false as const,
    }));

    const reversal = await this.createBalancedEntry(
      {
        business_id: original.business_id,
        entry_number: entryNumber,
        entry_date: reversalDate,
        description: `Reversal of ${original.entry_number}: ${original.description}`,
        source_type: 'reversal',
        source_id: original.source_id,
        currency: original.currency,
        exchange_rate: original.exchange_rate,
        status: 'draft',
        reversal_of: originalId,
        branch_id: original.branch_id,
        department_id: original.department_id,
        period_id: reversalPeriodId,
        created_by: postedBy,
      },
      reversalLines,
    );

    const postedReversal = await this.post(reversal.entry.id, postedBy);

    await this.update(originalId, { reversed_by: reversal.entry.id, status: 'reversed' });

    await this.writeAuditLog({
      business_id: original.business_id,
      user_id: postedBy,
      event_type: 'journal_entry_reversed',
      resource_type: 'journal_entries',
      resource_id: originalId,
      resource_ref: original.entry_number,
      old_values: { status: original.status },
      new_values: { reversed_by: reversal.entry.id, reversal_entry_number: entryNumber },
      notes: reason,
    });

    return { entry: postedReversal, lines: reversal.lines };
  }

  private async findPeriodIdForDate(businessId: string, date: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('accounting_periods')
      .select('*')
      .eq('business_id', businessId)
      .lte('period_start', date)
      .gte('period_end', date)
      .maybeSingle();
    if (error) throw toRepositoryError('journal_entries', error);
    return (data as Row<'accounting_periods'> | null)?.id ?? null;
  }

  private async writeAuditLog(entry: {
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
  }): Promise<void> {
    const { error } = await (this.client.rpc as any)('log_manual_audit_event', {
      p_business_id: entry.business_id,
      p_event_type: entry.event_type,
      p_resource_type: entry.resource_type,
      p_resource_id: entry.resource_id,
      p_resource_ref: entry.resource_ref ?? null,
      p_old_values: (entry.old_values ?? null),
      p_new_values: (entry.new_values ?? null),
      p_notes: entry.notes ?? null,
    });

    if (error) {
      console.error('Failed to write audit_log entry:', error);
    }
  }
}