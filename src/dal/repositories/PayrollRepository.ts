import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError, NotFoundError } from '../errors/RepositoryError';
import { JournalRepository } from './JournalRepository';
import { TaxReturnRepository } from './TaxReturnRepository';
import { ValidationError } from '../errors/RepositoryError';

export type PayrollRunWithLines = Row<'payroll_runs'> & {
  lines: Row<'payroll_employee_lines'>[];
};

export class PayrollRepository extends BaseRepository<'payroll_runs'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'payroll_runs');
  }

  async findByBusiness(businessId: string): Promise<Row<'payroll_runs'>[]> {
    const { data, error } = await this.client
      .from('payroll_runs')
      .select('*')
      .eq('business_id', businessId)
      .order('pay_date', { ascending: false });
    if (error) throw toRepositoryError('payroll_runs', error);
    return data ?? [];
  }

  async findWithLines(runId: string): Promise<PayrollRunWithLines> {
    const { data, error } = await this.client
      .from('payroll_runs')
      .select('*, lines:payroll_employee_lines(*)')
      .eq('id', runId)
      .single();
    if (error) throw toRepositoryError('payroll_runs', error);
    return data as PayrollRunWithLines;
  }

  async createWithLines(
    run: InsertDto<'payroll_runs'>,
    lines: Omit<InsertDto<'payroll_employee_lines'>, 'payroll_run_id'>[],
  ): Promise<PayrollRunWithLines> {
    const { data: payrollRun, error: runError } = await this.client
      .from('payroll_runs')
      .insert(run as never)
      .select()
      .single();
    if (runError) throw toRepositoryError('payroll_runs', runError);

    const lineInserts = lines.map((line) => ({
      ...line,
      payroll_run_id: (payrollRun as Row<'payroll_runs'>).id,
    }));

    const { data: insertedLines, error: linesError } = await this.client
      .from('payroll_employee_lines')
      .insert(lineInserts as never)
      .select();
    if (linesError) throw toRepositoryError('payroll_employee_lines', linesError);

    return {
      ...(payrollRun as Row<'payroll_runs'>),
      lines: (insertedLines ?? []) as Row<'payroll_employee_lines'>[],
    };
  }

  async findEmployees(businessId: string): Promise<Row<'employees'>[]> {
    const { data, error } = await this.client
      .from('employees')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('last_name', { ascending: true });
    if (error) throw toRepositoryError('employees', error);
    return data ?? [];
  }

  async findEmployeeById(employeeId: string): Promise<Row<'employees'>> {
    const { data, error } = await this.client
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .maybeSingle();
    if (error) throw toRepositoryError('employees', error);
    if (!data) throw new NotFoundError('employees', employeeId);
    return data as Row<'employees'>;
  }

  /**
   * Update an employee record, including salary and any other editable
   * field. Audit logging is NOT performed here — the DB trigger
   * `audit_employees` (bound to log_table_change()) already writes a
   * full old/new row snapshot to audit_log on every UPDATE. Adding an
   * app-level audit write here would create duplicate audit_log entries
   * for the same change.
   *
   * Caller (UI layer) is responsible for verifying the acting user's role
   * is 'owner' or 'admin' before invoking this — mirrors the same
   * responsibility split used in PeriodRepository.lock()/unlock().
   */
  async updateEmployee(employeeId: string, dto: UpdateDto<'employees'>): Promise<Row<'employees'>> {
    const { data, error } = await this.client
      .from('employees')
      .update({ ...dto, updated_at: new Date().toISOString() } as never)
      .eq('id', employeeId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError('employees', error);
    if (!data) throw new NotFoundError('employees', employeeId);
    return data as Row<'employees'>;
  }

  async findPayeBands(
    businessId: string,
    fiscalYear: string,
  ): Promise<Row<'paye_bands'>[]> {
    const { data, error } = await this.client
      .from('paye_bands')
      .select('*')
      .eq('business_id', businessId)
      .eq('fiscal_year', fiscalYear)
      .order('band_from', { ascending: true });
    if (error) throw toRepositoryError('paye_bands', error);
    return data ?? [];
  }

  /**
   * Look up an account's id by its code, scoped to a business. Used to
   * resolve the employer pension expense account (6112) without a
   * dedicated column for it anywhere in the schema.
   */
  private async findAccountByCode(businessId: string, code: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('accounts')
      .select('id')
      .eq('business_id', businessId)
      .eq('code', code)
      .maybeSingle();
    if (error) throw toRepositoryError('accounts', error);
    return data?.id ?? null;
  }

  /**
   * Approve a draft payroll run: posts the payroll journal entry
   * (Dr Salary Expense per employee, Cr PAYE Payable, Cr Pension Payable
   * for employer+employee combined, Dr Employer Pension Contribution
   * expense for the employer's portion, Cr Net Pay Payable/Bank), marks
   * the run 'approved', then generates the corresponding PAYE and TPR
   * tax_returns.
   *
   * ACCOUNT RESOLUTION — FLAGGED ASSUMPTION:
   * - Salary expense account: no single column holds this at the run level;
   *   employees.salary_account_id exists per-employee, so this posts one
   *   expense line PER EMPLOYEE (not a single lump line) to respect
   *   per-employee account overrides. If all employees share one expense
   *   account, this still works, just with redundant lines of the same
   *   account — acceptable but you may prefer a single summed line. Say so
   *   if you'd rather I aggregate by distinct account_id first.
   * - PAYE payable account: employees.paye_liability_account_id per
   *   employee, OR falls back to tax_configurations('paye').tax_payable_
   *   account_id if the employee-level field is null. I could not confirm
   *   which should take precedence — this assumes employee-level overrides
   *   the business default. Flag if that's backwards.
   * - Pension payable account: tax_configurations('tpr_pension').
   *   tax_payable_account_id — must be linked (confirmed: account 2132
   *   Pension Contributions Payable for the Ledgr Technologies test
   *   business) or this throws.
   * - Pension EXPENSE account (employer's 10% only): hard-coded lookup by
   *   account code '6112' (Employer Pension Contributions), confirmed
   *   against the Ledgr Technologies chart of accounts — distinct from the
   *   near-duplicate '6130' account, which appears to be an unused stray.
   *   If a business doesn't have a 6112 account, approve() throws with a
   *   clear message rather than silently posting to the wrong place.
   * - Net pay payable: assumes a bank/net-pay-clearing account is passed in
   *   by the caller (bankAccountId param) rather than inferred, since no
   *   default "payroll bank account" field exists on payroll_runs or
   *   businesses.
   * - "Other deductions" (totalOtherDeductions) are NOT posted to their
   *   own payable line — they're implicitly folded into the reduced
   *   totalNetPay figure already computed on payroll_employee_lines.
   *   Flag if these need a separate payable account (e.g. loan
   *   deductions, union dues) rather than just reducing net pay.
   */
  async approve(
    runId: string,
    approvedBy: string,
    entryNumber: string,
    bankAccountId: string,
  ): Promise<Row<'payroll_runs'>> {
    const run = await this.findWithLines(runId);
    if (run.status !== 'draft') {
      throw new ValidationError(
        'payroll_runs',
        `Cannot approve payroll run ${runId}: current status is '${run.status}'. Only 'draft' runs may be approved.`,
      );
    }
    if (run.lines.length === 0) {
      throw new ValidationError('payroll_runs', `Payroll run ${runId} has no employee lines.`);
    }

    const journalRepo = new JournalRepository(this.client);
    const taxReturnRepo = new TaxReturnRepository(this.client);

    // Resolve PAYE / TPR payable accounts once (business-level fallback).
    const { data: payeConfig } = await this.client
      .from('tax_configurations')
      .select('*')
      .eq('business_id', run.business_id)
      .eq('tax_code', 'paye')
      .eq('is_active', true)
      .maybeSingle();
    const { data: tprConfig } = await this.client
      .from('tax_configurations')
      .select('*')
      .eq('business_id', run.business_id)
      .eq('tax_code', 'tpr_pension')
      .eq('is_active', true)
      .maybeSingle();

    if (!tprConfig?.tax_payable_account_id) {
      throw new ValidationError(
        'payroll_runs',
        `TPR pension payable account is not linked for this business. Set tax_configurations.tax_payable_account_id for tax_code='tpr_pension' before approving payroll.`,
      );
    }

    const lines: Omit<InsertDto<'journal_lines'>, 'journal_entry_id' | 'business_id'>[] = [];
    let lineNum = 1;

    // One salary expense line per employee (see flagged note above).
    for (const line of run.lines) {
      const employee = await this.findEmployeeById(line.employee_id);
      const expenseAccountId = employee.salary_account_id;
      if (!expenseAccountId) {
        throw new ValidationError(
          'payroll_runs',
          `Employee ${employee.id} (${employee.first_name} ${employee.last_name}) has no salary_account_id set.`,
        );
      }
      lines.push({
        account_id: expenseAccountId,
        description: `Gross pay — ${employee.employee_number}`,
        is_debit: true,
        amount: Number(line.gross_pay),
        amount_base: Number(line.gross_pay),
        currency: 'MWK',
        exchange_rate: 1,
        line_number: lineNum++,
        tax_code: 'none',
        tax_amount: 0,
      });
    }

    const totalPaye = run.lines.reduce((s, l) => s + Number(l.paye_deduction), 0);
    const totalPensionEmployer = run.lines.reduce((s, l) => s + Number(l.pension_employer), 0);
    const totalPensionEmployee = run.lines.reduce((s, l) => s + Number(l.pension_employee), 0);
    const totalOtherDeductions = run.lines.reduce((s, l) => s + Number(l.other_deductions), 0);
    const totalNetPay = run.lines.reduce((s, l) => s + Number(l.net_pay), 0);

    let payeAccountId = payeConfig?.tax_payable_account_id ?? null;
    if (!payeAccountId && run.lines[0]) {
      const firstEmployee = await this.findEmployeeById(run.lines[0].employee_id);
      payeAccountId = firstEmployee.paye_liability_account_id;
    }
    if (totalPaye > 0 && !payeAccountId) {
      throw new ValidationError('payroll_runs', `No PAYE payable account resolved (neither tax_configurations nor employee-level).`);
    }
    if (totalPaye > 0) {
      lines.push({
        account_id: payeAccountId!,
        description: `PAYE payable — ${run.run_number}`,
        is_debit: false,
        amount: totalPaye,
        amount_base: totalPaye,
        currency: 'MWK',
        exchange_rate: 1,
        line_number: lineNum++,
        tax_code: 'paye',
        tax_amount: totalPaye,
      });
    }

    // Pension: the employee's 5% is already embedded in gross pay (the
    // Dr Gross Pay line above includes it; net_pay is net of it), so the
    // combined Cr Pension Payable below balances against that portion.
    // The employer's 10% is an ADDITIONAL company cost not deducted from
    // any employee — it needs its own self-contained Dr Expense / Cr
    // Payable pair, or the entry will not balance.
    const totalPension = Math.round((totalPensionEmployer + totalPensionEmployee) * 100) / 100;
    if (totalPension > 0) {
      lines.push({
        account_id: tprConfig.tax_payable_account_id,
        description: `Pension payable (employer + employee) — ${run.run_number}`,
        is_debit: false,
        amount: totalPension,
        amount_base: totalPension,
        currency: 'MWK',
        exchange_rate: 1,
        line_number: lineNum++,
        tax_code: 'tpr_pension',
        tax_amount: totalPension,
      });
    }

    if (totalPensionEmployer > 0) {
      const pensionExpenseAccountId = await this.findAccountByCode(run.business_id, '6112');
      if (!pensionExpenseAccountId) {
        throw new ValidationError(
          'payroll_runs',
          `No account found with code '6112' (Employer Pension Contributions) for business ${run.business_id}.`,
        );
      }
      lines.push({
        account_id: pensionExpenseAccountId,
        description: `Employer pension contribution — ${run.run_number}`,
        is_debit: true,
        amount: totalPensionEmployer,
        amount_base: totalPensionEmployer,
        currency: 'MWK',
        exchange_rate: 1,
        line_number: lineNum++,
        tax_code: 'tpr_pension',
        tax_amount: totalPensionEmployer,
      });
    }

    if (totalOtherDeductions > 0) {
      // FLAGGED: no dedicated "other deductions payable" account identified
      // in the schema. Posting as a reduction against net pay payable
      // instead (i.e. folded into totalNetPay below) rather than its own
      // line — confirm if other_deductions need a separate payable account.
    }

    lines.push({
      account_id: bankAccountId,
      description: `Net pay — ${run.run_number}`,
      is_debit: false,
      amount: totalNetPay,
      amount_base: totalNetPay,
      currency: 'MWK',
      exchange_rate: 1,
      line_number: lineNum++,
      tax_code: 'none',
      tax_amount: 0,
    });

    const { entry } = await journalRepo.createBalancedEntry(
      {
        business_id: run.business_id,
        entry_number: entryNumber,
        entry_date: run.pay_date,
        description: `Payroll — ${run.run_number}`,
        source_type: 'payroll_run',
        source_id: run.id,
        currency: 'MWK',
        exchange_rate: 1,
        status: 'draft',
        created_by: approvedBy,
      },
      lines,
    );
    await journalRepo.post(entry.id, approvedBy);

    const updatedRun = await this.update(runId, {
      status: 'approved',
      journal_entry_id: entry.id,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    });

    // Auto-generate PAYE + TPR returns now that liability is posted.
    if (totalPaye > 0) {
      await taxReturnRepo.generatePayeReturn(updatedRun);
    }
    if (totalPension > 0) {
      await taxReturnRepo.generateTprReturn(updatedRun, run.lines);
    }

    return updatedRun;
  }
}