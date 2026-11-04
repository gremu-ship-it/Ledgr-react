// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BudgetListPage } from '@/pages/reports/BudgetListPage';
import { BudgetNewPage } from '@/pages/reports/BudgetNewPage';
import { BudgetVsActualPage } from '@/pages/reports/BudgetVsActualPage';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  getBudgetVsActual: vi.fn(),
  create: vi.fn(),
  setBudgetStatus: vi.fn(),
  findPostingAccounts: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    budget: {
      list: mocks.list,
      getById: mocks.getById,
      getBudgetVsActual: mocks.getBudgetVsActual,
      create: mocks.create,
      setBudgetStatus: mocks.setBudgetStatus,
      updateLine: vi.fn(),
      addLine: vi.fn(),
      removeLine: vi.fn(),
    },
    account: { findPostingAccounts: mocks.findPostingAccounts },
  },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'biz-1', name: 'Business', base_currency: 'MWK' }, role: 'owner' },
    currentUser: { id: 'user-1' },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const account = { id: 'account-income', business_id: 'biz-1', code: '4000', name: 'Sales', account_type: 'income' };
const line = {
  id: 'line-1', business_id: 'biz-1', budget_id: 'budget-1', account_id: account.id,
  annual_total: 1200, m01_amount: 100, m02_amount: 100, m03_amount: 100, m04_amount: 100,
  m05_amount: 100, m06_amount: 100, m07_amount: 100, m08_amount: 100,
  m09_amount: 100, m10_amount: 100, m11_amount: 100, m12_amount: 100,
  branch_id: null, department_id: null, created_at: '2026-01-01T00:00:00Z', notes: null,
  account: { id: account.id, code: account.code, name: account.name, account_type: 'income' },
};
const budget = {
  id: 'budget-1', business_id: 'biz-1', name: 'Annual Plan', fiscal_year: '2026',
  period_start: '2026-01-01', period_end: '2026-12-31', status: 'draft' as const, is_active: false,
  created_at: '2026-01-01T00:00:00Z', created_by: 'user-1', updated_at: '2026-01-01T00:00:00Z', notes: null,
  lines: [line],
};

function renderPage(path: string, element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><Routes><Route path="/reports/budgets" element={<BudgetListPage />} /><Route path="/reports/budgets/new" element={<BudgetNewPage />} /><Route path="/reports/budgets/:id" element={element} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([{ ...budget, total_budgeted: 1200 }]);
  mocks.getById.mockReset().mockResolvedValue(budget);
  mocks.getBudgetVsActual.mockReset().mockResolvedValue([{
    accountId: account.id, accountCode: account.code, accountName: account.name,
    accountType: 'income', budgeted: 100, actual: 125, variance: 25, variancePercent: 25,
  }]);
  mocks.create.mockReset().mockResolvedValue({ ...budget, id: 'budget-created' });
  mocks.setBudgetStatus.mockReset().mockResolvedValue({ ...budget, status: 'active' });
  mocks.findPostingAccounts.mockReset().mockResolvedValue([account]);
});
afterEach(() => cleanup());

describe('Budget reporting pages', () => {
  it('renders the budget list with period, status, and total budgeted amount', async () => {
    renderPage('/reports/budgets', <BudgetVsActualPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'budgets.title' })).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledWith('biz-1', {});
    expect(await screen.findByText('Annual Plan')).toBeTruthy();
    expect(screen.getAllByText('budgets.statusDraft').length).toBeGreaterThan(0);
    expect(screen.getByText(/MWK\s+1,200\.00/)).toBeTruthy();
  });

  it('renders the new budget form and account selector', async () => {
    renderPage('/reports/budgets/new', <BudgetNewPage />);
    expect(await screen.findByRole('heading', { name: 'budgets.new' })).toBeTruthy();
    expect(screen.getByLabelText('budgets.name')).toBeTruthy();
    expect(screen.getByLabelText('budgets.periodStart')).toBeTruthy();
    expect(screen.getByLabelText('budgets.periodEnd')).toBeTruthy();
    expect(screen.getByText('budgets.noLines')).toBeTruthy();
  });

  it('creates a draft budget with its selected income/expense line', async () => {
    renderPage('/reports/budgets/new', <BudgetNewPage />);
    fireEvent.change(await screen.findByLabelText('budgets.name'), { target: { value: 'New plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'budgets.addLine' }));
    fireEvent.change(screen.getByLabelText('budgets.account'), { target: { value: account.id } });
    fireEvent.change(screen.getByLabelText('budgets.amount'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'budgets.save' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      name: 'New plan',
      createdBy: 'user-1',
      lines: [{ accountId: account.id, amount: 2500 }],
    })));
  });

  it('renders variance actuals and draft line editing on the comparison page', async () => {
    renderPage('/reports/budgets/budget-1', <BudgetVsActualPage />);
    expect(await screen.findByRole('heading', { name: 'Annual Plan' })).toBeTruthy();
    expect(await screen.findByText('Sales')).toBeTruthy();
    expect(screen.getByText('budgets.incomeVariance')).toBeTruthy();
    expect(screen.getByText('budgets.editDraft')).toBeTruthy();
    expect(screen.getByText('budgets.saveLines')).toBeTruthy();
  });

  it('shows a close action only for an active budget', async () => {
    mocks.getById.mockResolvedValue({ ...budget, status: 'active', is_active: true });
    renderPage('/reports/budgets/budget-1', <BudgetVsActualPage />);
    expect(await screen.findByRole('button', { name: 'budgets.close' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('budgets.editDraft')).toBeNull());
  });
});
