import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';
import { triggerWebhook } from '@/services/webhook/webhook-triggers';

export interface InvoiceWithLines {
  invoice: Row<'invoices'>;
  lines: Row<'invoice_lines'>[];
}

export interface InvoiceListPage {
  rows: Row<'invoices'>[];
  nextCursor: { date: string; id: string } | null;
}

type InvoiceStatus = Row<'invoices'>['status'];

export class InvoiceRepository extends BaseRepository<'invoices'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'invoices');
  }

  private static readonly LIST_SELECT =
    'id, invoice_number, invoice_type, status, issue_date, due_date, currency, ' +
    'total_amount, amount_paid, amount_due, contact_id, notes, po_number, ar_account_id, ' +
    'branch_id, department_id, created_at';

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
   * Keyset (cursor-based) pagination for the invoice list. See
   * ExpenseRepository.listPage for the full rationale and cursor rules.
   */
  async listPage(
    businessId: string,
    options: {
      status?: InvoiceStatus;
      cursor?: { date: string; id: string } | null;
      pageSize?: number;
    } = {},
  ): Promise<InvoiceListPage> {
    const pageSize = Math.max(1, Math.min(options.pageSize ?? 50, 200));
    const fetchSize = pageSize + 1;

    let query = this.client
      .from('invoices')
      .select(InvoiceRepository.LIST_SELECT)
      .eq('business_id', businessId)
      .is('deleted_at', null);

    if (options.status) query = query.eq('status', options.status);

    if (options.cursor) {
      query = query.or(
        `issue_date.lt.${options.cursor.date},` +
        `and(issue_date.eq.${options.cursor.date},id.lt.${options.cursor.id})`,
      );
    }

    const { data, error } = await query
      .order('issue_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchSize);

    if (error) throw toRepositoryError('invoices', error);

    const all = (data ?? []) as unknown as Row<'invoices'>[];
    const hasMore = all.length > pageSize;
    const rows = hasMore ? all.slice(0, pageSize) : all;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last
      ? { date: last.issue_date, id: last.id }
      : null;

    return { rows, nextCursor };
  }

  /**
   * Fetch recent invoices for a business (drop-downs, widgets, contact-page
   * totals). For the main list view use listPage() instead.
   */
  async findByBusiness(businessId: string, status?: InvoiceStatus, limit?: number): Promise<Row<'invoices'>[]> {
    const LATEST_LIMIT = 500;
    const cap = Math.max(1, Math.min(limit ?? LATEST_LIMIT, 2000));
    let query = this.client
      .from('invoices')
      .select(InvoiceRepository.LIST_SELECT)
      .eq('business_id', businessId)
      .is('deleted_at', null);

    if (status) query = query.eq('status', status);

    const { data, error } = await query
      .order('issue_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(cap);
    if (error) throw toRepositoryError('invoices', error);
    return (data ?? []) as unknown as Row<'invoices'>[];
  }

  /**
   * Create an invoice and its lines ATOMICALLY (IC 2026-09-25 P7).
   *
   * One call to `create_invoice_with_lines` (SECURITY INVOKER — the caller's
   * own RLS applies to every insert). Header, lines and — when the payload
   * carries no real number — the invoice-number reservation commit or roll
   * back together, so a failed line insert can no longer leave an orphan
   * header (the old compensating DELETE was blocked by admin-only delete RLS).
   * A replay under the same `clientKey` returns the committed invoice.
   *
   * Emits the public-api webhook event `invoice.created` only when this call
   * created the invoice (not on replay).
   */
  async createWithLines(
    invoice: InsertDto<'invoices'>,
    lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[],
    clientKey?: string,
  ): Promise<InvoiceWithLines> {
    const { data, error } = await (this.client as unknown as {
      rpc: (fn: 'create_invoice_with_lines', args: {
        p_invoice: InsertDto<'invoices'>;
        p_lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[];
        p_client_key: string | null;
      }) => Promise<{ data: { invoice: Row<'invoices'>; lines: Row<'invoice_lines'>[]; idempotent: boolean } | null; error: { code?: string; message?: string } | null }>;
    }).rpc('create_invoice_with_lines', {
      p_invoice: invoice,
      p_lines: lines,
      p_client_key: clientKey ?? null,
    });

    if (error) throw toRepositoryError('invoices', error);
    if (!data?.invoice) {
      throw toRepositoryError('invoices', { message: 'Invoice creation returned no result; nothing was confirmed as saved.' });
    }

    const result = { invoice: data.invoice, lines: data.lines ?? [] };
    if (!data.idempotent) await triggerWebhook(result.invoice.business_id, 'invoice.created', result);
    return result;
  }

  /**
   * Record a payment against an invoice ATOMICALLY (IC 2026-09-25 P6).
   *
   * One call to `record_invoice_payment`: authorisation, invoice lock,
   * validation (amount > 0, not void/credit_note, no overpayment), payment
   * insert, amount_paid, status and the keyed settlement journal commit or
   * roll back together. A retry with the same key returns the committed
   * payment (idempotent) instead of re-recording or silently skipping the
   * amount_paid update. Callers without an offline key get a fresh one per
   * call; UI flows should pass a key that is stable across double-submits.
   */
  async recordPayment(
    payment: InsertDto<'invoice_payments'>,
    clientKey?: string,
  ): Promise<{ payment: Row<'invoice_payments'>; invoice: Row<'invoices'>; journalEntryId?: string | null; idempotent?: boolean }> {
    const key = clientKey ?? crypto.randomUUID();
    const { data, error } = await (this.client as unknown as {
      rpc: (fn: 'record_invoice_payment', args: { p_payment: InsertDto<'invoice_payments'>; p_client_key: string }) =>
        Promise<{ data: { payment: Row<'invoice_payments'>; invoice: Row<'invoices'>; journal_entry_id: string | null; idempotent: boolean } | null; error: { code?: string; message?: string } | null }>;
    }).rpc('record_invoice_payment', { p_payment: payment, p_client_key: key });

    if (error) throw toRepositoryError('invoice_payments', error);
    if (!data?.payment || !data.invoice) {
      throw toRepositoryError('invoice_payments', { message: 'Payment command returned no result; the payment was not confirmed.' });
    }

    if (!data.idempotent && data.invoice.status === 'paid') {
      await triggerWebhook(data.invoice.business_id, 'invoice.paid', data.invoice);
    }

    return { payment: data.payment, invoice: data.invoice, journalEntryId: data.journal_entry_id, idempotent: data.idempotent };
  }

  /**
   * Idempotency lookup: find an invoice previously created under a client_key.
   *
   * Public because callers that retry a whole save need to ask whether their
   * document is already committed before doing anything a second time — e.g.
   * the plan-limit guard lets a replay through (see
   * `UsageService.assertCanCreateDocument`).
   */
  async findByClientKey(businessId: string, clientKey: string): Promise<Row<'invoices'> | null> {
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
