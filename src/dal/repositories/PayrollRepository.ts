import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

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
}