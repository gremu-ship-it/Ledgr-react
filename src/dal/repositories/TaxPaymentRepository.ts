import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { JournalRepository } from './JournalRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';

/**
 * ROLE CHECK: per your business_users.role enum (owner, admin, accountant,
 * payroll_manager, auditor, viewer), the caller (UI layer) should restrict
 * recordPayment() to owner/admin/accountant — mirroring the same
 * responsibility split PayrollRepository.updateEmployee() documents
 * ("caller is responsible for verifying role"). This repository does not
 * enforce roles itself, consistent with that existing pattern.
 */
export class TaxPaymentRepository extends BaseRepository<'tax_payments'> {
  private journalRepo: JournalRepository;

  constructor(client: SupabaseClient<Database>) {
    super(client, 'tax_payments');
    this.journalRepo = new JournalRepository(client);
  }

  /**
   * Record a payment against a tax_return: creates the payment row, links
   * it to a bank account (an `accounts` row, matching invoice_payments'
   * pattern rather than a separate bank_transactions table), optionally
   * attaches a receipt path, posts Dr Tax Payable / Cr Bank to the
   * journal, and updates the parent tax_return's amount_paid/status.
   *
   * bankAccountId must reference an `accounts` row where is_bank_account
   * = true (not enforced here — same non-enforcement pattern as
   * invoice_payments.bank_account_id, which is a plain FK to accounts).
   */
  async recordPayment(params: {
    businessId: string;
    taxReturnId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: Row<'tax_payments'>['payment_method'];
    bankAccountId: string;
    reference?: string;
    receiptPath?: string;
    notes?: string;
    createdBy: string;
    entryNumber: string;
  }): Promise<Row<'tax_payments'>> {
    const taxReturn = await this.client
      .from('tax_returns')
      .select('*')
      .eq('id', params.taxReturnId)
      .maybeSingle();
    if (taxReturn.error) throw toRepositoryError('tax_returns', taxReturn.error);
    if (!taxReturn.data) throw new ValidationError('tax_payments', `tax_return ${params.taxReturnId} not found.`);

    const tr = taxReturn.data as Row<'tax_returns'>;
    if (tr.status === 'paid' || tr.status === 'void') {
      throw new ValidationError('tax_payments', `Cannot record payment on a '${tr.status}' tax return.`);
    }
    const remaining = Number(tr.amount_due) - Number(tr.amount_paid);
    if (params.amount > remaining + 0.005) {
      throw new ValidationError(
        'tax_payments',
        `Payment of ${params.amount} exceeds remaining balance of ${remaining.toFixed(2)}.`,
      );
    }

    // Requires tax_return to already be posted to the journal (Dr Expense /
    // Cr Tax Payable) via TaxReturnRepository.postToJournal, so we know
    // which account the payment clears. If not yet posted, block here
    // rather than guessing an account.
    if (!tr.journal_entry_id) {
      throw new ValidationError(
        'tax_payments',
        `Tax return ${tr.id} has not been posted to the journal yet. Call postToJournal() first.`,
      );
    }
    const { lines } = await this.journalRepo.findByIdWithLines(tr.journal_entry_id);
    const payableLine = lines.find((l) => !l.is_debit);
    if (!payableLine) {
      throw new ValidationError('tax_payments', `Could not find the payable line on journal entry ${tr.journal_entry_id}.`);
    }

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
    const { entry } = await this.journalRepo.createBalancedEntry(
      {
        business_id: params.businessId,
        entry_number: params.entryNumber,
        entry_date: params.paymentDate,
        description: `Payment: ${tr.tax_code} — ${tr.period_label}`,
        source_type: 'tax_payment',
        source_id: payment.id,
        currency: 'MWK',
        exchange_rate: 1,
        status: 'draft',
        created_by: params.createdBy,
      },
      [
        {
          account_id: payableLine.account_id,
          description: `Tax payment — ${tr.period_label}`,
          is_debit: true,
          amount: params.amount,
          amount_base: params.amount,
          currency: 'MWK',
          exchange_rate: 1,
          line_number: 1,
          tax_code: 'none',
          tax_amount: 0,
        },
        {
          account_id: params.bankAccountId,
          description: `Tax payment — ${tr.period_label}`,
          is_debit: false,
          amount: params.amount,
          amount_base: params.amount,
          currency: 'MWK',
          exchange_rate: 1,
          line_number: 2,
          tax_code: 'none',
          tax_amount: 0,
        },
      ],
    );
    await this.journalRepo.post(entry.id, params.createdBy);
    await this.update(payment.id, { journal_entry_id: entry.id });

    const newAmountPaid = Math.round((Number(tr.amount_paid) + params.amount) * 100) / 100;
    const isFullyPaid = newAmountPaid >= Number(tr.amount_due) - 0.005;
    await this.client
      .from('tax_returns')
      .update({
        amount_paid: newAmountPaid,
        status: isFullyPaid ? 'paid' : tr.status,
      } as never)
      .eq('id', tr.id);

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
}