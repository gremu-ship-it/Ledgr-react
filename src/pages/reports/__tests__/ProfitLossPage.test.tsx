// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfitLossPage } from '../ProfitLossPage';
import type { TrialBalanceParams, TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { periodForPreset, previousPeriod } from '@/lib/reports/periods';

const mocks = vi.hoisted(() => ({
  getTrialBalance: vi.fn(),
  downloadFile: vi.fn(),
  printReport: vi.fn(),
}));

vi.mock('@/lib/reports/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports/export')>();
  return { ...actual, downloadFile: mocks.downloadFile, printReport: mocks.printReport };
});
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
    t: (key: string, options?: Record<string, string>) => options?.account ? `${key}:${options.account}` : key,
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
  row('4114', 'income', -1000, 'Contract Revenue'),
  row('4120', 'income', 50, 'Sales Returns'),
  row('5100', 'expense', 300, 'Purchases'),
  row('5180', 'expense', -50, 'Inventory adjustment'),
  row('6100', 'expense', 100, 'Salaries'),
  row('4210', 'income', -25, 'Interest Income'),
  row('7192', 'expense', 10, 'Interest Expense'),
];
const priorRows: TrialBalanceRow[] = [
  row('4114', 'income', -900, 'Contract Revenue'),
  row('5100', 'expense', 200, 'Purchases'),
  row('6100', 'expense', 90, 'Salaries'),
  row('4210', 'income', -20, 'Interest Income'),
  row('7192', 'expense', 5, 'Interest Expense'),
];
const activePeriod = periodForPreset('thisMonth');
const priorRange = previousPeriod(activePeriod, 'thisMonth');

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfitLossPage />
    </QueryClientProvider>,
  );
}

function reportRows(params: TrialBalanceParams) {
  return params.dateFrom === priorRange.from ? priorRows : currentRows;
}

afterEach(() => {
  cleanup();
  mocks.getTrialBalance.mockReset();
  mocks.downloadFile.mockReset();
  mocks.printReport.mockReset();
});

