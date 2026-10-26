// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrialBalancePage } from '../TrialBalancePage';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';

const mocks = vi.hoisted(() => ({
  rows: [] as TrialBalanceRow[],
  getTrialBalance: vi.fn(),
}));

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
    t: (key: string) => key,
    i18n: { language: 'en-MW' },
  }),
}));

const activeRows: TrialBalanceRow[] = [
  { account_id: 'assets', account_code: '1000', account_name: 'Assets', account_type: 'asset', parent_account_id: null, total_debit: 10, total_credit: 0, balance: 10, level: 0 },
  { account_id: 'cash', account_code: '1100', account_name: 'Cash', account_type: 'asset', parent_account_id: 'assets', total_debit: 90, total_credit: 100, balance: -10, level: 1 },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TrialBalancePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.getTrialBalance.mockReset();
  mocks.rows = activeRows;
});

describe('TrialBalancePage', () => {
  it('renders the hierarchy with rolled-up parent values and balanced totals', async () => {
    mocks.getTrialBalance.mockImplementation(async () => activeRows);
    renderPage();

    const assets = await screen.findByText('Assets');
    const assetsRow = assets.closest('tr');
    expect(assetsRow).not.toBeNull();
    const assetCells = within(assetsRow!).getAllByRole('cell');
    expect(assetCells[2].textContent).toBe('100.00');
    expect(assetCells[3].textContent).toBe('100.00');
    expect(assetCells[4].textContent).toBe('0.00');
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('reports.shared.balanced')).toBeTruthy();
    expect(mocks.getTrialBalance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      businessId: 'business-1',
      dateFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      branchId: null,
    }));
  });

  it('expands and collapses account rows and applies the selected branch server-side', async () => {
    mocks.getTrialBalance.mockImplementation(async () => activeRows);
    renderPage();
    await screen.findByText('Assets');

    fireEvent.click(screen.getByRole('button', { name: 'reports.trialBalance.collapseAll' }));
    expect(screen.queryByText('Cash')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'reports.trialBalance.expandAll' }));
    expect(screen.getByText('Cash')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('reports.shared.branch'), { target: { value: 'branch-1' } });
    await waitFor(() => {
      expect(mocks.getTrialBalance).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ branchId: 'branch-1' }));
    });
  });

  it('shows the no-posted-entry empty state when every account has zero activity', async () => {
    const emptyRows = activeRows.map((row) => ({ ...row, total_debit: 0, total_credit: 0, balance: 0 }));
    mocks.getTrialBalance.mockImplementation(async () => emptyRows);
    renderPage();
    expect(await screen.findByText('reports.trialBalance.noEntries')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
