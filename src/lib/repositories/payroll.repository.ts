import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { toRepositoryError, NotFoundError, ValidationError } from '@/dal/errors/RepositoryError';

export type PayrollFullCycleStatus = 'draft' | 'calculated' | 'approved' | 'posted' | 'reversed';
export type EmployeeStatus = 'active' | 'on_leave' | 'terminated' | 'suspended';

export interface PayrollPage<T> {
  rows: T[];
  count: number;
  page: number;
  pageSize: number;
}

export interface EmployeeFilters {
  status?: EmployeeStatus;
  department?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PayRunFilters {
  status?: PayrollFullCycleStatus;
  page?: number;
  pageSize?: number;
}

export interface TaxBandInput {
  band_number: number;
  lower_bound: number;
  upper_bound: number | null;
  rate: number;
  currency: string;
}

interface DbResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}

interface QueryBuilder extends PromiseLike<DbResult> {
  select(columns?: string, options?: Record<string, unknown>): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  or(filters: string): QueryBuilder;
  is(column: string, value: null | boolean): QueryBuilder;
  lt(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: Record<string, unknown>): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  limit(count: number): QueryBuilder;
  insert(values: unknown): QueryBuilder;
  update(values: unknown): QueryBuilder;
  upsert(values: unknown, options?: Record<string, unknown>): QueryBuilder;
  single(): Promise<DbResult>;
  maybeSingle(): Promise<DbResult>;
}

interface PayrollClient {
  from(table: string): QueryBuilder;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? data as T[] : [];
}

function asRow<T>(data: unknown): T {
  return data as T;
}

function throwIfError(table: string, error: unknown): void {
  if (error) throw toRepositoryError(table, error as never);
}

function pagination(page = 1, pageSize = 25): { page: number; pageSize: number; from: number; to: number } {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  return { page: safePage, pageSize: safePageSize, from: (safePage - 1) * safePageSize, to: safePage * safePageSize - 1 };
}

