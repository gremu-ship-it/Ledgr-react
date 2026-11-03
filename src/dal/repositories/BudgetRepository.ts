import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { toRepositoryError } from '../errors/RepositoryError';

export type BudgetStatus = 'draft' | 'active' | 'closed';
export type BudgetAccountType = 'income' | 'expense';

type BudgetLineRow = Row<'budget_lines'>;
type BudgetRow = Row<'budgets'>;
type MonthlyBudgetFields = Pick<BudgetLineRow,
  | 'm01_amount' | 'm02_amount' | 'm03_amount' | 'm04_amount'
  | 'm05_amount' | 'm06_amount' | 'm07_amount' | 'm08_amount'
  | 'm09_amount' | 'm10_amount' | 'm11_amount' | 'm12_amount'
>;

const MONTH_FIELDS = [
  'm01_amount', 'm02_amount', 'm03_amount', 'm04_amount',
  'm05_amount', 'm06_amount', 'm07_amount', 'm08_amount',
  'm09_amount', 'm10_amount', 'm11_amount', 'm12_amount',
] as const;

export interface BudgetLineInput {
  accountId: string;
  amount: number;
  notes?: string | null;
}

export interface BudgetLineUpdate {
  accountId?: string;
  amount: number;
  notes?: string | null;
}

export interface BudgetCreateInput {
  name: string;
  periodStart: string;
  periodEnd: string;
  notes?: string | null;
  createdBy?: string | null;
  lines?: BudgetLineInput[];
}

export interface BudgetUpdateInput {
  name?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string | null;
}

export interface BudgetFilters {
  status?: BudgetStatus;
  periodStart?: string;
  periodEnd?: string;
}

export interface BudgetLineWithAccount extends BudgetLineRow {
  account: Pick<Row<'accounts'>, 'id' | 'code' | 'name' | 'account_type'>;
}

export interface BudgetListItem extends BudgetRow {
  total_budgeted: number;
}

export interface BudgetWithLines extends BudgetRow {
  lines: BudgetLineWithAccount[];
}

export interface BudgetVsActualRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: BudgetAccountType;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
}

export interface BudgetVarianceSummary {
  incomeBudgeted: number;
  incomeActual: number;
  incomeVariance: number;
  expenseBudgeted: number;
  expenseActual: number;
  expenseVariance: number;
  netBudgeted: number;
  netActual: number;
  netVariance: number;
}

interface JournalLineActual {
  account_id: string;
  is_debit: boolean;
  amount_base: number;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthCount(periodStart: string, periodEnd: string): number {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth() + 1;
}

function validatePeriod(periodStart: string, periodEnd: string): number {
  if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) {
    throw new Error('A valid budget period is required.');
  }
  const count = monthCount(periodStart, periodEnd);
  if (count < 1 || count > 12) {
    throw new Error('Budget periods must cover between one and twelve calendar months.');
  }
  return count;
}

function validateAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Budget amounts must be zero or greater.');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function buildMonthlyAmounts(amount: number, count: number): MonthlyBudgetFields {
  const total = validateAmount(amount);
  const share = Math.floor((total / count + Number.EPSILON) * 100) / 100;
  const values = Array.from({ length: 12 }, (_, index) => index < count ? share : 0);
  values[count - 1] = Math.round((total - share * (count - 1) + Number.EPSILON) * 100) / 100;
  return Object.fromEntries(MONTH_FIELDS.map((field, index) => [field, values[index]])) as MonthlyBudgetFields;
}

function monthOffset(periodStart: string, date: string): number {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const value = new Date(`${date}T00:00:00.000Z`);
  return (value.getUTCFullYear() - start.getUTCFullYear()) * 12 + value.getUTCMonth() - start.getUTCMonth();
}

