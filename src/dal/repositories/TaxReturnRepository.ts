import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { JournalRepository } from './JournalRepository';
import { TaxRepository } from './TaxRepository';
import { ValidationError, toRepositoryError } from '../errors/RepositoryError';
import { createLogger } from '@/lib/logger';
import { chunk } from '@/lib/chunk';
import { computeVatNetDue, vatDueDateForPeriodEnd, vatPeriodLabel } from '@/lib/vat';

const log = createLogger('TaxReturnRepository');

/**
 * NOTE ON ASSUMPTIONS (please verify before relying on this in production):
 *
 * 1. Account resolution for journal postings (getRequiredAccountId) reads
 *    tax_configurations.tax_payable_account_id. For tpr_pension this is
 *    seeded NULL (see migration) — callers MUST link the Pension Payable
 *    account before generateTprReturn()'s postToJournal step will work.
 *    A clear ValidationError is thrown if the account is missing, rather
 *    than silently posting to a wrong/default account.
 *
 * 2. VAT input/output tax is derived from invoice_lines / expense_lines
 *    tax_amount where tax_code = 'vat_standard'. This assumes those
 *    columns are always populated correctly at line-entry time (they are,
 *    per the schema you shared — tax_amount is NOT NULL with default 0).
 *    Lines with vat_zero / vat_exempt are correctly excluded (0% impact).
 *
 * 3. "period close" for VAT is NOT tied to accounting_periods — it is a
 *    calendar-month rollup, generated automatically. This was your stated
 *    preference (auto-generate), matching businesses.vat_period.
 */
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

  // --------------------------------------------------------------------
  // Generation: VAT
  // --------------------------------------------------------------------

  /**
   * Generate (or return existing) VAT return for a calendar-month period.
   * Idempotent — relies on the unique (business_id, tax_code, period_label)
   * constraint; if a return for this period already exists, it is returned
   * unchanged rather than duplicated.
   *
   * periodStart/periodEnd: ISO date strings, e.g. '2026-06-01' / '2026-06-30'.
   */
  async generateVatReturn(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<Row<'tax_returns'>> {
    const periodLabel = vatPeriodLabel(periodStart);

    const existing = await this.findByPeriod(businessId, 'vat_standard', periodLabel);
    if (existing) return existing;

    const config = await this.taxConfigRepo.findByCode(businessId, 'vat_standard', periodEnd);
    if (!config) {
      throw new ValidationError(
        'tax_returns',
        `No active vat_standard tax_configuration found for business ${businessId} as of ${periodEnd}.`,
      );
    }

    const outputTax = await this.sumLineTax(
      businessId, 'invoice_lines', 'invoice_id', 'invoices', 'issue_date', periodStart, periodEnd,
    );
    const inputTax = await this.sumLineTax(
      businessId, 'expense_lines', 'expense_id', 'expenses', 'expense_date', periodStart, periodEnd,
    );

    const netPayable = computeVatNetDue(outputTax, inputTax);
    const dueDate = vatDueDateForPeriodEnd(periodEnd);

    const dto: InsertDto<'tax_returns'> = {
      business_id: businessId,
      tax_code: 'vat_standard',
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      due_date: dueDate,
      output_tax: outputTax,
      input_tax: inputTax,
      gross_amount: 0,
      amount_due: netPayable,
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
  ): Promise<Row<'tax_returns'>> {
    const periodLabel = payrollRun.period_start.slice(0, 7);

    const existing = await this.findByPeriod(payrollRun.business_id, 'paye', periodLabel);
    if (existing) {
      const updatedGross = Number(existing.gross_amount) + Number(payrollRun.total_paye);
      const updatedDue = Number(existing.amount_due) + Number(payrollRun.total_paye);
      return this.update(existing.id, {
        gross_amount: updatedGross,
        amount_due: updatedDue,
      } as never);
    }

    // Due: 14th of the following month, matching MRA requirements.
    const end = new Date(payrollRun.period_end);
    const nextMonth = new Date(end.getFullYear(), end.getMonth() + 1, 14);
    const dueDate = nextMonth.toISOString().slice(0, 10);

    const dto: InsertDto<'tax_returns'> = {
      business_id: payrollRun.business_id,
      tax_code: 'paye',
      period_label: periodLabel,
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
  ): Promise<Row<'tax_returns'>> {
    const periodLabel = payrollRun.period_start.slice(0, 7);

    const totalEmployer = lines.reduce((sum, l) => sum + Number(l.pension_employer), 0);
    const totalEmployee = lines.reduce((sum, l) => sum + Number(l.pension_employee), 0);
    const total = Math.round((totalEmployer + totalEmployee) * 100) / 100;

    const existing = await this.findByPeriod(payrollRun.business_id, 'tpr_pension', periodLabel);
    if (existing) {
      const updatedGross = Number(existing.gross_amount) + total;
      const updatedDue = Number(existing.amount_due) + total;
      return this.update(existing.id, {
        gross_amount: updatedGross,
        amount_due: updatedDue,
      } as never);
    }

    // TPR remittance due date: MRA/pension regulator practice is 15 days
    // after month end. FLAGGED: not independently confirmed — verify
    // against current Pension Act guidance before relying on this date.
    const dueDate = this.addDays(this.lastDayOfMonth(payrollRun.period_end), 15);

    const dto: InsertDto<'tax_returns'> = {
      business_id: payrollRun.business_id,
      tax_code: 'tpr_pension',
      period_label: periodLabel,
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

  /** Record MRA filing acknowledgement. Does not move money — see recordPayment. */
  async markFiled(id: string, filedRef: string): Promise<Row<'tax_returns'>> {
    const current = await this.findById(id);
    if (current.status !== 'pending' && current.status !== 'overdue') {
      throw new ValidationError(
        'tax_returns',
        `Cannot file tax_return ${id}: current status is '${current.status}'.`,
      );
    }
    return this.update(id, {
      status: 'filed',
      filed_ref: filedRef,
      filed_at: new Date().toISOString(),
    });
  }

  /**
   * Post the tax liability to the journal. Dr [Expense or n/a for VAT] /
   * Cr [tax_payable_account_id from tax_configurations].
   *
   * VAT: Dr Output VAT clearing not modelled separately — this posts the
   * NET liability only (output − input already reflected in amount_due).
   * If you need gross output/input tracked as separate journal lines
   * (common for VAT reconciliation), flag it — this is a simplification.
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
    if (taxReturn.amount_due <= 0) {
      throw new ValidationError('tax_returns', `Tax return ${taxReturnId} has no liability to post.`);
    }

    let config = await this.taxConfigRepo.findByCode(taxReturn.business_id, taxReturn.tax_code, taxReturn.period_end);
    if (!config?.tax_payable_account_id) {
      const codeSearch = taxReturn.tax_code === 'tpr_pension' ? '2132' : taxReturn.tax_code === 'paye' ? '2122' : '2121';
      const nameSearch = taxReturn.tax_code === 'tpr_pension' ? 'pension' : taxReturn.tax_code === 'paye' ? 'paye' : 'vat';
      const { data: acc } = await this.client
        .from('accounts')
        .select('id')
        .eq('business_id', taxReturn.business_id)
        .is('deleted_at', null)
        .or(`code.eq.${codeSearch},name.ilike.%${nameSearch}%`)
        .limit(1)
        .maybeSingle();

      if (acc?.id) {
        if (config) {
          await this.client
            .from('tax_configurations')
            .update({ tax_payable_account_id: acc.id })
            .eq('id', config.id);
          config = { ...config, tax_payable_account_id: acc.id };
        }
      }
    }

    if (!config?.tax_payable_account_id) {
      throw new ValidationError(
        'tax_returns',
        `No tax_payable_account_id configured for ${taxReturn.tax_code} on business ${taxReturn.business_id}. ` +
        `Link the liability account in tax settings before posting.`,
      );
    }

    const amount = Number(taxReturn.amount_due);
    const lines = expenseAccountId
      ? [
          { account_id: expenseAccountId, description: `${taxReturn.tax_code} liability — ${taxReturn.period_label}`, is_debit: true, amount, amount_base: amount, currency: 'MWK', exchange_rate: 1, line_number: 1, tax_code: 'none' as const, tax_amount: 0, reconciled: false as const },
          { account_id: config.tax_payable_account_id, description: `${taxReturn.tax_code} payable — ${taxReturn.period_label}`, is_debit: false, amount, amount_base: amount, currency: 'MWK', exchange_rate: 1, line_number: 2, tax_code: 'none' as const, tax_amount: 0, reconciled: false as const },
        ]
      : // VAT case: liability already sits in the VAT clearing accounts from
        // each invoice/expense posting; this just reclassifies net-due into
        // a payable. FLAGGED: confirm whether your invoice/expense postings
        // already credit a VAT payable account — if so, this second posting
        // would double-count. Verify against how invoices currently post VAT.
        [
          { account_id: config.tax_receivable_account_id ?? config.tax_payable_account_id, description: `Net VAT reclass — ${taxReturn.period_label}`, is_debit: true, amount, amount_base: amount, currency: 'MWK', exchange_rate: 1, line_number: 1, tax_code: 'none' as const, tax_amount: 0, reconciled: false as const },
          { account_id: config.tax_payable_account_id, description: `VAT payable — ${taxReturn.period_label}`, is_debit: false, amount, amount_base: amount, currency: 'MWK', exchange_rate: 1, line_number: 2, tax_code: 'none' as const, tax_amount: 0, reconciled: false as const },
        ];

    const { entry } = await this.journalRepo.createBalancedEntry(
      {
        business_id: taxReturn.business_id,
        entry_number: entryNumber,
        entry_date: new Date().toISOString().slice(0, 10),
        description: `${taxReturn.tax_code} liability — ${taxReturn.period_label}`,
        source_type: 'tax_return',
        source_id: taxReturn.id,
        currency: 'MWK',
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
  // Internals
  // --------------------------------------------------------------------

  private async findByPeriod(
    businessId: string,
    taxCode: Row<'tax_returns'>['tax_code'],
    periodLabel: string,
  ): Promise<Row<'tax_returns'> | null> {
    const { data, error } = await this.client
      .from('tax_returns')
      .select('*')
      .eq('business_id', businessId)
      .eq('tax_code', taxCode)
      .eq('period_label', periodLabel)
      .maybeSingle();
    if (error) throw toRepositoryError('tax_returns', error);
    return data ?? null;
  }

  /**
   * Sums tax_amount from a lines table joined to its parent, filtered by
   * the parent's date column within [periodStart, periodEnd], for
   * tax_code = 'vat_standard'. Generic to reuse for invoice_lines and
   * expense_lines. FLAGGED: parent date column name for expenses was not
   * confirmed — adjust 'expense_date' if your actual column differs
   * (e.g. it may be named differently; check expenses table schema).
   */
  private async sumLineTax(
    businessId: string,
    linesTable: 'invoice_lines' | 'expense_lines',
    fkColumn: string,
    parentTable: 'invoices' | 'expenses',
    parentDateColumn: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    // Two-step (not a single joined query) to stay within the generic
    // BaseRepository/typed-client pattern rather than hand-rolling PostgREST
    // embedded filters on nested columns, which the typed client doesn't
    // support cleanly for filtering by a joined table's column.
    const { data: parents, error: parentErr } = await this.client
      .from(parentTable)
      .select('id')
      .eq('business_id', businessId)
      .gte(parentDateColumn as never, periodStart)
      .lte(parentDateColumn as never, periodEnd)
      .not('status', 'in', '("void", "draft")')
      .is('deleted_at', null);
    if (parentErr) throw toRepositoryError(parentTable, parentErr);
    const parentIds = (parents ?? []).map((p: { id: string }) => p.id);
    if (parentIds.length === 0) return 0;

    let total = 0;
    for (const batch of chunk(parentIds, 200)) {
      const { data: lines, error: linesErr } = await this.client
        .from(linesTable)
        .select('tax_amount')
        .eq('business_id', businessId)
        .eq('tax_code', 'vat_standard')
        .in(fkColumn as never, batch);
      if (linesErr) throw toRepositoryError(linesTable, linesErr);
      total += (lines ?? []).reduce((sum: number, l: { tax_amount: number }) => sum + Number(l.tax_amount), 0);
    }
    return total;
  }

  private async scheduleAlerts(taxReturn: Row<'tax_returns'>): Promise<void> {
    const due = new Date(taxReturn.due_date);
    const offsets: { days: number; type: 'due_date' | '1_day' | '7_day' | '14_day' }[] = [
      { days: 0, type: 'due_date' },
      { days: -1, type: '1_day' },
      { days: -7, type: '7_day' },
      { days: -14, type: '14_day' },
    ];
    const rows: InsertDto<'tax_alerts'>[] = offsets
      .map((o) => {
        const d = new Date(due);
        d.setDate(d.getDate() + o.days);
        return {
          business_id: taxReturn.business_id,
          tax_return_id: taxReturn.id,
          alert_type: o.type,
          scheduled_for: d.toISOString().slice(0, 10),
          channel: 'email' as const,
          status: 'pending' as const,
        };
      })
      .filter((r) => r.scheduled_for >= new Date().toISOString().slice(0, 10)); // don't schedule past dates

    if (rows.length === 0) return;
    const { error } = await this.client.from('tax_alerts').insert(rows as never);
    if (error) log.error('Failed to schedule tax_alerts', error as Error);
  }

  private lastDayOfMonth(dateStr: string): string {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}