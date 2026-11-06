// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const dashboardMocks = vi.hoisted(() => ({
  useMonthlyIncome: vi.fn(),
  useMonthlyExpenses: vi.fn(),
  useMonthlyExpenseVat: vi.fn(),
  useOutstandingInvoices: vi.fn(),
  useIncomeExpenseTrend: vi.fn(),
  useRecentJournalEntries: vi.fn(),
  useMonthlyProfitLossReport: vi.fn(),
}));

vi.mock('@/hooks/useDashboardData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDashboardData')>();
  return {
    ...actual,
    useMonthlyIncome: dashboardMocks.useMonthlyIncome,
    useMonthlyExpenses: dashboardMocks.useMonthlyExpenses,
    useMonthlyExpenseVat: dashboardMocks.useMonthlyExpenseVat,
    useOutstandingInvoices: dashboardMocks.useOutstandingInvoices,
    useIncomeExpenseTrend: dashboardMocks.useIncomeExpenseTrend,
    useRecentJournalEntries: dashboardMocks.useRecentJournalEntries,
    useMonthlyProfitLossReport: dashboardMocks.useMonthlyProfitLossReport,
  };
});

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useCapability', () => ({ useCapability: () => false }));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1', name: 'Example business' } },
  }),
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en' },
    }),
  };
});
vi.mock('@/components/dashboard/IncomeExpenseChart', () => ({ IncomeExpenseChart: () => null }));
vi.mock('@/components/dashboard/RecentTransactions', () => ({ RecentTransactions: () => null }));
vi.mock('@/components/dashboard/CashFlowIndicator', () => ({ CashFlowIndicator: () => null }));
vi.mock('@/components/dashboard/TaxRemittancePanel', () => ({ TaxRemittancePanel: () => null }));
vi.mock('@/components/dashboard/TaxReminderModal', () => ({ TaxReminderModal: () => null }));
vi.mock('@/components/billing/UsageMeter', () => ({ UsageMeter: () => null }));
vi.mock('@/components/billing/UpgradeModal', () => ({ UpgradeModal: () => null }));
vi.mock('@/components/OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));

import { GenericDashboard } from '@/pages/DashboardPage';

const loaded = { isLoading: false, isError: false, isFetching: false };

beforeEach(() => {
  dashboardMocks.useMonthlyIncome.mockReturnValue({ ...loaded, data: { amountPaid: 100, totalAmount: 100, vatAmount: 5 } });
  dashboardMocks.useMonthlyExpenses.mockReturnValue({ ...loaded, data: 50 });
  dashboardMocks.useMonthlyExpenseVat.mockReturnValue({ ...loaded, data: 1 });
  dashboardMocks.useOutstandingInvoices.mockReturnValue({ ...loaded, data: { total: 20, count: 1 } });
  dashboardMocks.useIncomeExpenseTrend.mockReturnValue({ ...loaded, data: [] });
  dashboardMocks.useRecentJournalEntries.mockReturnValue({ ...loaded, data: [] });
  dashboardMocks.useMonthlyProfitLossReport.mockReturnValue({
    ...loaded,
    data: {
      netProfit: 10,
      totalRevenue: 100,
      totalOtherIncome: 0,
      totalCostOfSales: 20,
      totalOperatingExpenses: 20,
      totalDepreciationAmortisation: 0,
      totalFinanceCosts: 0,
      totalTaxExpense: 0,
    },
  });
});

describe('GenericDashboard KPI navigation', () => {
  it('renders each loaded financial KPI as a semantic link to its detail route', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <GenericDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const expectedRoutes = [
      '/reports/profit-loss',
      '/income',
      '/expenses',
      '/invoices',
      '/reports/vat-return',
    ];

    for (const route of expectedRoutes) {
      const card = container.querySelector(`a[href="${route}"]`);
      expect(card, `missing KPI link to ${route}`).not.toBeNull();
      expect(card?.tagName).toBe('A');
    }
  });
});
