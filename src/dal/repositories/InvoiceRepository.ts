import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { NotFoundError, toRepositoryError, ValidationError } from '../errors/RepositoryError';
import { triggerWebhook } from '@/services/webhook/webhook-triggers';
import { paymentStatusFromAmounts } from '@/lib/paymentStatus';

export interface InvoiceWithLines {
  invoice: Row<'invoices'>;
  lines: Row<'invoice_lines'>[];
}

type InvoiceStatus = Row<'invoices'>['status'];

export class InvoiceRepository extends BaseRepository<'invoices'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'invoices');
  }

  /**
   * Fetch an invoice with its line items. Lines are tenant-scoped with the
   * parent invoice's business_id to avoid cross-tenant reads.
   */
  async findByIdWithLines(id: string, businessId?: string): Promise<InvoiceWithLines> {
    const invoice = await this.findById(id);
    if (businessId && invoice.business_id !== businessId) {
      throw new NotFoundError('invoices', id);
    }

    const { data, error } = await this.client
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', id)
      .eq('business_id', invoice.business_id)
      .order('line_number', { ascending: true });

    if (error) throw toRepositoryError('invoice_lines', error);
    return { invoice, lines: data ?? [] };
  }

  /**
   * Fetch all non-deleted invoices for a business, optionally filtered by
   * invoice status.
   */
  async findByBusiness(businessId: string, status?: InvoiceStatus): Promise<Row<'invoices'>[]> {
    let query = this.client
      .from('invoices')
      .select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null);

    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('issue_date', { ascending: false });
    if (error) throw toRepositoryError('invoices', error);
    return data ?? [];
  }

  /**
   * Create an invoice and its lines in one repository call. If line insertion
   * fails, the invoice header is removed to avoid an orphaned invoice.
   *
   * Emits the public-api webhook event `invoice.created` after the invoice and
   * lines are persisted successfully.
   */
  async createWithLines(
    invoice: InsertDto<'invoices'>,
    lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[],
    clientKey?: string,
  ): Promise<InvoiceWithLines> {
    // Idempotency for offline sync retries: if this client_key was already
    // committed on a prior attempt, return the existing invoice instead of
    // inserting a duplicate. Backed by a unique (business_id, client_key)
    // index (20260813000003).
    if (clientKey) {
      const existing = await this.findByClientKey(invoice.business_id, clientKey);
      if (existing) {
        const { data: existingLines } = await this.client
          .from('invoice_lines')
          .select('*')
          .eq('invoice_id', existing.id)
          .eq('business_id', existing.business_id)
          .order('line_number', { ascending: true });
        return { invoice: existing, lines: existingLines ?? [] };
      }
    }

    const header: InsertDto<'invoices'> = clientKey
      ? ({ ...invoice, client_key: clientKey } as InsertDto<'invoices'>)
      : invoice;

    const createdInvoice = await this.create(header);

    const lineRows: InsertDto<'invoice_lines'>[] = lines.map((line) => ({
      ...line,
      invoice_id: createdInvoice.id,
      business_id: createdInvoice.business_id,
    }));

    const { data, error } = await this.client
      .from('invoice_lines')
      .insert(lineRows as never)
      .select('*');

    if (error) {
      await this.client.from('invoices').delete().eq('id', createdInvoice.id);
      throw toRepositoryError('invoice_lines', error);
    }

    const result = { invoice: createdInvoice, lines: data ?? [] };
    await triggerWebhook(createdInvoice.business_id, 'invoice.created', result);
    return result;
  }

  /**
   * Record a payment against an invoice, update amount_paid/status, and emit
   * `invoice.paid` when the invoice becomes fully paid.
   */
  async recordPayment(
    payment: InsertDto<'invoice_payments'>,
    clientKey?: string,
  ): Promise<{ payment: Row<'invoice_payments'>; invoice: Row<'invoices'> }> {
    // Idempotency: a retried offline sync must not insert a duplicate payment
    // and re-increment amount_paid.
    if (clientKey) {
      const existing = await this.findPaymentByClientKey(payment.business_id, clientKey);
      if (existing) {
        const invoice = await this.findById(payment.invoice_id);
        return { payment: existing, invoice };
      }
    }

    // FIX [C-03 void/credit-note payment control]: enforce at the repository
    // layer (not just the UI). The DB trigger (20260813000002) is the backstop;
    // this check gives a clear error before the insert round-trip.
    const invoice = await this.findById(payment.invoice_id);
    if (invoice.status === 'void' || invoice.status === 'credit_note') {
      throw new ValidationError(
        'invoice_payments',
        `Cannot record a payment against a ${invoice.status} invoice (${payment.invoice_id}).`,
      );
    }

    const paymentRow: InsertDto<'invoice_payments'> = clientKey
      ? ({ ...payment, client_key: clientKey } as InsertDto<'invoice_payments'>)
      : payment;

    const { data: paymentData, error: paymentError } = await this.client
      .from('invoice_payments')
      .insert(paymentRow as never)
      .select('*')
      .single();

    if (paymentError) throw toRepositoryError('invoice_payments', paymentError);

    // Atomic increment — avoids the read-then-write race condition.
    const { error: incrementError } = await this.client.rpc('increment_amount_paid', {
      p_table: 'invoices',
      p_id: payment.invoice_id,
      p_amount: payment.amount,
    });

    if (incrementError) throw toRepositoryError('invoices', incrementError);

    let updatedInvoice = await this.findById(payment.invoice_id);

    const nextStatus = paymentStatusFromAmounts(
      Number(updatedInvoice.total_amount),
      Number(updatedInvoice.amount_paid),
    );

    if (updatedInvoice.status !== nextStatus && updatedInvoice.status !== 'void' && updatedInvoice.status !== 'credit_note') {
      updatedInvoice = await this.update(updatedInvoice.id, { status: nextStatus });
    }

    if (updatedInvoice.status === 'paid') {
      await triggerWebhook(updatedInvoice.business_id, 'invoice.paid', updatedInvoice);
    }

    return { payment: paymentData, invoice: updatedInvoice };
  }

  /** Idempotency lookup: find an invoice previously created under a client_key. */
  private async findByClientKey(businessId: string, clientKey: string): Promise<Row<'invoices'> | null> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('business_id', businessId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_key added by migration 20260813000003, not yet in generated types
      .eq('client_key' as any, clientKey)
      .maybeSingle();
    if (error) throw toRepositoryError('invoices', error);
    return (data as Row<'invoices'> | null) ?? null;
  }

  /** Idempotency lookup: find a payment previously recorded under a client_key. */
  private async findPaymentByClientKey(businessId: string, clientKey: string): Promise<Row<'invoice_payments'> | null> {
    const { data, error } = await this.client
      .from('invoice_payments')
      .select('*')
      .eq('business_id', businessId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_key added by migration 20260813000003, not yet in generated types
      .eq('client_key' as any, clientKey)
      .maybeSingle();
    if (error) throw toRepositoryError('invoice_payments', error);
    return (data as Row<'invoice_payments'> | null) ?? null;
  }

  /** Fetch all payments recorded against an invoice. */
  async findPayments(businessId: string, invoiceId: string): Promise<Row<'invoice_payments'>[]> {
    const { data, error } = await this.client
      .from('invoice_payments')
      .select('*')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('payment_date', { ascending: false });

    if (error) throw toRepositoryError('invoice_payments', error);
    return data ?? [];
  }
}