function budgetAmountForPeriod(line: BudgetLineRow, budget: BudgetRow, from: string, to: string): number {
  const startOffset = Math.max(0, monthOffset(budget.period_start, from));
  const endOffset = Math.min(11, monthOffset(budget.period_start, to));
  if (endOffset < startOffset) return 0;
  return MONTH_FIELDS.slice(startOffset, endOffset + 1)
    .reduce((sum, field) => sum + Number(line[field] ?? 0), 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Tenant-scoped budget management and reversed-entry-safe budget variance reporting. */
export class BudgetRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async list(businessId: string, filters: BudgetFilters = {}): Promise<BudgetListItem[]> {
    let query = this.client
      .from('budgets')
      .select('*, budget_lines(annual_total)')
      .eq('business_id', businessId)
      .order('period_start', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.periodStart) query = query.gte('period_end', filters.periodStart);
    if (filters.periodEnd) query = query.lte('period_start', filters.periodEnd);
    const { data, error } = await query;
    if (error) throw toRepositoryError('budgets', error);
    return (data ?? []).map((raw) => {
      const item = raw as unknown as BudgetRow & { budget_lines?: Array<{ annual_total: number | null }> };
      return {
        ...item,
        total_budgeted: (item.budget_lines ?? []).reduce((sum, line) => sum + Number(line.annual_total ?? 0), 0),
      };
    });
  }

  async getById(businessId: string, budgetId: string): Promise<BudgetWithLines | null> {
    const { data, error } = await this.client
      .from('budgets')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', budgetId)
      .maybeSingle();
    if (error) throw toRepositoryError('budgets', error);
    if (!data) return null;

    const { data: lines, error: linesError } = await this.client
      .from('budget_lines')
      .select('*, accounts!inner(id, code, name, account_type)')
      .eq('business_id', businessId)
      .eq('budget_id', budgetId)
      .order('created_at', { ascending: true });
    if (linesError) throw toRepositoryError('budget_lines', linesError);
    return {
      ...data,
      lines: (lines ?? []).map((line) => {
        const { accounts, ...rest } = line as unknown as BudgetLineRow & {
          accounts: BudgetLineWithAccount['account'];
        };
        return { ...rest, account: accounts };
      }),
    };
  }

  async create(businessId: string, input: BudgetCreateInput): Promise<BudgetWithLines> {
    const name = input.name.trim();
    if (!name) throw new Error('Budget name is required.');
    const months = validatePeriod(input.periodStart, input.periodEnd);
    const header: Database['public']['Tables']['budgets']['Insert'] = {
      business_id: businessId,
      name,
      fiscal_year: input.periodStart.slice(0, 4),
      period_start: input.periodStart,
      period_end: input.periodEnd,
      notes: input.notes?.trim() || null,
      created_by: input.createdBy ?? null,
      status: 'draft',
      is_active: false,
    };
    const { data: budget, error } = await this.client
      .from('budgets')
      .insert(header)
      .select('*')
      .single();
    if (error) throw toRepositoryError('budgets', error);

    try {
      for (const line of input.lines ?? []) {
        await this.insertLine(businessId, budget, line, months);
      }
    } catch (error) {
      await this.client.from('budget_lines').delete().eq('business_id', businessId).eq('budget_id', budget.id);
      await this.client.from('budgets').delete().eq('business_id', businessId).eq('id', budget.id);
      throw error;
    }
    const created = await this.getById(businessId, budget.id);
    if (!created) throw new Error('Created budget could not be read.');
    return created;
  }

  async update(businessId: string, budgetId: string, updates: BudgetUpdateInput): Promise<BudgetRow> {
    const current = await this.requireBudget(businessId, budgetId);
    const periodStart = updates.periodStart ?? current.period_start;
    const periodEnd = updates.periodEnd ?? current.period_end;
    const count = validatePeriod(periodStart, periodEnd);
    const dto: Database['public']['Tables']['budgets']['Update'] = {};
    if (updates.name !== undefined) {
      if (!updates.name.trim()) throw new Error('Budget name is required.');
      dto.name = updates.name.trim();
    }
    if (updates.notes !== undefined) dto.notes = updates.notes?.trim() || null;
    if (updates.periodStart !== undefined || updates.periodEnd !== undefined) {
      dto.period_start = periodStart;
      dto.period_end = periodEnd;
      dto.fiscal_year = periodStart.slice(0, 4);
    }
    const { data, error } = await this.client
      .from('budgets')
      .update(dto)
      .eq('business_id', businessId)
      .eq('id', budgetId)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError('budgets', error);
    if (!data) throw new Error('Only draft budgets can be edited.');

    if (updates.periodStart !== undefined || updates.periodEnd !== undefined) {
      const { data: lines, error: lineError } = await this.client
        .from('budget_lines')
        .select('id, annual_total')
        .eq('business_id', businessId)
        .eq('budget_id', budgetId);
      if (lineError) throw toRepositoryError('budget_lines', lineError);
      for (const line of lines ?? []) {
        const { error: updateLineError } = await this.client
          .from('budget_lines')
          .update(buildMonthlyAmounts(Number(line.annual_total ?? 0), count))
          .eq('business_id', businessId)
          .eq('budget_id', budgetId)
          .eq('id', line.id);
        if (updateLineError) throw toRepositoryError('budget_lines', updateLineError);
      }
    }
    return data;
  }

  async addLine(businessId: string, budgetId: string, line: BudgetLineInput): Promise<BudgetLineRow> {
    const budget = await this.requireBudget(businessId, budgetId);
    return this.insertLine(businessId, budget, line, validatePeriod(budget.period_start, budget.period_end));
  }

  async updateLine(
    businessId: string,
    budgetId: string,
    lineId: string,
    updates: BudgetLineUpdate,
  ): Promise<BudgetLineRow> {
    const budget = await this.requireBudget(businessId, budgetId);
    const count = validatePeriod(budget.period_start, budget.period_end);
    const amount = validateAmount(updates.amount);
    if (updates.accountId) await this.assertBudgetAccount(businessId, updates.accountId);
    const { data, error } = await this.client
      .from('budget_lines')
      .update({ ...(updates.accountId ? { account_id: updates.accountId } : {}), ...buildMonthlyAmounts(amount, count), ...(updates.notes !== undefined ? { notes: updates.notes?.trim() || null } : {}) })
      .eq('business_id', businessId)
      .eq('budget_id', budgetId)
      .eq('id', lineId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError('budget_lines', error);
    if (!data) throw new Error('Budget line was not found or the budget is no longer editable.');
    return data;
  }

  async removeLine(businessId: string, lineId: string): Promise<void> {
    const { data: line, error: lineError } = await this.client
      .from('budget_lines')
      .select('id, budget_id')
      .eq('business_id', businessId)
      .eq('id', lineId)
      .maybeSingle();
    if (lineError) throw toRepositoryError('budget_lines', lineError);
    if (!line) throw new Error('Budget line was not found.');
    await this.requireBudget(businessId, line.budget_id);
    const { error } = await this.client
      .from('budget_lines')
      .delete()
      .eq('business_id', businessId)
      .eq('id', lineId);
    if (error) throw toRepositoryError('budget_lines', error);
  }

  async setBudgetStatus(businessId: string, budgetId: string, status: BudgetStatus): Promise<BudgetRow> {
    const current = await this.getBudgetRecord(businessId, budgetId);
    const validTransition = (current.status === 'draft' && status === 'active')
      || (current.status === 'active' && status === 'closed');
    if (!validTransition) throw new Error('Budgets can only move from draft to active and active to closed.');
    const { data, error } = await this.client
      .from('budgets')
      .update({ status, is_active: status === 'active' })
      .eq('business_id', businessId)
      .eq('id', budgetId)
      .eq('status', current.status)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError('budgets', error);
    if (!data) throw new Error('Budget status changed before this update could be saved.');
    return data;
  }

  async getBudgetVsActual(
    businessId: string,
    budgetId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<BudgetVsActualRow[]> {
    if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) {
      throw new Error('A valid report period is required.');
    }
    const budget = await this.getBudgetRecord(businessId, budgetId);
    if (periodStart < budget.period_start || periodEnd > budget.period_end) {
      throw new Error('The report period must be within the budget period.');
    }
    const { data: rawLines, error: lineError } = await this.client
      .from('budget_lines')
      .select('*, accounts!inner(id, code, name, account_type)')
      .eq('business_id', businessId)
      .eq('budget_id', budgetId);
    if (lineError) throw toRepositoryError('budget_lines', lineError);
    const lines = (rawLines ?? []).map((line) => {
      const { accounts, ...rest } = line as unknown as BudgetLineRow & { accounts: BudgetLineWithAccount['account'] };
      return { ...rest, account: accounts };
    }).filter((line) => line.account.account_type === 'income' || line.account.account_type === 'expense');
    const accountIds = lines.map((line) => line.account_id);
    const actuals = new Map<string, number>();
    if (accountIds.length) {
      const { data, error } = await this.client
        .from('journal_lines')
        .select('account_id, is_debit, amount_base, journal_entries!inner(entry_date, status, business_id, reversal_of)')
        .eq('business_id', businessId)
        .eq('journal_entries.business_id', businessId)
        .eq('journal_entries.status', 'posted')
        .neq('journal_entries.status', 'reversed')
        .is('journal_entries.reversal_of', null)
        .in('account_id', accountIds)
        .gte('journal_entries.entry_date', periodStart)
        .lte('journal_entries.entry_date', periodEnd);
      if (error) throw toRepositoryError('journal_lines', error);
      for (const line of (data ?? []) as unknown as JournalLineActual[]) {
        const amount = Number(line.amount_base) * (line.is_debit ? 1 : -1);
        actuals.set(line.account_id, (actuals.get(line.account_id) ?? 0) + amount);
      }
    }
    return lines.map((line) => {
      const accountType = line.account.account_type as BudgetAccountType;
      const rawActual = actuals.get(line.account_id) ?? 0;
      const actual = roundMoney(accountType === 'income' ? -rawActual : rawActual);
      const budgeted = roundMoney(budgetAmountForPeriod(line, budget, periodStart, periodEnd));
      const variance = roundMoney(actual - budgeted);
      return {
        accountId: line.account_id,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType,
        budgeted,
        actual,
        variance,
        variancePercent: budgeted === 0 ? null : roundMoney((variance / budgeted) * 100),
      };
    }).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  async getVarianceSummary(
    businessId: string,
    budgetId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<BudgetVarianceSummary> {
    const rows = await this.getBudgetVsActual(businessId, budgetId, periodStart, periodEnd);
    const income = rows.filter((row) => row.accountType === 'income');
    const expenses = rows.filter((row) => row.accountType === 'expense');
    const incomeBudgeted = roundMoney(income.reduce((sum, row) => sum + row.budgeted, 0));
    const incomeActual = roundMoney(income.reduce((sum, row) => sum + row.actual, 0));
    const expenseBudgeted = roundMoney(expenses.reduce((sum, row) => sum + row.budgeted, 0));
    const expenseActual = roundMoney(expenses.reduce((sum, row) => sum + row.actual, 0));
    const netBudgeted = roundMoney(incomeBudgeted - expenseBudgeted);
    const netActual = roundMoney(incomeActual - expenseActual);
    return {
      incomeBudgeted,
      incomeActual,
      incomeVariance: roundMoney(incomeActual - incomeBudgeted),
      expenseBudgeted,
      expenseActual,
      expenseVariance: roundMoney(expenseActual - expenseBudgeted),
      netBudgeted,
      netActual,
      netVariance: roundMoney(netActual - netBudgeted),
    };
  }

  private async getBudgetRecord(businessId: string, budgetId: string): Promise<BudgetRow> {
    const { data, error } = await this.client
      .from('budgets')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', budgetId)
      .maybeSingle();
    if (error) throw toRepositoryError('budgets', error);
    if (!data) throw new Error('Budget was not found.');
    return data;
  }

  private async requireBudget(businessId: string, budgetId: string): Promise<BudgetRow> {
    const budget = await this.getBudgetRecord(businessId, budgetId);
    if (budget.status !== 'draft') throw new Error('Only draft budgets can be edited.');
    return budget;
  }

  private async assertBudgetAccount(businessId: string, accountId: string): Promise<void> {
    const { data: account, error } = await this.client
      .from('accounts')
      .select('id, business_id, account_type')
      .eq('business_id', businessId)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw toRepositoryError('accounts', error);
    if (!account || (account.account_type !== 'income' && account.account_type !== 'expense')) {
      throw new Error('Budget lines may only use income or expense accounts.');
    }
  }

  private async insertLine(
    businessId: string,
    budget: BudgetRow,
    line: BudgetLineInput,
    months: number,
  ): Promise<BudgetLineRow> {
    if (budget.status !== 'draft') throw new Error('Only draft budgets can be edited.');
    const amount = validateAmount(line.amount);
    const { data: account, error: accountError } = await this.client
      .from('accounts')
      .select('id, business_id, account_type')
      .eq('business_id', businessId)
      .eq('id', line.accountId)
      .maybeSingle();
    if (accountError) throw toRepositoryError('accounts', accountError);
    if (!account || (account.account_type !== 'income' && account.account_type !== 'expense')) {
      throw new Error('Budget lines may only use income or expense accounts.');
    }
    const dto: Database['public']['Tables']['budget_lines']['Insert'] = {
      business_id: businessId,
      budget_id: budget.id,
      account_id: line.accountId,
      ...buildMonthlyAmounts(amount, months),
      notes: line.notes?.trim() || null,
    };
    const { data, error } = await this.client.from('budget_lines').insert(dto).select('*').single();
    if (error) throw toRepositoryError('budget_lines', error);
    return data;
  }
}
