import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetRepository } from '@/dal/repositories/BudgetRepository';

interface MockResult { data: unknown; error?: { message: string } | null; }
type Handler = (table: string, action: string, payload: unknown, calls: Array<[string, ...unknown[]]>) => MockResult;

function createClient(handler: Handler) {
  const calls: Array<[string, ...unknown[]]> = [];
  const client = {
    from(table: string) {
      let action = 'select';
      let payload: unknown;
      const builder: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        calls.push([table, method, ...args]);
        if (method === 'insert' || method === 'update' || method === 'delete') {
          action = method;
          payload = args[0];
        }
        return builder;
      };
      for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'neq', 'is', 'order', 'range']) builder[method] = chain(method);
      builder.insert = chain('insert');
      builder.update = chain('update');
      builder.delete = chain('delete');
      builder.single = async () => {
        const result = handler(table, action, payload, calls);
        return { data: Array.isArray(result.data) ? result.data[0] : result.data, error: result.error ?? null };
      };
      builder.maybeSingle = builder.single;
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(handler(table, action, payload, calls)).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as never, calls };
}

const budget = {
  id: 'budget-1', business_id: 'biz-1', name: 'FY 2026', fiscal_year: '2026',
  period_start: '2026-01-01', period_end: '2026-12-31', status: 'active', is_active: true,
  created_at: '2026-01-01T00:00:00.000Z', created_by: 'user-1', updated_at: '2026-01-01T00:00:00.000Z', notes: null,
};
const budgetLine = (accountId: string, accountType: 'income' | 'expense', amount: number) => ({
  id: `line-${accountId}`, business_id: 'biz-1', budget_id: 'budget-1', account_id: accountId,
  annual_total: amount * 12, m01_amount: amount, m02_amount: amount, m03_amount: amount, m04_amount: amount,
  m05_amount: amount, m06_amount: amount, m07_amount: amount, m08_amount: amount,
  m09_amount: amount, m10_amount: amount, m11_amount: amount, m12_amount: amount,
  branch_id: null, department_id: null, created_at: '2026-01-01T00:00:00.000Z', notes: null,
  accounts: { id: accountId, code: accountType === 'income' ? '4000' : '5000', name: accountType, account_type: accountType },
});

describe('BudgetRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists tenant budgets and calculates their budgeted totals', async () => {
    const { client, calls } = createClient((table, action) => table === 'budgets' && action === 'select'
      ? { data: [{ ...budget, status: 'draft', budget_lines: [{ annual_total: 100 }, { annual_total: 250 }] }] }
      : { data: [] });
    const repo = new BudgetRepository(client);
    const result = await repo.list('biz-1', { status: 'draft' });
    expect(result[0].total_budgeted).toBe(350);
    expect(calls).toContainEqual(['budgets', 'eq', 'business_id', 'biz-1']);
    expect(calls).toContainEqual(['budgets', 'eq', 'status', 'draft']);
  });

  it('creates a draft budget and allocates its line amount into the schema monthly buckets', async () => {
    const inserted: unknown[] = [];
    const { client } = createClient((table, action, payload) => {
      if (table === 'budgets' && action === 'insert') {
        inserted.push(payload);
        return { data: { ...budget, ...(payload as object), status: 'draft', id: 'budget-new' } };
      }
      if (table === 'budget_lines' && action === 'insert') {
        inserted.push(payload);
        return { data: payload };
      }
      if (table === 'budgets') return { data: { ...budget, id: 'budget-new', status: 'draft', is_active: false } };
      if (table === 'budget_lines') return { data: [] };
      if (table === 'accounts') return { data: { id: 'income-1', business_id: 'biz-1', account_type: 'income' } };
      return { data: [] };
    });
    const repo = new BudgetRepository(client);
    const created = await repo.create('biz-1', {
      name: 'Operating plan', periodStart: '2026-01-01', periodEnd: '2026-03-31',
      lines: [{ accountId: 'income-1', amount: 1000 }],
    });
    expect(created.status).toBe('draft');
    expect(inserted[0]).toMatchObject({ fiscal_year: '2026', status: 'draft', is_active: false });
    expect(inserted[1]).toMatchObject({ m01_amount: 333.33, m02_amount: 333.33, m03_amount: 333.34, m04_amount: 0 });
  });

  it('computes income and expense actuals with correct normal-balance signs and excludes reversals in the query', async () => {
    const lines = [budgetLine('income-1', 'income', 100), budgetLine('expense-1', 'expense', 50)];
    const { client, calls } = createClient((table) => {
      if (table === 'budgets') return { data: budget };
      if (table === 'budget_lines') return { data: lines };
      if (table === 'journal_lines') return { data: [
        { account_id: 'income-1', is_debit: false, amount_base: 250 },
        { account_id: 'income-1', is_debit: true, amount_base: 50 },
        { account_id: 'expense-1', is_debit: true, amount_base: 60 },
        { account_id: 'expense-1', is_debit: false, amount_base: 10 },
      ] };
      return { data: [] };
    });
    const repo = new BudgetRepository(client);
    const rows = await repo.getBudgetVsActual('biz-1', 'budget-1', '2026-01-01', '2026-01-31');
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'income-1', budgeted: 100, actual: 200, variance: 100, variancePercent: 100 }),
      expect.objectContaining({ accountId: 'expense-1', budgeted: 50, actual: 50, variance: 0, variancePercent: 0 }),
    ]));
    expect(calls).toContainEqual(['journal_lines', 'eq', 'journal_entries.status', 'posted']);
    expect(calls).toContainEqual(['journal_lines', 'neq', 'journal_entries.status', 'reversed']);
    expect(calls).toContainEqual(['journal_lines', 'is', 'journal_entries.reversal_of', null]);
  });

  it('rolls up income, expenses, and net variance', async () => {
    const lines = [budgetLine('income-1', 'income', 100), budgetLine('expense-1', 'expense', 50)];
    const { client } = createClient((table) => {
      if (table === 'budgets') return { data: budget };
      if (table === 'budget_lines') return { data: lines };
      if (table === 'journal_lines') return { data: [
        { account_id: 'income-1', is_debit: false, amount_base: 250 },
        { account_id: 'expense-1', is_debit: true, amount_base: 70 },
      ] };
      return { data: [] };
    });
    const summary = await new BudgetRepository(client).getVarianceSummary('biz-1', 'budget-1', '2026-01-01', '2026-01-31');
    expect(summary).toMatchObject({
      incomeBudgeted: 100, incomeActual: 250, incomeVariance: 150,
      expenseBudgeted: 50, expenseActual: 70, expenseVariance: 20,
      netBudgeted: 50, netActual: 180, netVariance: 130,
    });
  });

  it('allows only draft-to-active and active-to-closed status changes', async () => {
    let updated: unknown;
    const { client } = createClient((table, action, payload) => {
      if (table === 'budgets' && action === 'update') {
        updated = payload;
        return { data: { ...budget, status: 'closed', is_active: false } };
      }
      return { data: budget };
    });
    const result = await new BudgetRepository(client).setBudgetStatus('biz-1', 'budget-1', 'closed');
    expect(result.status).toBe('closed');
    expect(updated).toEqual({ status: 'closed', is_active: false });
  });
});
