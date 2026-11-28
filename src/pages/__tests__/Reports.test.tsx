// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const labels: Record<string, string> = {
  'nav.clinicReports': 'Financial & Clinic Reports',
  'nav.sub.trialBalance': 'Trial Balance',
  'nav.sub.profitAndLoss': 'Profit & Loss (P&L)',
  'nav.sub.balanceSheet': 'Balance Sheet',
  'nav.sub.cashFlow': 'Cash Flow Statement',
  'nav.sub.revenueBreakdown': 'Revenue Breakdown',
  'nav.sub.changesInEquity': 'Changes in Equity',
  'nav.sub.departmentPerformance': 'Branch / Department Perf.',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => labels[key] ?? key }),
}));

vi.mock('@/pages/reports/TrialBalancePage', () => ({
  TrialBalancePage: () => <div>Trial Balance View</div>,
}));
vi.mock('@/pages/reports/ProfitLossPage', () => ({
  ProfitLossPage: () => <div>Profit and Loss View</div>,
}));
vi.mock('@/pages/reports/BalanceSheetPage', () => ({
  BalanceSheetPage: () => <div>Balance Sheet View</div>,
}));
vi.mock('@/pages/reports/CashFlowPage', () => ({
  CashFlowPage: () => <div>Cash Flow View</div>,
}));
vi.mock('@/pages/reports/RevenueBreakdownPage', () => ({
  RevenueBreakdownPage: () => <div>Revenue Breakdown View</div>,
}));
vi.mock('@/pages/reports/ChangesInEquityPage', () => ({
  ChangesInEquityPage: () => <div>Changes in Equity View</div>,
}));
vi.mock('@/pages/reports/BranchPerformancePage', () => ({
  BranchPerformancePage: () => <div>Branch Performance View</div>,
}));

import { ReportsPage } from '../Reports';
import { normalizeReportTab } from '@/lib/reports/reportTabs';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderReports(initialEntry = '/reports') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Reports workspace tab routing', () => {
  it('normalizes supported aliases and falls back to trial balance', () => {
    expect(normalizeReportTab(null)).toBe('trial-balance');
    expect(normalizeReportTab('tb')).toBe('trial-balance');
    expect(normalizeReportTab('income-statement')).toBe('pnl');
    expect(normalizeReportTab('profit-loss')).toBe('pnl');
    expect(normalizeReportTab('bs')).toBe('balance-sheet');
    expect(normalizeReportTab('cashflow')).toBe('cash-flow');
    expect(normalizeReportTab('revenue-breakdown')).toBe('revenue');
    expect(normalizeReportTab('changes-in-equity')).toBe('equity');
    expect(normalizeReportTab('departments')).toBe('branches');
    expect(normalizeReportTab('unknown')).toBe('trial-balance');
  });

  it('defaults to Trial Balance and makes the tab explicit in the URL', async () => {
    renderReports();
    expect(screen.getByText('Trial Balance View')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Trial Balance' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/reports?tab=trial-balance');
    });
  });

  it('renders each report directly from the URL tab', () => {
    const cases = [
      { tab: 'trial-balance', view: 'Trial Balance View' },
      { tab: 'pnl', view: 'Profit and Loss View' },
      { tab: 'balance-sheet', view: 'Balance Sheet View' },
      { tab: 'cash-flow', view: 'Cash Flow View' },
      { tab: 'revenue', view: 'Revenue Breakdown View' },
      { tab: 'equity', view: 'Changes in Equity View' },
      { tab: 'branches', view: 'Branch Performance View' },
    ];

    for (const { tab, view } of cases) {
      const rendered = renderReports(`/reports?tab=${tab}`);
      expect(screen.getByText(view)).toBeTruthy();
      expect(screen.getByRole('tab', { selected: true }).textContent).toBeTruthy();
      rendered.unmount();
    }
  });

  it('switches the active view and query when a tab is clicked', async () => {
    renderReports('/reports?tab=trial-balance');
    fireEvent.click(screen.getByRole('tab', { name: 'Profit & Loss (P&L)' }));

    expect(screen.getByText('Profit and Loss View')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Profit & Loss (P&L)' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/reports?tab=pnl');
    });
  });

  it('canonicalizes an alias in the URL', async () => {
    renderReports('/reports?tab=income-statement');
    expect(screen.getByText('Profit and Loss View')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/reports?tab=pnl');
    });
  });
});
