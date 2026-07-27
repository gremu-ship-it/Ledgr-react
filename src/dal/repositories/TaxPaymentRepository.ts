import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { JournalRepository } from './JournalRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';

/** Storage bucket for tax payment receipts. Created by the tax module migration. */
export const TAX_RECEIPTS_BUCKET = 'tax-receipts';

/**
 * ROLE CHECK: per business_users.role (owner, admin, accountant,
 * payroll_manager, auditor, viewer), the caller should restrict
 * recordPayment() to owner/admin/accountant — mirroring the responsibility
 * split PayrollRepository.updateEmployee() documents. This repository does
 * not enforce roles itself, consistent with that existing pattern.
 */
export class TaxPaymentRepository extends BaseRepository<'tax_payments'> {
  private journalRepo: JournalRepository;

  constructor(client: SupabaseClient<Database>) {
    super(client, 'tax_payments');
    this.journalRepo = new JournalRepository(client);
  }

  /**
   * Upload a payment receipt to Supabase Storage and return its path.
   * Files are namespaced per business so the bucket's RLS policy can
   * scope access by the leading path segment.
   */
  async uploadReceipt(businessId: string, taxReturnId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
    const path = `${businessId}/${taxReturnId}/${Date.now()}.${ext}`;
    const { error } = await this.client.storage
      .from(TAX_RECEIPTS_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) {
      throw new ValidationError('tax_payments', `Receipt upload failed: ${error.message}`);
    }
    return path;
  }

  /** Time-limited signed URL for viewing a stored receipt. */
  async getReceiptUrl(receiptPath: string, expiresInSeconds = 300): Promise<string | null> {
    const { data, error } = await this.client.storage
      .from(TAX_RECEIPTS_BUCKET)
      .createSignedUrl(receiptPath, expiresInSeconds);
    if (error) {
      console.error('Failed to sign receipt URL:', error);
      return null;
    }
    return data?.signedUrl ?? null;
  }

