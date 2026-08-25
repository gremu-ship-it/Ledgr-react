import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError, ValidationError } from '../errors/RepositoryError';

export interface ExpenseWithLines {
  expense: Row<'expenses'>;
  lines: Row<'expense_lines'>[];
}

export class ExpenseRepository extends BaseRepository<'expenses'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'expenses');
  }

  /**
   * Fetch an expense along with its line items.
   *
   * FIX [#5 Missing business_id tenant filtering]:
   * Previous version queried `expense_lines` by `expense_id` only, with no
   * `business_id` filter. `expense_lines.business_id` is NOT NULL in the
   * schema. Added explicit business_id filter using the parent expense's
   * business_id (already fetched above).
   */
  async findByIdWithLines(id: string): Promise<ExpenseWithLines> {
    const expense = await this.findById(id);

    const { data, error } = await this.client
      .from('expense_lines')
      .select('*')
      .eq('expense_id', id)
      .eq('business_id', expense.business_id) // FIX: tenant-scope the lines query
      .order('line_number', { ascending: true });

    if (error) throw toRepositoryError('expenses', error);
    return { expense, lines: data ?? [] };
  }

  /**
   * Fetch all non-deleted expenses for a business, optionally filtered by status.
   * Valid status values: 'draft' | 'approved' | 'paid' | 'void'
   */
  async findByBusiness(businessId: string, status?: string): Promise<Row<'expenses'>[]> {
    let query = this.client
      .from('expenses')
      .select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null);

    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('expense_date', { ascending: false });
    if (error) throw toRepositoryError('expenses', error);
    return data ?? [];
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
    const expense = await this.findById(payment.expense_id);
    if (expense.business_id !== payment.business_id) {
      throw new ValidationError(
        'expense_payments',
        'Expense payment business does not match the parent expense.',
      );
    }

    // Idempotency: a retried offline sync must not insert a duplicate payment
    // and re-increment amount_paid.
    if (clientKey) {
      const existing = await this.findPaymentByClientKey(payment.business_id, clientKey);
      if (existing) return { payment: existing, expense };
    }

    // FIX [C-03 void/credit-note payment control]: enforce at the repository
    // layer. The DB trigger (20260813000002) is the backstop; this check gives
    // a clear error before the insert round-trip.
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

  /** Idempotency lookup: find an expense previously created under a client_key. */
  private async findByClientKey(businessId: string, clientKey: string): Promise<Row<'expenses'> | null> {
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