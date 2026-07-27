import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { JournalRepository } from './JournalRepository';
import { TaxRepository } from './TaxRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';
import { lastDayOfMonth, todayIso, addDays, periodLabel as toPeriodLabel } from '@/lib/taxDates';
import { dueDateFor, resolveJurisdiction, type Jurisdiction } from '@/lib/taxRules';

/**
 * Invoice types that are revenue recognition events and therefore carry
 * output VAT. Quotes and proformas are NOT supplies — including them
 * overstates output tax on the VAT return. Mirrors REVENUE_INVOICE_TYPES
 * in IncomeRepository.
 */
const VATABLE_INVOICE_TYPES = ['invoice', 'credit_note', 'debit_note'] as const;

/** Invoice/expense statuses that must never contribute to a VAT return. */
const EXCLUDED_STATUSES = ['void', 'draft'] as const;

export interface VatReturnBreakdown {
  outputTax: number;
  inputTax: number;
  netPayable: number;
  /** Positive when MRA owes the business (input > output). */
  refundDue: number;
}

export class TaxReturnRepository extends BaseRepository<'tax_returns'> {
  private journalRepo: JournalRepository;
  private taxConfigRepo: TaxRepository;

  constructor(client: SupabaseClient<Database>) {
    super(client, 'tax_returns');
    this.journalRepo = new JournalRepository(client);
    this.taxConfigRepo = new TaxRepository(client);
  }

  // --------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------

  async findByBusiness(businessId: string): Promise<Row<'tax_returns'>[]> {
    const { data, error } = await this.client
      .from('tax_returns')
      .select('*')
      .eq('business_id', businessId)
      .order('due_date', { ascending: false });
    if (error) throw toRepositoryError('tax_returns', error);
    return data ?? [];
  }

