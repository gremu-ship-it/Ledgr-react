import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

/**
 * Invoice types that constitute revenue recognition events under IFRS 15.
 * Quotes and proformas are NOT revenue events — they must be excluded from
 * all income calculations.
 *
 * Schema: invoices.invoice_type CHECK IN
 *   ('invoice', 'credit_note', 'debit_note', 'quote', 'proforma')
 */
const REVENUE_INVOICE_TYPES = ['invoice', 'credit_note', 'debit_note'] as const;

export class IncomeRepository extends BaseRepository<'invoices'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'invoices');
  }

  /**
   * Fetch all revenue invoices (invoice, credit_note, debit_note) for a
   * business within a date range.
   *
   * FIX [#7 Accounting/IFRS logic]:
   * Previous version fetched ALL invoice types including 'quote' and
   * 'proforma'. These are not revenue recognition events under IFRS 15 and
   * must not appear in income reports or totals.
   *
   * Fixed by filtering `invoice_type` to only the three revenue types.
   * Credit notes and debit notes are included because they adjust revenue
   * (typically negative and positive amounts respectively) and must appear
   * in the income statement to give a correct net revenue figure.
   */
  async findByDateRange(
    businessId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Row<'invoices'>[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('business_id', businessId)
      .in('invoice_type', REVENUE_INVOICE_TYPES) // FIX: exclude quotes and proformas
      .gte('issue_date', fromDate)
      .lte('issue_date', toDate)
      .is('deleted_at', null)
      .order('issue_date', { ascending: false });

    if (error) throw toRepositoryError('invoices', error);
    return data ?? [];
  }

  /**
   * Compute revenue totals for a business within a date range.
   *
   * FIX [#7 Accounting/IFRS logic]:
   * Previous version excluded only 'void' invoices. It now also excludes
   * 'credit_note' status rows — but note that `invoice_type = 'credit_note'`
   * rows ARE included because they reduce gross revenue (their total_amount
   * is negative). The status 'credit_note' in `invoice_status` represents
   * a different concept (an invoice that has had a credit note raised
   * against it) and those should be summed at their remaining balance.
   *
   * Exclusion rules applied:
   * - invoice_type IN ('quote', 'proforma') → excluded (not revenue events)
   * - status = 'void' → excluded (cancelled, no revenue impact)
   *
   * Included (net revenue):
   * - invoice_type = 'invoice' → positive revenue
   * - invoice_type = 'credit_note' → negative adjustment (reduces revenue)
   * - invoice_type = 'debit_note' → positive adjustment (increases revenue)
   *
   * @returns Gross totals. Subtract `whtAmount` to arrive at net cash
   * received. `vatAmount` is collected on behalf of MRA and is not income.
   */
  async getTotals(
    businessId: string,
    fromDate: string,
    toDate: string,
  ): Promise<{
    totalAmount: number;
    vatAmount: number;
    whtAmount: number;
    amountPaid: number;
    amountOutstanding: number;
  }> {
    const invoices = await this.findByDateRange(businessId, fromDate, toDate);

    // Exclude voided invoices only — credit_notes ARE revenue adjustments
    const active = invoices.filter((inv) => inv.status !== 'void');

    const totals = active.reduce(
      (acc, inv) => ({
        totalAmount:  acc.totalAmount  + Number(inv.total_amount),
        vatAmount:    acc.vatAmount    + Number(inv.vat_amount),
        whtAmount:    acc.whtAmount    + Number(inv.wht_amount),
        amountPaid:   acc.amountPaid   + Number(inv.amount_paid),
        // amount_due is a generated column (nullable) — derive safely
        amountOutstanding: acc.amountOutstanding + (
          inv.amount_due !== null
            ? Number(inv.amount_due)
            : Number(inv.total_amount) - Number(inv.amount_paid)
        ),
      }),
      { totalAmount: 0, vatAmount: 0, whtAmount: 0, amountPaid: 0, amountOutstanding: 0 },
    );

    return totals;
  }

  /**
   * Fetch pending (not yet fully paid) revenue invoices for a business.
   * Used for the AR dashboard card.
   */
  async findOutstanding(businessId: string): Promise<Row<'invoices'>[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('business_id', businessId)
      .eq('invoice_type', 'invoice')          // only sales invoices are AR
      .in('status', ['sent', 'partially_paid', 'overdue'])
      .is('deleted_at', null)
      .order('due_date', { ascending: true }); // oldest due dates first

    if (error) throw toRepositoryError('invoices', error);
    return data ?? [];
  }

  /**
   * Fetch the trial balance view for P&L, Balance Sheet, and Cash Flow reports.
   */
  async findTrialBalance(businessId: string): Promise<Row<'v_trial_balance'>[]> {
    const { data, error } = await this.client
      .from('v_trial_balance')
      .select('*')
      .eq('business_id', businessId);

    if (error) throw toRepositoryError('v_trial_balance', error);
    return data ?? [];
  }
}