  /**
   * Record a payment against a tax_return: creates the payment row, links
   * it to a bank account and optionally to a reconciled bank statement
   * line, attaches a receipt, posts Dr Tax Payable / Cr Bank to the
   * journal, and updates the parent return's amount_paid/status.
   */
  async recordPayment(params: {
    businessId: string;
    taxReturnId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: Row<'tax_payments'>['payment_method'];
    bankAccountId: string;
    /** Optional bank_statement_lines.id to mark reconciled against this payment. */
    bankStatementLineId?: string;
    reference?: string;
    receiptPath?: string;
    notes?: string;
    createdBy: string;
    entryNumber: string;
  }): Promise<Row<'tax_payments'>> {
    if (!(params.amount > 0)) {
      throw new ValidationError('tax_payments', 'Payment amount must be greater than zero.');
    }

    const { data: trData, error: trError } = await this.client
      .from('tax_returns')
      .select('*')
      .eq('id', params.taxReturnId)
      .maybeSingle();
    if (trError) throw toRepositoryError('tax_returns', trError);
    if (!trData) throw new ValidationError('tax_payments', `tax_return ${params.taxReturnId} not found.`);

    const tr = trData as Row<'tax_returns'>;
    if (tr.status === 'paid' || tr.status === 'void') {
      throw new ValidationError('tax_payments', `Cannot record payment on a '${tr.status}' tax return.`);
    }
    if (Number(tr.amount_due) <= 0) {
      throw new ValidationError(
        'tax_payments',
        `Tax return ${tr.id} is a credit/nil position — there is nothing to pay.`,
      );
    }
    const remaining = Number(tr.amount_due) - Number(tr.amount_paid);
    if (params.amount > remaining + 0.005) {
      throw new ValidationError(
        'tax_payments',
        `Payment of ${params.amount} exceeds remaining balance of ${remaining.toFixed(2)}.`,
      );
    }

    // The return must already be posted (Dr Expense / Cr Tax Payable) so we
    // know which liability account the payment clears.
    if (!tr.journal_entry_id) {
      throw new ValidationError(
        'tax_payments',
        `Tax return ${tr.id} has not been posted to the journal yet. Post the liability before paying it.`,
      );
    }
    const { lines } = await this.journalRepo.findByIdWithLines(tr.journal_entry_id);
    const payableLine = lines.find((l) => !l.is_debit);
    if (!payableLine) {
      throw new ValidationError('tax_payments', `Could not find the payable line on journal entry ${tr.journal_entry_id}.`);
    }

    const currency = await this.resolveBusinessCurrency(params.businessId);

    const dto: InsertDto<'tax_payments'> = {
      business_id: params.businessId,
      tax_return_id: params.taxReturnId,
      payment_date: params.paymentDate,
      amount: params.amount,
      payment_method: params.paymentMethod,
      bank_account_id: params.bankAccountId,
      reference: params.reference ?? null,
      receipt_path: params.receiptPath ?? null,
      notes: params.notes ?? null,
      created_by: params.createdBy,
    };
    const payment = await this.create(dto);

    // Dr Tax Payable / Cr Bank
    const base = {
      currency,
      exchange_rate: 1,
      tax_code: 'none' as const,
      tax_amount: 0,
    };
    const { entry } = await this.journalRepo.createBalancedEntry(
      {
        business_id: params.businessId,
        entry_number: params.entryNumber,
        entry_date: params.paymentDate,
        description: `Payment: ${tr.tax_code} — ${tr.period_label}`,
        source_type: 'tax_payment',
        source_id: payment.id,
        currency,
        exchange_rate: 1,
        status: 'draft',
        created_by: params.createdBy,
      },
      [
        {
          ...base,
          account_id: payableLine.account_id,
          description: `Tax payment — ${tr.period_label}`,
          is_debit: true,
          amount: params.amount,
          amount_base: params.amount,
          line_number: 1,
        },
        {
          ...base,
          account_id: params.bankAccountId,
          description: `Tax payment — ${tr.period_label}`,
          is_debit: false,
          amount: params.amount,
          amount_base: params.amount,
          line_number: 2,
        },
      ],
    );
    await this.journalRepo.post(entry.id, params.createdBy);
    await this.update(payment.id, { journal_entry_id: entry.id });

    // Link to an imported bank transaction if one was matched.
    if (params.bankStatementLineId) {
      const { data: postedLines } = await this.client
        .from('journal_lines')
        .select('id')
        .eq('journal_entry_id', entry.id)
        .eq('account_id', params.bankAccountId)
        .limit(1);
      const journalLineId = postedLines?.[0]?.id ?? null;

      const { error: reconcileErr } = await this.client
        .from('bank_statement_lines')
        .update({ is_reconciled: true, journal_line_id: journalLineId } as never)
        .eq('id', params.bankStatementLineId)
        .eq('business_id', params.businessId);
      if (reconcileErr) {
        console.error('Failed to link bank statement line to tax payment:', reconcileErr);
      }
    }

    const newAmountPaid = Math.round((Number(tr.amount_paid) + params.amount) * 100) / 100;
    const isFullyPaid = newAmountPaid >= Number(tr.amount_due) - 0.005;
    const { error: updateErr } = await this.client
      .from('tax_returns')
      .update({
        amount_paid: newAmountPaid,
        status: isFullyPaid ? 'paid' : tr.status,
      } as never)
      .eq('id', tr.id);
    if (updateErr) throw toRepositoryError('tax_returns', updateErr);

    return { ...payment, journal_entry_id: entry.id };
  }

  async findByTaxReturn(taxReturnId: string): Promise<Row<'tax_payments'>[]> {
    const { data, error } = await this.client
      .from('tax_payments')
      .select('*')
      .eq('tax_return_id', taxReturnId)
      .order('payment_date', { ascending: false });
    if (error) throw toRepositoryError('tax_payments', error);
    return data ?? [];
  }

  /** All payments for a business, newest first — powers the filing history view. */
  async findByBusiness(businessId: string): Promise<Row<'tax_payments'>[]> {
    const { data, error } = await this.client
      .from('tax_payments')
      .select('*')
      .eq('business_id', businessId)
      .order('payment_date', { ascending: false });
    if (error) throw toRepositoryError('tax_payments', error);
    return data ?? [];
  }

  private async resolveBusinessCurrency(businessId: string): Promise<string> {
    const { data, error } = await this.client
      .from('businesses')
      .select('base_currency')
      .eq('id', businessId)
      .maybeSingle();
    if (error) throw toRepositoryError('businesses', error);
    return data?.base_currency ?? 'MWK';
  }
}