function isDateOnly(value: string): boolean {
  const parts = value.split('-');
  if (parts.length !== 3 || parts.some((part) => !part || [...part].some((char) => char < '0' || char > '9'))) return false;
  const [year, month, day] = parts.map(Number);
  if (parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Repository for Phase 6D full-cycle payroll tables. The Supabase client is
 * injected, as in the other data-access repositories. The narrow adapter is
 * used only for tables/RPCs added by this migration, which are not yet present
 * in the checked-in generated Supabase type snapshot.
 */
export class PayrollRepository {
  private readonly client: PayrollClient;

  constructor(client: SupabaseClient<Database>) {
    this.client = client as unknown as PayrollClient;
  }

  async getEmployees(businessId: string, filters: EmployeeFilters = {}): Promise<PayrollPage<Record<string, unknown>>> {
    const page = pagination(filters.page, filters.pageSize);
    let query = this.client.from('employees').select('*, contracts:employee_contracts(*)', { count: 'exact' }).eq('business_id', businessId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.department) query = query.eq('department', filters.department);
    const search = filters.search?.trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').slice(0, 80);
    if (search) {
      const searchFilters = [
        `first_name.ilike.%${search}%`,
        `last_name.ilike.%${search}%`,
        `employee_number.ilike.%${search}%`,
      ];
      const nameParts = search.split(' ');
      if (nameParts.length > 1) {
        const givenNames = nameParts[0];
        const familyNames = nameParts.slice(1).join(' ');
        searchFilters.push(`and(first_name.ilike.%${givenNames}%,last_name.ilike.%${familyNames}%)`);
        searchFilters.push(`and(first_name.ilike.%${familyNames}%,last_name.ilike.%${givenNames}%)`);
      }
      query = query.or(searchFilters.join(','));
    }
    const { data, error, count } = await query.order('last_name', { ascending: true }).range(page.from, page.to);
    throwIfError('employees', error);
    return { rows: asRows(data), count: count ?? 0, page: page.page, pageSize: page.pageSize };
  }

  async getEmployee(businessId: string, employeeId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.from('employees')
      .select('*, contracts:employee_contracts(*), components:employee_pay_components(*, pay_component:pay_components(*))')
      .eq('business_id', businessId).eq('id', employeeId).maybeSingle();
    throwIfError('employees', error);
    if (!data) throw new NotFoundError('employees', employeeId);
    return asRow(data);
  }

  async createEmployee(businessId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const employeeNumber = typeof data.employee_number === 'string' && data.employee_number.trim()
      ? data.employee_number.trim()
      : await this.nextEmployeeNumber(businessId);
    const hireDate = String(data.hire_date ?? data.start_date ?? new Date().toISOString().slice(0, 10));
    const currency = String(data.currency ?? await this.getBusinessCurrency(businessId));
    const grossSalary = Number(data.gross_salary ?? 0);
    if (!String(data.first_name ?? '').trim() || !String(data.last_name ?? '').trim()) {
      throw new ValidationError('employees', 'First name and last name are required.');
    }
    if (!Number.isFinite(grossSalary) || grossSalary < 0) {
      throw new ValidationError('employees', 'Gross salary must be a valid non-negative amount.');
    }

    const employeeValues = {
      business_id: businessId,
      employee_number: employeeNumber,
      first_name: String(data.first_name).trim(),
      last_name: String(data.last_name).trim(),
      national_id: data.national_id ?? null,
      tax_id: data.tax_id ?? data.tpin ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      department: data.department ?? null,
      job_title: data.job_title ?? null,
      hire_date: hireDate,
      start_date: data.start_date ?? hireDate,
      termination_date: data.termination_date ?? null,
      end_date: data.end_date ?? data.termination_date ?? null,
      status: data.status ?? 'active',
      employment_type: data.contract_type ?? data.employment_type ?? 'permanent',
      pay_frequency: data.pay_frequency ?? 'monthly',
      gross_salary: grossSalary,
      currency,
      payment_method: data.payment_method ?? 'bank_transfer',
      tax_exempt: data.tax_exempt ?? false,
      is_active: data.is_active ?? true,
      bank_name: data.bank_name ?? null,
      bank_account_number: data.bank_account_number ?? null,
      created_by: data.created_by ?? null,
    };
    const { data: created, error } = await this.client.from('employees').insert(employeeValues).select('*').single();
    throwIfError('employees', error);
    const employee = asRow<Record<string, unknown>>(created);

    if (grossSalary > 0) {
      const contract = {
        business_id: businessId,
        employee_id: employee.id,
        effective_from: hireDate,
        pay_frequency: employeeValues.pay_frequency,
        gross_salary: grossSalary,
        currency,
        contract_type: employeeValues.employment_type === 'contract' || employeeValues.employment_type === 'casual'
          ? employeeValues.employment_type : 'permanent',
        notes: data.contract_notes ?? null,
      };
      const { error: contractError } = await this.client.from('employee_contracts').insert(contract);
      throwIfError('employee_contracts', contractError);
    }
    return employee;
  }

  async updateEmployee(
    businessId: string,
    employeeId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const contractEffectiveFrom = data.contract_effective_from;
    const employeeData = { ...data };
    delete employeeData.contract_effective_from;
    if (contractEffectiveFrom != null && (typeof contractEffectiveFrom !== 'string' || !isDateOnly(contractEffectiveFrom))) {
      throw new ValidationError('employee_contracts', 'Contract effective date must be a valid date.');
    }
    if (Object.prototype.hasOwnProperty.call(employeeData, 'gross_salary')) {
      const salary = Number(employeeData.gross_salary);
      if (employeeData.gross_salary == null || String(employeeData.gross_salary).trim() === '' || !Number.isFinite(salary) || salary < 0) {
        throw new ValidationError('employees', 'Gross salary must be a valid non-negative amount.');
      }
    }
    const contractFields = ['gross_salary', 'currency', 'pay_frequency', 'employment_type'];
    const hasContractFields = contractFields.some((field) => Object.prototype.hasOwnProperty.call(employeeData, field));
    let contractChanged = false;
    if (hasContractFields) {
      const { data: current, error: currentError } = await this.client.from('employees').select('*')
        .eq('business_id', businessId).eq('id', employeeId).maybeSingle();
      throwIfError('employees', currentError);
      if (!current) throw new NotFoundError('employees', employeeId);
      const currentEmployee = asRow<Record<string, unknown>>(current);
      contractChanged = contractFields.some((field) => {
        if (!Object.prototype.hasOwnProperty.call(employeeData, field)) return false;
        if (field === 'gross_salary') return Number(currentEmployee[field] ?? 0) !== Number(employeeData[field] ?? 0);
        return String(currentEmployee[field] ?? '') !== String(employeeData[field] ?? '');
      });
    }
    const { data: updated, error } = await this.client.from('employees')
      .update({ ...employeeData, updated_at: new Date().toISOString() })
      .eq('business_id', businessId).eq('id', employeeId).select('*').maybeSingle();
    throwIfError('employees', error);
    if (!updated) throw new NotFoundError('employees', employeeId);
    const employee = asRow<Record<string, unknown>>(updated);
    if (contractChanged) {
      const salary = Number(employee.gross_salary ?? 0);
      if (!Number.isFinite(salary) || salary < 0) {
        throw new ValidationError('employees', 'Gross salary must be a valid non-negative amount.');
      }
      const effectiveFrom = String(contractEffectiveFrom ?? employee.hire_date ?? employee.start_date ?? '');
      if (effectiveFrom && !isDateOnly(effectiveFrom)) {
        throw new ValidationError('employee_contracts', 'Contract effective date must be a valid date.');
      }
      if (effectiveFrom) {
        const contractType = employee.employment_type === 'contract' || employee.employment_type === 'casual'
          ? employee.employment_type : 'permanent';
        const { error: contractError } = await this.client.from('employee_contracts').upsert({
          business_id: businessId,
          employee_id: employeeId,
          effective_from: effectiveFrom,
          pay_frequency: employee.pay_frequency ?? 'monthly',
          gross_salary: salary,
          currency: employee.currency ?? await this.getBusinessCurrency(businessId),
          contract_type: contractType,
        }, { onConflict: 'business_id,employee_id,effective_from' });
        throwIfError('employee_contracts', contractError);

        const previousDay = new Date(`${effectiveFrom}T00:00:00Z`);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        const { error: closeError } = await this.client.from('employee_contracts')
          .update({ effective_to: previousDay.toISOString().slice(0, 10) })
          .eq('business_id', businessId).eq('employee_id', employeeId)
          .is('effective_to', null).lt('effective_from', effectiveFrom);
        throwIfError('employee_contracts', closeError);
      }
    }
    return employee;
  }

  async getPayComponents(businessId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client.from('pay_components').select('*')
      .eq('business_id', businessId).eq('is_active', true).order('sort_order', { ascending: true });
    throwIfError('pay_components', error);
    return asRows(data);
  }

  async addPayComponentOverride(
    businessId: string,
    employeeId: string,
    componentId: string,
    data: {
      override_amount?: number | null;
      override_rate?: number | null;
      effective_from: string;
      effective_to?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    const amount = data.override_amount ?? null;
    const rate = data.override_rate ?? null;
    if ((amount !== null && (!Number.isFinite(amount) || amount < 0))
      || (rate !== null && (!Number.isFinite(rate) || rate < 0))
      || (amount === null && rate === null)
      || !isDateOnly(data.effective_from)
      || (data.effective_to != null && (!isDateOnly(data.effective_to) || data.effective_to < data.effective_from))) {
      throw new ValidationError('employee_pay_components', 'Enter a valid override and effective date range.');
    }
    const { data: created, error } = await this.client.from('employee_pay_components')
      .insert({
        business_id: businessId,
        employee_id: employeeId,
        pay_component_id: componentId,
        override_amount: amount,
        override_rate: rate,
        effective_from: data.effective_from,
        effective_to: data.effective_to ?? null,
      }).select('*').single();
    throwIfError('employee_pay_components', error);
    return asRow(created);
  }

  async getTaxBands(businessId: string, fiscalYear: number): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client.from('tax_bands').select('*')
      .eq('business_id', businessId).eq('fiscal_year', fiscalYear).order('band_number', { ascending: true });
    throwIfError('tax_bands', error);
    return asRows(data);
  }

  async updateTaxBands(businessId: string, fiscalYear: number, bands: TaxBandInput[]): Promise<Record<string, unknown>[]> {
    if (bands.length === 0) throw new ValidationError('tax_bands', 'At least one tax band is required.');
    const ordered = [...bands].sort((a, b) => a.band_number - b.band_number);
    for (let index = 0; index < ordered.length; index += 1) {
      const band = ordered[index];
      if (!Number.isInteger(band.band_number) || band.band_number !== index + 1
        || !Number.isFinite(band.lower_bound) || !Number.isFinite(band.rate)
        || band.lower_bound < 0 || band.rate < 0 || band.rate > 1
        || (index === 0 && band.lower_bound !== 0)
        || (band.upper_bound !== null && (!Number.isFinite(band.upper_bound) || band.upper_bound <= band.lower_bound))) {
        throw new ValidationError('tax_bands', 'Tax bands must have sequential numbers, valid bounds, and rates from zero to one.');
      }
      if (index > 0 && ordered[index - 1].upper_bound !== band.lower_bound) {
        throw new ValidationError('tax_bands', 'Each tax band must begin at the previous band’s upper bound.');
      }
    }
    if (ordered[ordered.length - 1].upper_bound !== null) {
      throw new ValidationError('tax_bands', 'The final tax band must have no upper bound.');
    }
    const values = ordered.map((band) => ({ ...band, business_id: businessId, fiscal_year: fiscalYear }));
    // Upsert submitted bands only. Existing rows omitted from this editor are
    // intentionally preserved: tax configuration must never delete stored bands.
    const { data, error } = await this.client.from('tax_bands').upsert(values, {
      onConflict: 'business_id,fiscal_year,band_number',
    }).select('*');
    throwIfError('tax_bands', error);
    return asRows(data);
  }

  async getPayRuns(businessId: string, filters: PayRunFilters = {}): Promise<PayrollPage<Record<string, unknown>>> {
    const page = pagination(filters.page, filters.pageSize);
    let query = this.client.from('pay_runs').select('*', { count: 'exact' }).eq('business_id', businessId);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error, count } = await query.order('period_end', { ascending: false }).range(page.from, page.to);
    throwIfError('pay_runs', error);
    return { rows: asRows(data), count: count ?? 0, page: page.page, pageSize: page.pageSize };
  }

  async getPayRun(businessId: string, payRunId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.from('pay_runs')
      .select('*, lines:pay_run_lines(*, employee:employees(*), components:pay_run_component_details(*, pay_component:pay_components(*)))')
      .eq('business_id', businessId).eq('id', payRunId).maybeSingle();
    throwIfError('pay_runs', error);
    if (!data) throw new NotFoundError('pay_runs', payRunId);
    return asRow(data);
  }

  async getPayRunByPeriod(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client.from('pay_runs').select('*')
      .eq('business_id', businessId).eq('period_start', periodStart).eq('period_end', periodEnd).maybeSingle();
    throwIfError('pay_runs', error);
    return data ? asRow(data) : null;
  }

  async approvePayRun(businessId: string, payRunId: string): Promise<Record<string, unknown>> {
    const now = new Date().toISOString();
    const { data, error } = await this.client.from('pay_runs')
      .update({ status: 'approved', approved_at: now, updated_at: now })
      .eq('business_id', businessId).eq('id', payRunId).eq('status', 'calculated')
      .select('*').maybeSingle();
    throwIfError('pay_runs', error);
    if (!data) throw new ValidationError('pay_runs', 'Only a calculated pay run can be approved.');
    return asRow(data);
  }

  async calculatePayRun(businessId: string, periodStart: string, periodEnd: string, payDate: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.rpc('calculate_pay_run', {
      p_business_id: businessId, p_period_start: periodStart, p_period_end: periodEnd, p_pay_date: payDate,
    });
    throwIfError('pay_runs', error);
    return asRow(data);
  }

  async postPayRun(payRunId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.rpc('post_pay_run', { p_pay_run_id: payRunId });
    throwIfError('pay_runs', error);
    return asRow(data);
  }

  async reversePayRun(payRunId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.rpc('reverse_pay_run', { p_pay_run_id: payRunId });
    throwIfError('pay_runs', error);
    return asRow(data);
  }

  async getLeaveTypes(businessId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client.from('leave_types').select('*')
      .eq('business_id', businessId).eq('is_active', true).order('code', { ascending: true });
    throwIfError('leave_types', error);
    return asRows(data);
  }

  async getLeaveBalances(businessId: string, employeeId: string, year: number): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client.from('leave_balances')
      .select('*, leave_type:leave_types(*)')
      .eq('business_id', businessId).eq('employee_id', employeeId).eq('year', year);
    throwIfError('leave_balances', error);
    return asRows(data);
  }

  async accrueLeave(businessId: string, year: number, month: number): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.rpc('accrue_leave', {
      p_business_id: businessId, p_year: year, p_month: month,
    });
    throwIfError('leave_balances', error);
    return asRow(data);
  }

  private async nextEmployeeNumber(businessId: string): Promise<string> {
    const { data, error } = await this.client.from('employees').select('employee_number').eq('business_id', businessId);
    throwIfError('employees', error);
    const highest = asRows<{ employee_number: string }>(data).reduce((current, row) => {
      const match = /^EMP-(\d+)$/.exec(row.employee_number);
      return Math.max(current, match ? Number(match[1]) : 0);
    }, 0);
    return `EMP-${String(highest + 1).padStart(4, '0')}`;
  }

  private async getBusinessCurrency(businessId: string): Promise<string> {
    const { data, error } = await this.client.from('businesses').select('base_currency').eq('id', businessId).maybeSingle();
    throwIfError('businesses', error);
    return String((data as { base_currency?: string } | null)?.base_currency ?? 'MWK');
  }
}