  /** Dashboard feed: anything not yet paid/void, nearest due date first. */
  async findOpenByBusiness(businessId: string): Promise<Row<'tax_returns'>[]> {
    const { data, error } = await this.client
      .from('tax_returns')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['pending', 'filed', 'overdue'])
      .order('due_date', { ascending: true });
    if (error) throw toRepositoryError('tax_returns', error);
    return data ?? [];
  }

  /** Filing history: paid/void returns, most recent first. */
  async findHistoryByBusiness(businessId: string): Promise<Row<'tax_returns'>[]> {
    const { data, error } = await this.client
      .from('tax_returns')
      .select('*')
      .eq('business_id', businessId)
      .in('status', ['paid', 'void'])
      .order('period_end', { ascending: false });
    if (error) throw toRepositoryError('tax_returns', error);
    return data ?? [];
  }

  async findPaymentsForReturn(taxReturnId: string): Promise<Row<'tax_payments'>[]> {
    const { data, error } = await this.client
      .from('tax_payments')
      .select('*')
      .eq('tax_return_id', taxReturnId)
      .order('payment_date', { ascending: false });
    if (error) throw toRepositoryError('tax_payments', error);
    return data ?? [];
  }

  /**
   * Flip pending/filed returns past their due date to 'overdue'.
   * Nothing previously performed this transition, so returns sat at
   * 'pending' forever and the 'overdue' enum value was unreachable.
   * Called on dashboard load; also safe to run from a cron job.
   */
  async markOverdueReturns(businessId: string): Promise<number> {
    const today = todayIso();
    const { data, error } = await this.client
      .from('tax_returns')
      .update({ status: 'overdue' } as never)
      .eq('business_id', businessId)
      .in('status', ['pending', 'filed'])
      .lt('due_date', today)
      .select('id');
    if (error) throw toRepositoryError('tax_returns', error);
    return (data ?? []).length;
  }

  // --------------------------------------------------------------------
  // Generation: VAT
  // --------------------------------------------------------------------

  /**
   * Compute output/input VAT for a period without persisting anything.
   * Exposed so the UI can preview a VAT 3 before generating the return.
   */
  async computeVatBreakdown(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<VatReturnBreakdown> {
    const [outputTax, inputTax] = await Promise.all([
      this.sumInvoiceTax(businessId, periodStart, periodEnd),
      this.sumExpenseTax(businessId, periodStart, periodEnd),
    ]);
    const net = Math.round((outputTax - inputTax) * 100) / 100;
    return {
      outputTax,
      inputTax,
      netPayable: net > 0 ? net : 0,
      refundDue: net < 0 ? Math.abs(net) : 0,
    };
  }

  /**
   * Generate (or return existing) VAT return for a calendar-month period.
   * Idempotent via the unique (business_id, tax_code, period_label) index.
   */
  async generateVatReturn(
    businessId: string,
    periodStart: string,
    periodEnd: string,
    jurisdiction?: Jurisdiction,
  ): Promise<Row<'tax_returns'>> {
    const label = toPeriodLabel(periodStart);

    const existing = await this.findByPeriod(businessId, 'vat_standard', label);
    if (existing) return existing;

    const juris = jurisdiction ?? (await this.resolveBusinessJurisdiction(businessId));
    const breakdown = await this.computeVatBreakdown(businessId, periodStart, periodEnd);
    const dueDate = dueDateFor(juris, 'vat', periodEnd);

    const dto: InsertDto<'tax_returns'> = {
      business_id: businessId,
      tax_code: 'vat_standard',
      period_label: label,
      period_start: periodStart,
      period_end: periodEnd,
      due_date: dueDate,
      output_tax: breakdown.outputTax,
      input_tax: breakdown.inputTax,
      gross_amount: 0,
      // A credit position is stored as a negative amount_due rather than
      // being clamped to zero, so refunds/carry-forwards survive. Form
      // VAT 3 has a repayment box that needs this figure.
      amount_due: breakdown.refundDue > 0 ? -breakdown.refundDue : breakdown.netPayable,
      amount_paid: 0,
      status: 'pending',
      source_type: 'vat_period',
      source_id: null,
    };

    const created = await this.create(dto);
    await this.scheduleAlerts(created);
    return created;
  }

  // --------------------------------------------------------------------
  // Generation: PAYE (triggered by payroll approval)
  // --------------------------------------------------------------------

  async generatePayeReturn(
    payrollRun: Row<'payroll_runs'>,
    jurisdiction?: Jurisdiction,
  ): Promise<Row<'tax_returns'>> {
    const label = toPeriodLabel(payrollRun.period_start);

    const existing = await this.findByPeriod(payrollRun.business_id, 'paye', label);
    if (existing) return existing;

    const juris = jurisdiction ?? (await this.resolveBusinessJurisdiction(payrollRun.business_id));
    // Was: lastDayOfMonth(period_end) — the last day of the period's OWN
    // month, i.e. due the same day the period closed. MRA allows 14 days
    // after month end; the rule now lives in taxRules.ts.
    const dueDate = dueDateFor(juris, 'paye', payrollRun.period_end);

    const dto: InsertDto<'tax_returns'> = {
      business_id: payrollRun.business_id,
      tax_code: 'paye',
      period_label: label,
      period_start: payrollRun.period_start,
      period_end: payrollRun.period_end,
      due_date: dueDate,
      output_tax: 0,
      input_tax: 0,
      gross_amount: payrollRun.total_paye,
      amount_due: payrollRun.total_paye,
      amount_paid: 0,
      status: 'pending',
      source_type: 'payroll_run',
      source_id: payrollRun.id,
    };

    const created = await this.create(dto);
    await this.scheduleAlerts(created);
    return created;
  }

  // --------------------------------------------------------------------
  // Generation: TPR pension (triggered by payroll approval)
  // --------------------------------------------------------------------

  async generateTprReturn(
    payrollRun: Row<'payroll_runs'>,
    lines: Row<'payroll_employee_lines'>[],
    jurisdiction?: Jurisdiction,
  ): Promise<Row<'tax_returns'>> {
    const label = toPeriodLabel(payrollRun.period_start);

    const existing = await this.findByPeriod(payrollRun.business_id, 'tpr_pension', label);
    if (existing) return existing;

    const juris = jurisdiction ?? (await this.resolveBusinessJurisdiction(payrollRun.business_id));
    const totalEmployer = lines.reduce((sum, l) => sum + Number(l.pension_employer), 0);
    const totalEmployee = lines.reduce((sum, l) => sum + Number(l.pension_employee), 0);
    const total = Math.round((totalEmployer + totalEmployee) * 100) / 100;

    const dueDate = dueDateFor(juris, 'pension', payrollRun.period_end);

    const dto: InsertDto<'tax_returns'> = {
      business_id: payrollRun.business_id,
      tax_code: 'tpr_pension',
      period_label: label,
      period_start: payrollRun.period_start,
      period_end: payrollRun.period_end,
      due_date: dueDate,
      output_tax: 0,
      input_tax: 0,
      gross_amount: total,
      amount_due: total,
      amount_paid: 0,
      status: 'pending',
      source_type: 'payroll_run',
      source_id: payrollRun.id,
    };

    const created = await this.create(dto);
    await this.scheduleAlerts(created);
    return created;
  }

  // --------------------------------------------------------------------
  // Filing + journal posting
  // --------------------------------------------------------------------

  /**
   * Record filing acknowledgement. Does not move money — see recordPayment.
   * 'paid' is accepted because paying before filing is routine for VAT;
   * previously that combination locked filing out permanently.
   */
  async markFiled(id: string, filedRef: string): Promise<Row<'tax_returns'>> {
    const current = await this.findById(id);
    if (current.status === 'void') {
      throw new ValidationError('tax_returns', `Cannot file a voided tax return.`);
    }
    if (current.filed_at) {
      throw new ValidationError(
        'tax_returns',
        `Tax return ${id} was already filed on ${current.filed_at.slice(0, 10)}${current.filed_ref ? ` (ref ${current.filed_ref})` : ''}.`,
      );
    }
    // Paying before filing must not demote a 'paid' return back to 'filed'.
    const nextStatus = current.status === 'paid' ? 'paid' : 'filed';
    return this.update(id, {
      status: nextStatus,
      filed_ref: filedRef,
      filed_at: new Date().toISOString(),
    });
  }

  /**
   * Post the tax liability to the journal.
   *
   * VAT close: Dr Output VAT (2121) / Cr Input VAT (1135) / Cr-or-Dr net.
   * Invoices already credit 2121 and expenses already debit 1135 at
   * transaction time, so this entry CLEARS both control accounts and
   * recognises the single net balance owed to (or recoverable from) the
   * revenue authority. The previous implementation posted the net amount
   * twice over the same two accounts, which double-counted the liability
   * and left the control accounts uncleared.
   *
   * PAYE / TPR: Dr Expense / Cr Tax Payable, unchanged in shape.
   */
  async postToJournal(
    taxReturnId: string,
    expenseAccountId: string | null,
    createdBy: string,
    entryNumber: string,
  ): Promise<Row<'tax_returns'>> {
    const taxReturn = await this.findById(taxReturnId);
    if (taxReturn.journal_entry_id) {
      throw new ValidationError('tax_returns', `Tax return ${taxReturnId} already has a journal entry posted.`);
    }

    const config = await this.taxConfigRepo.findByCode(
      taxReturn.business_id,
      taxReturn.tax_code,
      taxReturn.period_end,
    );
    if (!config?.tax_payable_account_id) {
      throw new ValidationError(
        'tax_returns',
        `No tax payable account configured for ${taxReturn.tax_code}. ` +
        `Link it in Tax > Tax Configurations before posting.`,
      );
    }

    const currency = await this.resolveBusinessCurrency(taxReturn.business_id);
    const lines =
      taxReturn.tax_code === 'vat_standard'
        ? this.buildVatCloseLines(taxReturn, config, currency)
        : this.buildLiabilityLines(taxReturn, config, expenseAccountId, currency);

    const { entry } = await this.journalRepo.createBalancedEntry(
      {
        business_id: taxReturn.business_id,
        entry_number: entryNumber,
        entry_date: taxReturn.period_end,
        description: `${taxReturn.tax_code} liability — ${taxReturn.period_label}`,
        source_type: 'tax_return',
        source_id: taxReturn.id,
        currency,
        exchange_rate: 1,
        status: 'draft',
        created_by: createdBy,
      },
      lines,
    );
    await this.journalRepo.post(entry.id, createdBy);

    return this.update(taxReturnId, { journal_entry_id: entry.id });
  }

  // --------------------------------------------------------------------
  // Journal line builders
  // --------------------------------------------------------------------

  private buildVatCloseLines(
    taxReturn: Row<'tax_returns'>,
    config: Row<'tax_configurations'>,
    currency: string,
  ): Omit<InsertDto<'journal_lines'>, 'journal_entry_id' | 'business_id'>[] {
    const outputTax = Math.round(Number(taxReturn.output_tax) * 100) / 100;
    const inputTax = Math.round(Number(taxReturn.input_tax) * 100) / 100;
    const net = Math.round((outputTax - inputTax) * 100) / 100;

    if (outputTax === 0 && inputTax === 0) {
      throw new ValidationError('tax_returns', `VAT return ${taxReturn.id} is nil — nothing to post.`);
    }

    const outputAccount = config.tax_payable_account_id!;
    const inputAccount = config.tax_receivable_account_id;
    if (inputTax > 0 && !inputAccount) {
      throw new ValidationError(
        'tax_returns',
        `Input VAT of ${inputTax} cannot be cleared: no VAT receivable account is linked. ` +
        `Set it in Tax > Tax Configurations.`,
      );
    }

    const base = {
      currency,
      exchange_rate: 1,
      tax_code: 'none' as const,
      tax_amount: 0,
    };
    const lines: Omit<InsertDto<'journal_lines'>, 'journal_entry_id' | 'business_id'>[] = [];
    let n = 1;

    // Clear the output VAT control account (normally credit balance).
    if (outputTax > 0) {
      lines.push({
        ...base,
        account_id: outputAccount,
        description: `Output VAT cleared — ${taxReturn.period_label}`,
        is_debit: true,
        amount: outputTax,
        amount_base: outputTax,
        line_number: n++,
      });
    }

    // Clear the input VAT control account (normally debit balance).
    if (inputTax > 0) {
      lines.push({
        ...base,
        account_id: inputAccount!,
        description: `Input VAT cleared — ${taxReturn.period_label}`,
        is_debit: false,
        amount: inputTax,
        amount_base: inputTax,
        line_number: n++,
      });
    }

    // Recognise the net position.
    const netAmount = Math.abs(net);
    if (netAmount > 0) {
      lines.push({
        ...base,
        account_id: net > 0 ? outputAccount : inputAccount!,
        description:
          net > 0
            ? `Net VAT payable — ${taxReturn.period_label}`
            : `Net VAT recoverable — ${taxReturn.period_label}`,
        is_debit: net < 0,
        amount: netAmount,
        amount_base: netAmount,
        line_number: n,
      });
    }

    return lines;
  }

  private buildLiabilityLines(
    taxReturn: Row<'tax_returns'>,
    config: Row<'tax_configurations'>,
    expenseAccountId: string | null,
    currency: string,
  ): Omit<InsertDto<'journal_lines'>, 'journal_entry_id' | 'business_id'>[] {
    const amount = Math.round(Number(taxReturn.amount_due) * 100) / 100;
    if (amount <= 0) {
      throw new ValidationError('tax_returns', `Tax return ${taxReturn.id} has no liability to post.`);
    }
    if (!expenseAccountId) {
      throw new ValidationError(
        'tax_returns',
        `An expense account is required to post a ${taxReturn.tax_code} liability.`,
      );
    }

    const base = {
      currency,
      exchange_rate: 1,
      tax_code: 'none' as const,
      tax_amount: 0,
    };
    return [
      {
        ...base,
        account_id: expenseAccountId,
        description: `${taxReturn.tax_code} liability — ${taxReturn.period_label}`,
        is_debit: true,
        amount,
        amount_base: amount,
        line_number: 1,
      },
      {
        ...base,
        account_id: config.tax_payable_account_id!,
        description: `${taxReturn.tax_code} payable — ${taxReturn.period_label}`,
        is_debit: false,
        amount,
        amount_base: amount,
        line_number: 2,
      },
    ];
  }

  // --------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------

  private async findByPeriod(
    businessId: string,
    taxCode: Row<'tax_returns'>['tax_code'],
    label: string,
  ): Promise<Row<'tax_returns'> | null> {
    const { data, error } = await this.client
      .from('tax_returns')
      .select('*')
      .eq('business_id', businessId)
      .eq('tax_code', taxCode)
      .eq('period_label', label)
      .maybeSingle();
    if (error) throw toRepositoryError('tax_returns', error);
    return data ?? null;
  }

  private async resolveBusinessJurisdiction(businessId: string): Promise<Jurisdiction> {
    const { data, error } = await this.client
      .from('businesses')
      .select('country')
      .eq('id', businessId)
      .maybeSingle();
    if (error) throw toRepositoryError('businesses', error);
    return resolveJurisdiction(data?.country);
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

  /**
   * Output VAT: sum of tax_amount on lines of revenue invoices issued in
   * the period. Excludes quotes/proformas (not supplies), soft-deleted
   * invoices, and void/draft documents — none of which were filtered
   * before, all of which overstate output tax.
   */
  private async sumInvoiceTax(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    const { data: parents, error: parentErr } = await this.client
      .from('invoices')
      .select('id')
      .eq('business_id', businessId)
      .in('invoice_type', VATABLE_INVOICE_TYPES)
      .not('status', 'in', `(${EXCLUDED_STATUSES.join(',')})`)
      .is('deleted_at', null)
      .gte('issue_date', periodStart)
      .lte('issue_date', periodEnd);
    if (parentErr) throw toRepositoryError('invoices', parentErr);

    return this.sumLineTaxFor(businessId, 'invoice_lines', 'invoice_id', (parents ?? []).map((p) => p.id));
  }

  /**
   * Input VAT: sum of tax_amount on lines of expenses dated in the period.
   *
   * The previous implementation wrapped this in `.catch(() => 0)` to hedge
   * against an unconfirmed column name — which silently reported input VAT
   * as zero on ANY failure (RLS denial, network error), overstating VAT
   * payable to the revenue authority. expenses.expense_date is correct, so
   * the catch is gone and errors now surface.
   */
  private async sumExpenseTax(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    const { data: parents, error: parentErr } = await this.client
      .from('expenses')
      .select('id')
      .eq('business_id', businessId)
      .not('status', 'in', `(${EXCLUDED_STATUSES.join(',')})`)
      .is('deleted_at', null)
      .gte('expense_date', periodStart)
      .lte('expense_date', periodEnd);
    if (parentErr) throw toRepositoryError('expenses', parentErr);

    return this.sumLineTaxFor(businessId, 'expense_lines', 'expense_id', (parents ?? []).map((p) => p.id));
  }

  private async sumLineTaxFor(
    businessId: string,
    linesTable: 'invoice_lines' | 'expense_lines',
    fkColumn: string,
    parentIds: string[],
  ): Promise<number> {
    if (parentIds.length === 0) return 0;

    // Chunked to stay clear of PostgREST URL length limits on busy months.
    const CHUNK = 200;
    let total = 0;
    for (let i = 0; i < parentIds.length; i += CHUNK) {
      const chunk = parentIds.slice(i, i + CHUNK);
      const { data, error } = await this.client
        .from(linesTable)
        .select('tax_amount')
        .eq('business_id', businessId)
        .eq('tax_code', 'vat_standard')
        .in(fkColumn as never, chunk);
      if (error) throw toRepositoryError(linesTable, error);
      total += (data ?? []).reduce((sum: number, l: { tax_amount: number }) => sum + Number(l.tax_amount), 0);
    }
    return Math.round(total * 100) / 100;
  }

  private async scheduleAlerts(taxReturn: Row<'tax_returns'>): Promise<void> {
    const offsets: { days: number; type: 'due_date' | '1_day' | '7_day' | '14_day' }[] = [
      { days: -14, type: '14_day' },
      { days: -7, type: '7_day' },
      { days: -1, type: '1_day' },
      { days: 0, type: 'due_date' },
    ];
    const today = todayIso();
    const rows: InsertDto<'tax_alerts'>[] = offsets
      .map((o) => ({
        business_id: taxReturn.business_id,
        tax_return_id: taxReturn.id,
        alert_type: o.type,
        scheduled_for: addDays(taxReturn.due_date, o.days),
        channel: 'email' as const,
        status: 'pending' as const,
      }))
      .filter((r) => r.scheduled_for >= today);

    if (rows.length === 0) return;
    const { error } = await this.client.from('tax_alerts').insert(rows as never);
    if (error) console.error('Failed to schedule tax_alerts:', error);
  }

  /** Calendar-month period bounds for a 'YYYY-MM' label. */
  static periodBounds(label: string): { start: string; end: string } {
    const start = `${label}-01`;
    return { start, end: lastDayOfMonth(start) };
  }
}
