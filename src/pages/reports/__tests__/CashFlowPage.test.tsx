// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrialBalanceParams, TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { CashFlowPage } from '../CashFlowPage';
import { periodForPreset } from '@/lib/reports/periods';
import { CASH_FLOW_BALANCE_START_DATE } from '@/lib/reports/cashFlow';

const mocks = vi.hoisted(() => ({ getTrialBalance: vi.fn() }));

vi.mock('@/dal/repositories/ReportRepository', () => ({
  ReportRepository: { getTrialBalance: mocks.getTrialBalance },
}));
vi.mock('@/hooks/useAccessibleReportBranches', () => ({
  useAccessibleReportBranches: () => ({
    data: [{ id: 'branch-1', name: 'Blantyre Branch' }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1', name: 'Test Co' }, role: 'owner' },
  }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => options?.amount ? `${key}:${options.amount}` : key,
    i18n: { language: 'en-MW' },
  }),
}));

function row(code: string, type: string, balance: number, name = `Account ${code}`): TrialBalanceRow {
  return {
    account_id: `id-${code}`,
    account_code: code,
    account_name: name,
    account_type: type,
    parent_account_id: null,
    total_debit: Math.max(balance, 0),
    total_credit: Math.max(-balance, 0),
    balance,
    level: 0,
  };
}

const periodRows = [row('4110', 'income', -10, 'Sales')];
const currentRows = [row('1110', 'asset', 110, 'Cash on Hand')];
const priorRows = [row('1110', 'asset', 100, 'Cash on Hand')];

function configureSuccessfulQuery(
  periodData: TrialBalanceRow[] = periodRows,
  currentData: TrialBalanceRow[] = currentRows,
  priorData: TrialBalanceRow[] = priorRows,
) {
  mocks.getTrialBalance.mockImplementation((_client: unknown, params: TrialBalanceParams) => {
    if (params.dateFrom !== CASH_FLOW_BALANCE_START_DATE) return Promise.resolve(periodData);
    if (params.dateTo === periodForPreset('thisMonth').to) return Promise.resolve(currentData);
    return Promise.resolve(priorData);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CashFlowPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.getTrialBalance.mockReset();
});

describe('CashFlowPage', () => {
  it('renders the indirect sections, net income, cash balances, and reconciliation status', async () => {
    configureSuccessfulQuery();
    renderPage();

    expect(await screen.findByText('reports.cashFlow.reconciled')).toBeTruthy();
    expect(screen.getByText('reports.cashFlow.operating')).toBeTruthy();
    expect(screen.getByText('reports.cashFlow.investing')).toBeTruthy();
    expect(screen.getByText('reports.cashFlow.financing')).toBeTruthy();
    expect(screen.getByText('reports.cashFlow.netIncome')).toBeTruthy();
    expect(screen.getAllByText(/MWK\s*10\.00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/MWK\s*100\.00/)).toBeTruthy();
    expect(screen.getByText(/MWK\s*110\.00/)).toBeTruthy();

    const expectedPeriod = periodForPreset('thisMonth');
    expect(mocks.getTrialBalance).toHaveBeenCalledTimes(3);
    expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      businessId: 'business-1',
      dateFrom: expectedPeriod.from,
      dateTo: expectedPeriod.to,
      branchId: null,
    }));
    expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      businessId: 'business-1',
      dateFrom: CASH_FLOW_BALANCE_START_DATE,
      dateTo: expectedPeriod.to,
      branchId: null,
    }));
  });

  it('updates the P&L period and cumulative comparison dates when the user changes the period', async () => {
    configureSuccessfulQuery();
    renderPage();
    await screen.findByText('reports.cashFlow.reconciled');
    mocks.getTrialBalance.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.lastMonth' }));
    const lastMonth = periodForPreset('lastMonth');
    await waitFor(() => {
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        dateFrom: lastMonth.from,
        dateTo: lastMonth.to,
      }));
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        dateFrom: CASH_FLOW_BALANCE_START_DATE,
        dateTo: lastMonth.to,
      }));
    });
  });

  it('passes the selected branch to each Trial Balance request', async () => {
    configureSuccessfulQuery();
    renderPage();
    await screen.findByText('reports.cashFlow.reconciled');

    fireEvent.change(screen.getByLabelText('reports.shared.branch'), { target: { value: 'branch-1' } });
    await waitFor(() => {
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        branchId: 'branch-1',
      }));
    });
  });

  it('shows loading, error, and empty states', async () => {
    mocks.getTrialBalance.mockImplementation(() => new Promise(() => {}));
    const pendingPage = renderPage();
    expect(screen.getByRole('status', { name: 'reports.shared.loading' })).toBeTruthy();
    pendingPage.unmount();
    cleanup();

    mocks.getTrialBalance.mockRejectedValue(new Error('request failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('reports.cashFlow.error')).toBeTruthy();

    cleanup();
    const cashOnly = [row('1110', 'asset', 100, 'Cash on Hand')];
    configureSuccessfulQuery([], cashOnly, cashOnly);
    renderPage();
    expect(await screen.findByText('reports.cashFlow.noData')).toBeTruthy();
  });

  it('rejects reversed periods', async () => {
    configureSuccessfulQuery();
    renderPage();
    const from = screen.getByLabelText('reports.shared.dateFrom');
    const to = screen.getByLabelText('reports.shared.dateTo');
    fireEvent.change(from, { target: { value: '2026-11-01' } });
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect(await screen.findByText('reports.cashFlow.invalidPeriod')).toBeTruthy();
  });
});
