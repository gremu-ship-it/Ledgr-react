// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BalanceSheetPage } from '../BalanceSheetPage';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { balanceSheetDateForPreset } from '@/lib/reports/balanceSheet';

const mocks = vi.hoisted(() => ({ getTrialBalance: vi.fn() }));

vi.mock('@/dal/repositories/ReportRepository', () => ({
  ReportRepository: { getTrialBalance: mocks.getTrialBalance },
}));
vi.mock('@/hooks/useAccessibleReportBranches', () => ({
  useAccessibleReportBranches: () => ({
    data: [{ id: 'branch-1', name: 'Blantyre' }],
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

const currentRows: TrialBalanceRow[] = [
  row('1110', 'asset', 100, 'Cash on Hand'),
  row('2110', 'liability', -30, 'Accounts Payable'),
  row('3110', 'equity', -60, "Owner's Capital"),
  row('3200', 'equity', 0, 'Retained Earnings'),
  row('4110', 'income', -20, 'Sales'),
  row('6100', 'expense', 10, 'Operating Expenses'),
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BalanceSheetPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.getTrialBalance.mockReset();
});

describe('BalanceSheetPage', () => {
  it('renders cumulative assets, liabilities, equity, retained earnings, and balance status', async () => {
    mocks.getTrialBalance.mockResolvedValue(currentRows);
    renderPage();

    expect(await screen.findByText('reports.balanceSheet.balanced')).toBeTruthy();
    expect(screen.getByText('Cash on Hand')).toBeTruthy();
    expect(screen.getByText('Accounts Payable')).toBeTruthy();
    expect(screen.getByText("Owner's Capital")).toBeTruthy();
    expect(screen.getByText('reports.balanceSheet.retainedEarnings')).toBeTruthy();
    expect(screen.getAllByText(/MWK\s*100\.00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/MWK\s*30\.00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/MWK\s*60\.00/)).toBeTruthy();
    expect(screen.getByText(/MWK\s*10\.00/)).toBeTruthy();

    const assetsSection = screen.getByRole('region', { name: 'reports.balanceSheet.assets' });
    const liabEquitySection = screen.getByRole('region', { name: 'reports.balanceSheet.liabilitiesAndEquity' });
    expect(within(assetsSection).getByText('reports.balanceSheet.totalAssets')).toBeTruthy();
    expect(within(liabEquitySection).getByText('reports.balanceSheet.totalLiabilitiesAndEquity')).toBeTruthy();
    expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      businessId: 'business-1',
      dateFrom: '0001-01-01',
      dateTo: balanceSheetDateForPreset('thisMonth'),
      branchId: null,
    }));
  });

  it('updates the cumulative as-of date from the end-of-last-month preset', async () => {
    mocks.getTrialBalance.mockResolvedValue(currentRows);
    renderPage();
    await screen.findByText('reports.balanceSheet.balanced');

    fireEvent.click(screen.getByRole('button', { name: 'reports.balanceSheet.endOfLastMonth' }));
    const lastMonth = balanceSheetDateForPreset('lastMonth');
    await waitFor(() => {
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        dateFrom: '0001-01-01',
        dateTo: lastMonth,
      }));
    });
  });

  it('applies the selected branch to the cumulative query', async () => {
    mocks.getTrialBalance.mockResolvedValue(currentRows);
    renderPage();
    await screen.findByText('reports.balanceSheet.balanced');

    fireEvent.change(screen.getByLabelText('reports.shared.branch'), { target: { value: 'branch-1' } });
    await waitFor(() => {
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        dateFrom: '0001-01-01',
        branchId: 'branch-1',
      }));
    });
  });

  it('shows loading, error, and empty states', async () => {
    mocks.getTrialBalance.mockImplementation(() => new Promise(() => {}));
    const pendingPage = renderPage();
    expect(screen.getByLabelText('reports.shared.loading')).toBeTruthy();
    pendingPage.unmount();
    cleanup();
    mocks.getTrialBalance.mockRejectedValue(new Error('request failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('reports.balanceSheet.error')).toBeTruthy();

    cleanup();
    mocks.getTrialBalance.mockResolvedValue(currentRows.map((account) => ({
      ...account, total_debit: 0, total_credit: 0, balance: 0,
    })));
    renderPage();
    expect(await screen.findByText('reports.balanceSheet.noData')).toBeTruthy();
  });
});
