import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import type { Json } from '../types/database.generated';
import { BaseRepository } from './BaseRepository';
import { NotFoundError, ValidationError, toRepositoryError } from '../errors/RepositoryError';
import { createLogger } from '@/lib/logger';
import { paymentStatusFromAmounts } from '@/lib/paymentStatus';

const log = createLogger('JournalRepository');

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
  async findByIdWithLines(id: string, businessId?: string): Promise<JournalEntryWithLines> {
    const entry = await this.findById(id);
    if (businessId && entry.business_id !== businessId) {
      throw new NotFoundError('journal_entries', id);
    }

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
        `Journal entry does not balance in functional currency: ` +
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
  async post(id: string, postedBy: string | null): Promise<Row<'journal_entries'>> {
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
   * FIX [Auto-void linked source on reversal]:
   * Reversing a journal entry only ever affected the ledger — the source
   * invoice/expense/payroll run kept whatever status it had (e.g. 'paid'),
   * so it kept counting in dashboard and report totals even though its
   * ledger effect had been fully reversed. Reversal in this app's model
   * means "this whole transaction was wrong," so the linked source record
   * is now automatically voided as part of the reversal. This is a
   * deliberate behavioural change: reversing either the recognition or
   * the settlement half of an invoice/expense now voids the whole source
   * record, not just the reversed entry.
   *
   * Both IncomeRepository.getTotals() and useMonthlyExpenses/
   * useMonthlyExpenseVat already exclude status = 'void', so voiding the
   * source record alone is sufficient to correct dashboard and report
   * totals — no changes needed in those files.
   *
   * @param originalId - The id of the posted entry to reverse.
   * @param entryNumber - The entry number for the new reversal entry.
   * @param reversalDate - The date of the reversal (ISO `YYYY-MM-DD`).
   * @param postedBy - The authenticated user's id.
   * @param reason - Required explanation, written to the audit log.
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
      original_currency: line.original_currency,
      original_amount: line.original_amount,
      rate_date: line.rate_date,
      rate_is_stale: line.rate_is_stale,
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

    // Check if reversing an invoice payment
    const { data: invPayment } = await this.client
      .from('invoice_payments')
      .select('*')
      .eq('journal_entry_id', originalId)
      .maybeSingle();

    if (invPayment) {
      await this.backOutPayment({
        table: 'invoices',
        parentId: invPayment.invoice_id,
        paymentId: invPayment.id,
        amount: Number(invPayment.amount),
        nextStatus: (totalAmount, amountPaid) => paymentStatusFromAmounts(totalAmount, amountPaid),
      });
    }

    // Check if reversing an expense payment
    const { data: expPayment } = await this.client
      .from('expense_payments')
      .select('*')
      .eq('journal_entry_id', originalId)
      .maybeSingle();

    if (expPayment) {
      await this.backOutPayment({
        table: 'expenses',
        parentId: expPayment.expense_id,
        paymentId: expPayment.id,
        amount: Number(expPayment.amount),
        // An expense that loses its payment returns to the approved-but-
        // unpaid state (expense status model is draft → approved → paid).
        nextStatus: () => 'approved',
      });
    }

    // FIX: Auto-void the source record when its journal entry is reversed.
    // A reversal means "this whole transaction was wrong" — so the linked
    // invoice/expense/payroll run must be voided too, otherwise it keeps
    // counting in dashboard/report totals even though its ledger effect
    // has been fully reversed.
    if (!invPayment && !expPayment && original.source_id && original.source_type && original.source_type !== 'reversal') {
      await this.voidSourceRecord(original.source_type, original.source_id, postedBy, reason);
    }

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

  /**
   * Back out a single recorded payment during journal reversal.
   *
   * FIX [payment reversal regression — C-02]:
   * The previous inline version called `increment_amount_paid` with a NEGATIVE
   * amount while the RPC rejected `p_amount <= 0`, and it discarded the RPC
   * error object — so the decrement silently failed and the invoice was left
   * with `amount_paid` still at the paid total while `status` was recomputed
   * to partially_paid/sent. Now:
   *   1. The RPC accepts a negative back-out (20260813000001) and the error is
   *      captured and thrown, so a failed back-out cannot look successful.
   *   2. Status is recomputed from the post-back-out `amount_paid` (single
   *      source of truth via `paymentStatusFromAmounts`), not from a stale
   *      pre-decrement estimate.
   *
   * The decrement, status update and payment-row removal are still three
   * separate round-trips (the repository has no transaction wrapper). A
   * failure between them leaves a recoverable but incomplete state; the thrown
   * error surfaces it rather than hiding it.
   */
  private async backOutPayment(params: {
    table: 'invoices' | 'expenses';
    parentId: string;
    paymentId: string;
    amount: number;
    nextStatus: (totalAmount: number, amountPaid: number) => string;
  }): Promise<void> {
    const { error: rpcError } = await this.client.rpc('increment_amount_paid', {
      p_table: params.table,
      p_id: params.parentId,
      p_amount: -params.amount,
    });
    if (rpcError) throw toRepositoryError(params.table, rpcError);

    const { data, error: fetchError } = await this.client
      .from(params.table)
      .select('*')
      .eq('id', params.parentId)
      .single();
    if (fetchError) throw toRepositoryError(params.table, fetchError);

    if (data) {
      const row = data as unknown as { total_amount: number; amount_paid: number };
      const status = params.nextStatus(Number(row.total_amount), Number(row.amount_paid));
      const { error: updateError } = await this.client
        .from(params.table)
        .update({ status } as never)
        .eq('id', params.parentId);
      if (updateError) throw toRepositoryError(params.table, updateError);
    }

    const paymentsTable = params.table === 'invoices' ? 'invoice_payments' : 'expense_payments';
    const { error: deleteError } = await this.client
      .from(paymentsTable)
      .delete()
      .eq('id', params.paymentId);
    if (deleteError) throw toRepositoryError(paymentsTable, deleteError);
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

  /**
   * Auto-void the source invoice/expense/payroll run linked to a journal
   * entry that has just been reversed. No-op for unrecognised source
   * types (e.g. an entry with no source_type/source_id, or one from a
   * flow not covered here) and for source records that are already void.
   *
   * Failures here are logged but never thrown — a failed auto-void must
   * not roll back or block the reversal itself, which has already been
   * committed to the ledger.
   */
  /**
   * Assigns a branch / department (cost or revenue centre) to an entry, all of
   * its lines, and the linked source document if there is one.
   *
   * Lives here rather than in the modal so the writes are tenant-scoped and
   * type-checked: the previous inline version reached through
   * `(repos as any).account.client` to defeat BaseRepository's `protected`
   * client, and updated journal_lines by id alone with no business_id filter.
   */
  async assignCostCentre(
    entryId: string,
    branchId: string | null,
    departmentId: string | null,
  ): Promise<void> {
    const entry = await this.findById(entryId);
    const assignment = { branch_id: branchId, department_id: departmentId };

    const { error: entryError } = await this.client
      .from('journal_entries')
      .update(assignment as never)
      .eq('id', entryId)
      .eq('business_id', entry.business_id);
    if (entryError) throw toRepositoryError('journal_entries', entryError);

    // Single statement for every line, rather than a request per line.
    const { error: linesError } = await this.client
      .from('journal_lines')
      .update(assignment as never)
      .eq('journal_entry_id', entryId)
      .eq('business_id', entry.business_id);
    if (linesError) throw toRepositoryError('journal_lines', linesError);

    if (!entry.source_id || !entry.source_type) return;

    const tableMap: Record<string, 'invoices' | 'expenses' | 'payroll_runs'> = {
      invoice: 'invoices',
      expense: 'expenses',
      payroll: 'payroll_runs',
    };
    const table = tableMap[entry.source_type];
    if (!table) return; // unrecognised source_type — nothing to propagate to

    const { error: sourceError } = await this.client
      .from(table)
      .update(assignment as never)
      .eq('id', entry.source_id)
      .eq('business_id', entry.business_id);
    if (sourceError) throw toRepositoryError(table, sourceError);
  }

  private async voidSourceRecord(
    sourceType: string,
    sourceId: string,
    postedBy: string,
    reason: string,
  ): Promise<void> {
    const tableMap: Record<string, 'invoices' | 'expenses' | 'payroll_runs'> = {
      invoice: 'invoices',
      expense: 'expenses',
      payroll: 'payroll_runs',
    };
    const table = tableMap[sourceType];
    if (!table) return; // unrecognised source_type — nothing to void

    const { data: current, error: fetchError } = await this.client
      .from(table)
      .select('id, status, business_id')
      .eq('id', sourceId)
      .maybeSingle();

    if (fetchError) {
      log.error(`Failed to fetch ${table} ${sourceId} for auto-void`, fetchError as Error);
      return;
    }
    if (!current) return;

    const row = current as { id: string; status: string; business_id: string };
    if (row.status === 'void') return; // already void — nothing to do

    const { error: updateError } = await this.client
      .from(table)
      .update({ status: 'void' } as never)
      .eq('id', sourceId);

    if (updateError) {
      log.error(`Failed to auto-void ${table} ${sourceId}`, updateError as Error);
      return;
    }

    await this.writeAuditLog({
      business_id: row.business_id,
      user_id: postedBy,
      event_type: `${sourceType}_auto_voided`,
      resource_type: table,
      resource_id: sourceId,
      old_values: { status: row.status },
      new_values: { status: 'void' },
      notes: `Auto-voided: linked journal entry was reversed. Reason: ${reason}`,
    });
  }

  private async writeAuditLog(entry: {
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
  }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated `rpc` signature doesn't include 'log_manual_audit_event' (the function exists in the DB but isn't surfaced by supabase gen types); verified against the live DB
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
      log.error('Failed to write audit_log entry', error as Error);
    }
  }
}