describe('ProfitLossPage', () => {
  it('renders translated sections, computed totals, and current/prior variances', async () => {
    mocks.getTrialBalance.mockImplementation(async (_client: unknown, params: TrialBalanceParams) => reportRows(params));
    renderPage();

    const netIncomeRow = (await screen.findByText('reports.pnl.netProfit')).closest('tr');
    expect(netIncomeRow).not.toBeNull();
    const cells = within(netIncomeRow!).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['615.00', '625.00', '(10.00)', '(1.6%)']);
    expect(screen.getByText('reports.pnl.revenue')).toBeTruthy();
    expect(screen.getByText('reports.pnl.costOfSales')).toBeTruthy();
    expect(screen.getByText('Contract Revenue')).toBeTruthy();
    const presentationLines = [...screen.getByRole('table').querySelectorAll('tbody tr.section-header, tbody tr.computed-line')]
      .map((element) => element.querySelector('th')?.textContent);
    expect(presentationLines).toEqual([
      'reports.pnl.revenue',
      'reports.pnl.costOfSales',
      'reports.pnl.grossProfit',
      'reports.pnl.otherIncome',
      'reports.pnl.operatingExpenses',
      'reports.pnl.depreciationAmortisation',
      'reports.pnl.operatingProfit',
      'reports.pnl.financeCosts',
      'reports.pnl.profitBeforeTax',
      'reports.pnl.taxExpense',
      'reports.pnl.netProfit',
    ]);
    expect(mocks.getTrialBalance).toHaveBeenCalledTimes(2);
    expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      businessId: 'business-1',
      dateFrom: activePeriod.from,
      dateTo: activePeriod.to,
      branchId: null,
    }));
    expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      businessId: 'business-1',
      dateFrom: priorRange.from,
      dateTo: priorRange.to,
      branchId: null,
    }));
  });

  it('uses the matching prior calendar quarter when the quarter preset is selected', async () => {
    mocks.getTrialBalance.mockImplementation(async () => currentRows);
    renderPage();
    await screen.findByText('reports.pnl.netProfit');

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.thisQuarter' }));
    const quarter = periodForPreset('thisQuarter');
    const priorQuarter = previousPeriod(quarter, 'thisQuarter');
    await waitFor(() => {
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        dateFrom: quarter.from,
        dateTo: quarter.to,
      }));
      expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        dateFrom: priorQuarter.from,
        dateTo: priorQuarter.to,
      }));
    });
  });

  it('shows a loading state while report queries are pending', () => {
    mocks.getTrialBalance.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText('reports.shared.loading')).toBeTruthy();
  });

  it('shows an error state when report queries fail', async () => {
    mocks.getTrialBalance.mockRejectedValue(new Error('request failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('reports.profitLoss.error')).toBeTruthy();
  });

  it('hides comparison columns when the toggle is turned off', async () => {
    mocks.getTrialBalance.mockImplementation(async (_client: unknown, params: TrialBalanceParams) => reportRows(params));
    renderPage();
    await screen.findByText('reports.pnl.netProfit');

    fireEvent.click(screen.getByRole('checkbox', { name: 'reports.pnl.comparePrior' }));
    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: 'reports.pnl.prior' })).toBeNull();
      expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    });
  });

  it('exports data from the selected branch for both comparison periods', async () => {
    const branchRows = [row('4114', 'income', -77, 'Branch Sales')];
    mocks.getTrialBalance.mockImplementation(async (_client: unknown, params: TrialBalanceParams) => (
      params.branchId ? branchRows : reportRows(params)
    ));
    renderPage();
    await screen.findByText('reports.pnl.netProfit');
    fireEvent.change(screen.getByLabelText('reports.shared.branch'), { target: { value: 'branch-1' } });

    await waitFor(() => {
      const branchCalls = mocks.getTrialBalance.mock.calls.filter((call) => (call[1] as TrialBalanceParams).branchId === 'branch-1');
      expect(branchCalls).toHaveLength(2);
    });
    await screen.findByText('Branch Sales');
    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    const csv = mocks.downloadFile.mock.calls[0][0] as string;
    expect(csv).toContain('reports.pnl.revenue,4114,Branch Sales,77.00,77.00,0.00,0.00');
    expect(csv).not.toContain('Contract Revenue');
  });

  it('exports section totals, accounts, computed lines, and the enabled comparison columns', async () => {
    mocks.getTrialBalance.mockImplementation(async (_client: unknown, params: TrialBalanceParams) => reportRows(params));
    renderPage();
    await screen.findByText('reports.pnl.netProfit');

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    let csv = mocks.downloadFile.mock.calls[0][0] as string;
    expect(csv.split('\n')[0]).toBe('reports.shared.section,reports.shared.accountCode,reports.shared.accountName,reports.pnl.current,reports.pnl.prior,reports.pnl.variance,reports.pnl.variancePct');
    expect(csv).toContain('reports.pnl.revenue,,,950.00,900.00,50.00,5.56');
    expect(csv).toContain('reports.pnl.revenue,4114,Contract Revenue,1000.00,900.00,100.00,11.11');
    expect(csv).toContain(',,reports.pnl.grossProfit,700.00,700.00,0.00,0.00');
    expect(csv).toContain(',,reports.pnl.profitBeforeTax,615.00,625.00,-10.00,-1.60');

    fireEvent.click(screen.getByRole('checkbox', { name: 'reports.pnl.comparePrior' }));
    await waitFor(() => expect(screen.getAllByRole('columnheader')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    csv = mocks.downloadFile.mock.calls[1][0] as string;
    expect(csv.split('\n')[0]).toBe('reports.shared.section,reports.shared.accountCode,reports.shared.accountName,reports.pnl.current');
    expect(csv).not.toContain('Variance %');
  });

  it('shows the empty state when neither selected period has P&L activity', async () => {
    mocks.getTrialBalance.mockImplementation(async () => currentRows.map((account) => ({
      ...account, total_debit: 0, total_credit: 0, balance: 0,
    })));
    renderPage();
    expect(await screen.findByText('reports.profitLoss.noActivity')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'reports.shared.exportCSV' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'reports.shared.exportPDF' }).hasAttribute('disabled')).toBe(true);
  });
});
