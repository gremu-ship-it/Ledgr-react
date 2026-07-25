import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';
import { triggerWebhook } from '@/services/webhook/webhook-triggers';

export interface InvoiceWithLines {
  invoice: Row<'invoices'>;
  lines: Row<'invoice_lines'>[];
}

type InvoiceStatus = Row<'invoices'>['status'];

function getPaymentStatus(totalAmount: number, amountPaid: number): InvoiceStatus {
  if (amountPaid <= 0) return 'sent';
  return amountPaid >= totalAmount ? 'paid' : 'partially_paid';
}

export class InvoiceRepository extends BaseRepository<'invoices'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'invoices');
  }

  /**
   * Fetch an invoice with its line items. Lines are tenant-scoped with the
   * parent invoice's business_id to avoid cross-tenant reads.
   */
  async findByIdWithLines(id: string): Promise<InvoiceWithLines> {
    const invoice = await this.findById(id);

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
  ): Promise<InvoiceWithLines> {
    const createdInvoice = await this.create(invoice);

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
  ): Promise<{ payment: Row<'invoice_payments'>; invoice: Row<'invoices'> }> {
    const { data: paymentData, error: paymentError } = await this.client
      .from('invoice_payments')
      .insert(payment as never)
      .select('*')
      .single();

    if (paymentError) throw toRepositoryError('invoice_payments', paymentError);

    let updatedInvoice: Row<'invoices'>;

    // Prefer the shared atomic increment RPC used elsewhere in the repository
    // layer. If it is not deployed yet, fall back to the older read/update flow
    // so local/dev environments still work.
    const { error: incrementError } = await (
      this.client as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: any }>;
      }
    ).rpc('increment_amount_paid', {
      p_table: 'invoices',
      p_id: payment.invoice_id,
      p_amount: payment.amount,
    });

    if (incrementError) {
      const invoice = await this.findById(payment.invoice_id);
      updatedInvoice = await this.update(invoice.id, {
        amount_paid: Number(invoice.amount_paid) + Number(payment.amount),
      });
    } else {
      updatedInvoice = await this.findById(payment.invoice_id);
    }

    const nextStatus = getPaymentStatus(
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
