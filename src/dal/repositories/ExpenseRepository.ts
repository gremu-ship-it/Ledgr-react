import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError, ValidationError } from '../errors/RepositoryError';

export interface ExpenseWithLines {
  expense: Row<'expenses'>;
  lines: Row<'expense_lines'>[];
}

export interface ExpenseListPage {
  rows: Row<'expenses'>[];
  /** Opaque cursor the caller passes back to fetch the next page. null when no more pages. */
  nextCursor: { date: string; id: string } | null;
}

export class ExpenseRepository extends BaseRepository<'expenses'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'expenses');
  }

  // Column-trimmed projection shared between the "first 500 recent" loader
  // and the paginated list loader. Keeping the select in one place avoids
  // drift (one path accidentally pulling select('*') and defeating the
  // payload-size win).
  private static readonly LIST_SELECT =
    'id, expense_number, expense_type, status, expense_date, currency, ' +
    'total_amount, amount_paid, reference, notes, branch_id, department_id, ' +
    'journal_entry_id, created_at';

  /**
   * Keyset (cursor-based) pagination for the expense list.
   *
   * WHY keyset and not OFFSET/LIMIT: with offset pagination Postgres still
   * has to walk past all skipped rows inside the index — acceptable at
   * page 2, terrible at page 20 on a 50k-row table. Keyset pagination
   * issues a simple `(date, id) < (cursor_date, cursor_id)` range scan on
   * the `idx_ledgr_expenses_live_recent` partial index, which is O(page)
   * regardless of how deep into the history the user scrolls.
   *
   * Cursor is (expense_date, id) rather than date alone because dates are
   * not unique — adding id as a tiebreaker keeps the ordering stable when
   * multiple expenses share a date, and prevents rows from being skipped
   * or duplicated across page boundaries.
   *
   * @param businessId  tenant
   * @param options.status    optional status filter (still applied server-side)
   * @param options.cursor    cursor from the previous page; undefined = first page
   * @param options.pageSize  rows per page (default 50, hard-capped at 200)
   */
  async listPage(
    businessId: string,
    options: {
      status?: string;
      cursor?: { date: string; id: string } | null;
      pageSize?: number;
    } = {},
  ): Promise<ExpenseListPage> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 50, 200));
    // Fetch pageSize+1 so we can tell whether another page exists without
    // a separate COUNT(*) query (counts on large tables are expensive).
    const fetchSize = pageSize + 1;

    let query = this.client
      .from('expenses')
      .select(ExpenseRepository.LIST_SELECT)
      .eq('business_id', businessId)
      .is('deleted_at', null);

    if (options.status) query = query.eq('status', options.status);

    if (options.cursor) {
      // Seek past the cursor: strictly earlier (date, id) tuple.
      // Postgres supports row-value comparisons which map perfectly to
      // the (business_id, expense_date desc, id desc) index ordering.
      query = query.or(
        `expense_date.lt.${options.cursor.date},` +
        `and(expense_date.eq.${options.cursor.date},id.lt.${options.cursor.id})`,
      );
    }

    const { data, error } = await query
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchSize);

    if (error) throw toRepositoryError('expenses', error);

    const all = (data ?? []) as unknown as Row<'expenses'>[];
    const hasMore = all.length > pageSize;
    const rows = hasMore ? all.slice(0, pageSize) : all;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last
      ? { date: last.expense_date, id: last.id }
      : null;

    return { rows, nextCursor };
  }

  /**
   * Fetch recent expenses for a business (drop-downs, sidebar widgets,
   * contact-page totals). Returns up to `limit` rows, newest first,
   * column-trimmed. For the main list view use listPage() instead.
   */
  async findByBusiness(businessId: string, status?: string, limit?: number): Promise<Row<'expenses'>[]> {
    const LATEST_LIMIT = 500;
    const cap = Math.max(1, Math.min(limit ?? LATEST_LIMIT, 2000));
    let query = this.client
      .from('expenses')
      .select(ExpenseRepository.LIST_SELECT)
      .eq('business_id', businessId)
      .is('deleted_at', null);

    if (status) query = query.eq('status', status);

    const { data, error } = await query
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(cap);
    if (error) throw toRepositoryError('expenses', error);
    return (data ?? []) as unknown as Row<'expenses'>[];
  }

  /**
   * Fetch expenses for a business within a date range.
   */
  async findByDateRange(
    businessId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Row<'expenses'>[]> {
    const { data, error } = await this.client
      .from('expenses')
      .select('*')
      .eq('business_id', businessId)
      .gte('expense_date', fromDate)
      .lte('expense_date', toDate)
      .is('deleted_at', null)
      .order('expense_date', { ascending: false });

    if (error) throw toRepositoryError('expenses', error);
    return data ?? [];
  }

  /**
   * Create an expense together with its line items in one operation.
   * Rolls back the header if line insertion fails.
   */
  async createWithLines(
    expense: InsertDto<'expenses'>,
    lines: Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>[],
    clientKey?: string,
  ): Promise<ExpenseWithLines> {
    // Idempotency for offline sync retries: return the existing expense if
    // this client_key was already committed, rather than duplicating it.
    if (clientKey) {
      const existing = await this.findByClientKey(expense.business_id, clientKey);
      if (existing) {
        const { data: existingLines } = await this.client
          .from('expense_lines')
          .select('*')
          .eq('expense_id', existing.id)
          .eq('business_id', existing.business_id)
          .order('line_number', { ascending: true });
        return { expense: existing, lines: existingLines ?? [] };
      }
    }

    const header: InsertDto<'expenses'> = clientKey
      ? ({ ...expense, client_key: clientKey } as InsertDto<'expenses'>)
      : expense;

    const createdExpense = await this.create(header);

    const lineRows: InsertDto<'expense_lines'>[] = lines.map((line) => ({
      ...line,
      expense_id: createdExpense.id,
      business_id: createdExpense.business_id,
    }));

    const { data, error } = await this.client
      .from('expense_lines')
      .insert(lineRows as never)
      .select('*');

    if (error) {
      await this.client.from('expenses').delete().eq('id', createdExpense.id);
      throw toRepositoryError('expenses', error);
    }

    return { expense: createdExpense, lines: data ?? [] };
  }

  /**
   * Record a payment against an expense and update `amount_paid`.
   *
   * FIX [#6 Concurrency risk]:
   * The previous pattern read `amount_paid`, added the new payment in
   * TypeScript, then wrote back. Two concurrent payments would both read
   * the same stale `amount_paid` and one update would be lost.
   *
   * Fixed using a raw SQL increment via Supabase's `.rpc()` pattern:
   * UPDATE expenses SET amount_paid = amount_paid + $payment WHERE id = $id
   * This is atomic at the DB level and avoids the race condition.
   *
   * Note: if your Supabase project does not have the `increment_expense_paid`
   * RPC, fall back to the commented read-then-write below and add the RPC
   * as soon as possible.
   */
  async recordPayment(
    payment: InsertDto<'expense_payments'>,
    clientKey?: string,
  ): Promise<{ payment: Row<'expense_payments'>; expense: Row<'expenses'> }> {
    // Idempotency: a retried offline sync must not insert a duplicate payment
    // and re-increment amount_paid.
    if (clientKey) {
      const existing = await this.findPaymentByClientKey(payment.business_id, clientKey);
      if (existing) {
        const expense = await this.findById(payment.expense_id);
        return { payment: existing, expense };
      }
    }

    // FIX [C-03 void/credit-note payment control]: enforce at the repository
    // layer. The DB trigger (20260813000002) is the backstop; this check gives
    // a clear error before the insert round-trip.
    const expense = await this.findById(payment.expense_id);
    if (expense.status === 'void') {
      throw new ValidationError(
        'expense_payments',
        `Cannot record a payment against a void expense (${payment.expense_id}).`,
      );
    }

    const paymentRow: InsertDto<'expense_payments'> = clientKey
      ? ({ ...payment, client_key: clientKey } as InsertDto<'expense_payments'>)
      : payment;

    const { data: paymentData, error: paymentError } = await this.client
      .from('expense_payments')
      .insert(paymentRow as never)
      .select('*')
      .single();

    if (paymentError) throw toRepositoryError('expense_payments', paymentError);

    // Atomic increment — avoids the read-then-write race condition.
    // SQL equivalent: UPDATE expenses SET amount_paid = amount_paid + payment.amount WHERE id = ...
    const { error: updateError } = await this.client.rpc('increment_amount_paid', {
      p_table:  'expenses',
      p_id:     payment.expense_id,
      p_amount: payment.amount,
    });

    if (updateError) throw toRepositoryError('expenses', updateError);

    const updatedExpense = await this.findById(payment.expense_id);
    return { payment: paymentData, expense: updatedExpense };
  }

  /**
   * Idempotency lookup: find an expense previously created under a client_key.
   *
   * Public because the plan-limit guard asks whether a retried save is a replay
   * of a document that already committed before it refuses the save (see
   * `UsageService.assertCanCreateDocument`).
   */
  async findByClientKey(businessId: string, clientKey: string): Promise<Row<'expenses'> | null> {
    const { data, error } = await this.client
      .from('expenses')
      .select('*')
      .eq('business_id', businessId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_key added by migration 20260813000003, not yet in generated types
      .eq('client_key' as any, clientKey)
      .maybeSingle();
    if (error) throw toRepositoryError('expenses', error);
    return (data as Row<'expenses'> | null) ?? null;
  }

  /** Idempotency lookup: find a payment previously recorded under a client_key. */
  private async findPaymentByClientKey(businessId: string, clientKey: string): Promise<Row<'expense_payments'> | null> {
    const { data, error } = await this.client
      .from('expense_payments')
      .select('*')
      .eq('business_id', businessId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_key added by migration 20260813000003, not yet in generated types
      .eq('client_key' as any, clientKey)
      .maybeSingle();
    if (error) throw toRepositoryError('expense_payments', error);
    return (data as Row<'expense_payments'> | null) ?? null;
  }

  /**
   * Fetch all payments recorded against an expense.
   *
   * FIX [#5 Missing business_id tenant filtering]:
   * Previous version queried by `expense_id` alone. `expense_payments.business_id`
   * is NOT NULL in the schema. Added `businessId` parameter.
   */
  async findPayments(businessId: string, expenseId: string): Promise<Row<'expense_payments'>[]> {
    const { data, error } = await this.client
      .from('expense_payments')
      .select('*')
      .eq('business_id', businessId) // FIX: tenant-scope
      .eq('expense_id', expenseId)
      .order('payment_date', { ascending: false });

    if (error) throw toRepositoryError('expense_payments', error);
    return data ?? [];
  }
}