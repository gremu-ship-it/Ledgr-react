import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, InvoiceStatus } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export interface InvoiceWithLines {
  invoice: Row<'invoices'>;
  lines: Row<'invoice_lines'>[];
}

export class InvoiceRepository extends BaseRepository<'invoices'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'invoices');
  }

  /**
   * FIX [#5 Missing business_id on invoice_lines]:
   * invoice_lines.business_id is NOT NULL. Added explicit filter.
   */
  async findByIdWithLines(id: string): Promise<InvoiceWithLines> {
    const invoice = await this.findById(id);
    const { data, error } = await this.client
      .from('invoice_lines').select('*')
      .eq('invoice_id', id)
      .eq('business_id', invoice.business_id)   // FIX: was missing
      .order('line_number', { ascending: true });
    if (error) throw toRepositoryError('invoices', error);
    return { invoice, lines: data ?? [] };
  }

  async findByBusiness(businessId: string, status?: InvoiceStatus): Promise<Row<'invoices'>[]> {
    let query = this.client
      .from('invoices').select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('issue_date', { ascending: false });
    if (error) throw toRepositoryError('invoices', error);
    return data ?? [];
  }

  async findByContact(businessId: string, contactId: string): Promise<Row<'invoices'>[]> {
    const { data, error } = await this.client
      .from('invoices').select('*')
      .eq('business_id', businessId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('issue_date', { ascending: false });
    if (error) throw toRepositoryError('invoices', error);
    return data ?? [];
  }

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
      .from('invoice_lines').insert(lineRows as never).select('*');
    if (error) {
      await this.client.from('invoices').delete().eq('id', createdInvoice.id);
      throw toRepositoryError('invoices', error);
    }
    return { invoice: createdInvoice, lines: data ?? [] };
  }

  /**
   * Record a payment against an invoice.
   *
   * FIX [#6 Concurrency — amount_paid read-then-write]:
   * Uses atomic RPC increment matching the pattern applied in ExpenseRepository.
   * Falls back to read-then-write with documented concurrency risk if RPC absent.
   * Status uses 'partially_paid' — the correct live enum value.
   */
  async recordPayment(
    payment: InsertDto<'invoice_payments'>,
  ): Promise<{ payment: Row<'invoice_payments'>; invoice: Row<'invoices'> }> {
    const { data: paymentData, error: paymentError } = await this.client
      .from('invoice_payments').insert(payment as never).select('*').single();
    if (paymentError) throw toRepositoryError('invoice_payments', paymentError);

    // Attempt atomic increment via RPC
    const { error: rpcError } = await (
      this.client as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
      }
    ).rpc('increment_amount_paid', {
      p_table:  'invoices',
      p_id:     payment.invoice_id,
      p_amount: payment.amount,
    });

    if (rpcError) {
      // Fallback: read-then-write (⚠️ concurrency risk — add RPC to eliminate)
      const invoice = await this.findById(payment.invoice_id);
      const newAmountPaid = Number(invoice.amount_paid) + Number(payment.amount);
      const newStatus: InvoiceStatus =
        newAmountPaid >= Number(invoice.total_amount) ? 'paid'
        : newAmountPaid > 0 ? 'partially_paid'
        : invoice.status;
      const updatedInvoice = await this.update(invoice.id, { amount_paid: newAmountPaid, status: newStatus });
      return { payment: paymentData, invoice: updatedInvoice };
    }

    // Re-fetch after atomic update; also recalculate status
    const invoice = await this.findById(payment.invoice_id);
    const newStatus: InvoiceStatus =
      Number(invoice.amount_paid) >= Number(invoice.total_amount) ? 'paid'
      : Number(invoice.amount_paid) > 0 ? 'partially_paid'
      : invoice.status;
    if (invoice.status !== newStatus) {
      const updated = await this.update(invoice.id, { status: newStatus });
      return { payment: paymentData, invoice: updated };
    }
    return { payment: paymentData, invoice };
  }

  /**
   * FIX [#5 Missing business_id on invoice_payments]:
   * Added businessId parameter; invoice_payments.business_id is NOT NULL.
   */
  async findPayments(businessId: string, invoiceId: string): Promise<Row<'invoice_payments'>[]> {
    const { data, error } = await this.client
      .from('invoice_payments').select('*')
      .eq('business_id', businessId)   // FIX: was missing
      .eq('invoice_id', invoiceId)
      .order('payment_date', { ascending: false });
    if (error) throw toRepositoryError('invoice_payments', error);
    return data ?? [];
  }

  async findArAgeing(businessId: string): Promise<Row<'v_ar_ageing'>[]> {
    const { data, error } = await this.client
      .from('v_ar_ageing').select('*').eq('business_id', businessId);
    if (error) throw toRepositoryError('v_ar_ageing', error);
    return data ?? [];
  }
}