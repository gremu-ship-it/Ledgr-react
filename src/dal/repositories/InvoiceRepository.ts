import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';
import { triggerWebhook } from '@/services/webhook/webhook-triggers';
import type { PosSale } from '@/types/pos';

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
   * Search posted POS invoices and hydrate their immutable receipt lines for
   * the return register. Starter is limited to the current shift; Growth+
   * callers may search across historical shifts. The write command rechecks
   * plan, shift and line quantities server-side.
   */
  async findPosSalesForReturn(
    businessId: string,
    options: { shiftId: string | null; branchId: string | null; includeHistorical: boolean; search?: string; limit?: number },
  ): Promise<PosSale[]> {
    if (!options.shiftId) return [];
    let query = this.client
      .from('invoices')
      .select('id, business_id, branch_id, pos_shift_id, invoice_number, payment_reference, created_at, issue_date, contact_id, subtotal, discount_amount, total_amount, amount_paid, status')
      .eq('business_id', businessId)
      .eq('status', 'paid')
      .eq('invoice_type', 'invoice')
      .not('pos_shift_id', 'is', null)
      .is('deleted_at', null);
    query = options.branchId
      ? query.eq('branch_id', options.branchId)
      : query.is('branch_id', null);
    if (!options.includeHistorical) {
      query = query.eq('pos_shift_id', options.shiftId);
    }
    const term = options.search?.trim().replace(/[%,()]/g, '').slice(0, 80);
    if (term) {
      query = query.or(`invoice_number.ilike.%${term}%,payment_reference.ilike.%${term}%`);
    }
    const { data: invoices, error } = await query
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(options.limit ?? 30, 100)));
    if (error) throw toRepositoryError('invoices', error);
    let eligibleInvoices = invoices ?? [];
    if (options.includeHistorical) {
      const historicalShiftIds = [...new Set(eligibleInvoices
        .map((invoice) => invoice.pos_shift_id)
        .filter((shiftId): shiftId is string => !!shiftId && shiftId !== options.shiftId))];
      if (historicalShiftIds.length) {
        const { data: historicalShifts, error: shiftError } = await this.client
          .from('pos_shifts').select('id, status').eq('business_id', businessId).in('id', historicalShiftIds);
        if (shiftError) throw toRepositoryError('pos_shifts', shiftError);
        const closedShiftIds = new Set((historicalShifts ?? [])
          .filter((shift) => shift.status === 'closed').map((shift) => shift.id));
        eligibleInvoices = eligibleInvoices.filter((invoice) =>
          invoice.pos_shift_id === options.shiftId || closedShiftIds.has(invoice.pos_shift_id ?? ''));
      }
    }
    if (!eligibleInvoices.length) return [];

    const invoiceIds = eligibleInvoices.map((invoice) => invoice.id);
    const contactIds = [...new Set(invoices.map((invoice) => invoice.contact_id).filter(Boolean))];
    const [{ data: lines, error: lineError }, { data: contacts, error: contactError }] = await Promise.all([
      this.client.from('invoice_lines')
        .select('id, invoice_id, product_id, description, quantity, unit_price, line_total')
        .eq('business_id', businessId).in('invoice_id', invoiceIds),
      contactIds.length
        ? this.client.from('contacts').select('id, name').eq('business_id', businessId).in('id', contactIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (lineError) throw toRepositoryError('invoice_lines', lineError);
    if (contactError) throw toRepositoryError('contacts', contactError);
    const lineIds = (lines ?? []).map((line) => line.id);
    const { data: returnedLines, error: returnedError } = lineIds.length
      ? await this.client.from('pos_return_lines').select('invoice_line_id, quantity')
          .eq('business_id', businessId).in('invoice_line_id', lineIds)
      : { data: [], error: null };
    if (returnedError) throw toRepositoryError('pos_return_lines', returnedError);
    const [{ data: returnHeaders, error: returnHeaderError }, { data: legacyCorrections, error: legacyError }] = await Promise.all([
      this.client.from('pos_returns').select('invoice_id, command_key')
        .eq('business_id', businessId).in('invoice_id', invoiceIds),
      this.client.from('pos_corrections').select('document_id, command_key, lines')
        .eq('business_id', businessId).eq('command_type', 'refund_sale').in('document_id', invoiceIds),
    ]);
    if (returnHeaderError) throw toRepositoryError('pos_returns', returnHeaderError);
    if (legacyError) throw toRepositoryError('pos_corrections', legacyError);
    const returnedQuantity = new Map<string, number>();
    for (const returned of returnedLines ?? []) {
      returnedQuantity.set(returned.invoice_line_id, (returnedQuantity.get(returned.invoice_line_id) ?? 0) + Number(returned.quantity));
    }
    const newReturnKeys = new Set((returnHeaders ?? []).map((header) => header.command_key));
    const legacyQuantityByInvoiceProduct = new Map<string, number>();
    for (const correction of legacyCorrections ?? []) {
      if (newReturnKeys.has(correction.command_key) || !Array.isArray(correction.lines)) continue;
      for (const rawLine of correction.lines) {
        if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) continue;
        const productId = typeof rawLine.product_id === 'string' ? rawLine.product_id : null;
        const quantity = Number(rawLine.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        const key = `${correction.document_id}:${productId ?? '__no_product__'}`;
        legacyQuantityByInvoiceProduct.set(key, (legacyQuantityByInvoiceProduct.get(key) ?? 0) + quantity);
      }
    }
    const linesByInvoice = new Map<string, NonNullable<typeof lines>>();
    const lineTotalsByInvoice = new Map<string, number>();
    for (const line of lines ?? []) {
      const bucket = linesByInvoice.get(line.invoice_id) ?? [];
      bucket.push(line);
      linesByInvoice.set(line.invoice_id, bucket);
      lineTotalsByInvoice.set(line.invoice_id, (lineTotalsByInvoice.get(line.invoice_id) ?? 0) + Number(line.line_total || 0));
    }
    const names = new Map((contacts ?? []).map((contact) => [contact.id, contact.name]));
    return eligibleInvoices.map((invoice) => ({
      id: invoice.id,
      business_id: invoice.business_id,
      branch_id: invoice.branch_id,
      shift_id: invoice.pos_shift_id,
      receipt_number: invoice.payment_reference || invoice.invoice_number,
      invoice_number: invoice.invoice_number,
      created_at: invoice.created_at || invoice.issue_date,
      customer_id: invoice.contact_id,
      customer_name: names.get(invoice.contact_id) || null,
      gross_amount: Number(invoice.subtotal) + Number(invoice.discount_amount || 0),
      discount_amount: Number(invoice.discount_amount || 0),
      net_amount: Number(invoice.total_amount),
      total_amount: Number(invoice.total_amount),
      amount_paid: Number(invoice.amount_paid),
      total_paid: Number(invoice.amount_paid),
      payment_status: 'completed',
      status: 'completed',
      items: (linesByInvoice.get(invoice.id) ?? []).map((line) => ({
        id: line.id,
        sale_id: invoice.id,
        product_id: line.product_id ?? '',
        product_name: line.description,
        name: line.description,
        quantity: Number(line.quantity),
        returnable_quantity: Math.max(0, Number(line.quantity)
          - (returnedQuantity.get(line.id) ?? 0)
          - (legacyQuantityByInvoiceProduct.get(`${invoice.id}:${line.product_id ?? '__no_product__'}`) ?? 0)),
        return_unit_price: Number(line.quantity) > 0 && (lineTotalsByInvoice.get(invoice.id) ?? 0) > 0
          ? Number(line.line_total) / Number(line.quantity) * (Number(invoice.total_amount) / (lineTotalsByInvoice.get(invoice.id) ?? 1))
          : Number(line.unit_price),
        unit_price: Number(line.unit_price),
        line_total: Number(line.line_total),
      })),
    }));
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
