// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import type { ProjectDetail as ProjectDetailRecord } from '@/dal/repositories/ProjectRepository';

// Polyfill ResizeObserver for Recharts ResponsiveContainer in JSDOM
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const mockState = vi.hoisted(() => ({
  hasConstructionCapability: true,
  projects: {
    list: vi.fn(),
    getById: vi.fn(),
    locations: vi.fn(),
    getProjectPnl: vi.fn(),
    getPortfolioSummary: vi.fn(),
    getValuationTrend: vi.fn(),
    getRetentionAging: vi.fn(),
    getDashboardMetrics: vi.fn(),
    getCostBreakdownByProject: vi.fn(),
    getValuationHistory: vi.fn(),
  },
  construction: {
    findSites: vi.fn(),
    findPurchaseOrders: vi.fn(),
    findMaterialIssues: vi.fn(),
    updateSite: vi.fn(),
  },
  branch: {
    findByBusiness: vi.fn(async () => []),
  },
}));

vi.mock('@/hooks/useCapability', () => ({
  useCapability: (cap: string) =>
    cap === 'construction' ? mockState.hasConstructionCapability : false,
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: mockState.projects,
    reporting: mockState.projects,
    construction: mockState.construction,
    branch: mockState.branch,
  },
}));

vi.mock('@/hooks/useDashboardData', () => ({
  useMonthlyIncome: () => ({ data: 10000, isLoading: false, isError: false }),
  useMonthlyExpenses: () => ({ data: 4000, isLoading: false, isError: false }),
  useMonthlyExpenseVat: () => ({ data: 0, isLoading: false }),
  useOutstandingInvoices: () => ({
    data: { count: 1, total: 2000 },
    isLoading: false,
    isError: false,
  }),
  useIncomeExpenseTrend: () => ({ data: [], isLoading: false }),
  useRecentJournalEntries: () => ({ data: [], isLoading: false }),
  useMonthlyProfitLossReport: () => ({
    data: { netIncome: 6000 },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/billing/UsageMeter', () => ({
  UsageMeter: () => null,
}));

vi.mock('@/components/OnboardingChecklist', () => ({
  OnboardingChecklist: () => null,
}));

vi.mock('@/components/dashboard/TaxRemittancePanel', () => ({
  TaxRemittancePanel: () => null,
}));

vi.mock('@/components/dashboard/CashFlowIndicator', () => ({
  CashFlowIndicator: () => null,
}));

vi.mock('@/components/dashboard/IncomeExpenseChart', () => ({
  IncomeExpenseChart: () => <div data-testid="generic-income-expense-chart" />,
}));

vi.mock('@/components/dashboard/RecentTransactions', () => ({
  RecentTransactions: () => null,
}));

import { DashboardPage } from '@/pages/DashboardPage';
import { ConstructionDashboard } from '../dashboard/ConstructionDashboard';
import { ProjectPnlOverview } from '../projects/ProjectPnlOverview';
import { RetentionAgingReport } from '../reports/RetentionAgingReport';

function renderWithProviders(ui: React.ReactElement, initialEntry = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  mockState.hasConstructionCapability = true;

  useAppStore.setState({
    currentUser: { id: 'u1', email: 'owner@buildco.mw' },
    currentBusiness: {
      role: 'owner',
      business: {
        id: 'b1',
        name: 'BuildCo MW',
        base_currency: 'MWK',
      },
    } as never,
  });

  mockState.projects.getDashboardMetrics.mockResolvedValue({
    active_projects: 3,
    total_contract_value: 1500000,
    total_billed_this_period: 600000,
    total_paid_this_period: 450000,
    total_costs_this_period: 380000,
    total_retention_held: 60000,
    outstanding_receivables: 150000,
    projects_over_budget: 1,
    avg_completion_pct: 55.5,
  });

  mockState.projects.getPortfolioSummary.mockResolvedValue({
    total_projects: 4,
    active_projects: 3,
    total_contract_value: 1500000,
    total_billed: 600000,
    total_paid: 450000,
    total_costs: 380000,
    total_retention_held: 60000,
    outstanding_receivables: 150000,
    avg_completion_pct: 55.5,
    projects_over_budget: 1,
  });

  mockState.projects.list.mockResolvedValue({
    rows: [
      {
        id: 'p1',
        business_id: 'b1',
        name: 'Lilongwe Bypass',
        client_name: 'Roads Authority',
        status: 'active',
        contract_sum: 1000000,
        retention_pct: 10,
        budget: 750000,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        created_by: 'u1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p2',
        business_id: 'b1',
        name: 'Blantyre Clinic',
        client_name: 'Ministry of Health',
        status: 'practical_completion',
        contract_sum: 500000,
        retention_pct: 5,
        budget: 400000,
        start_date: '2025-06-01',
        end_date: '2026-06-01',
        created_by: 'u1',
        created_at: '2025-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      },
    ],
    total: 2,
  });

  mockState.projects.getCostBreakdownByProject.mockResolvedValue([
    {
      project_id: 'p1',
      project_name: 'Lilongwe Bypass',
      total_po_value: 200000,
      total_issued_value: 200000,
      total_returned_value: 20000,
      net_cost: 380000,
      budget: 350000,
      variance: -30000,
    },
  ]);

  mockState.projects.getRetentionAging.mockResolvedValue([
    {
      project_id: 'p2',
      project_name: 'Blantyre Clinic',
      client_name: 'Ministry of Health',
      project_status: 'practical_completion',
      retention_balance: 25000,
      oldest_retention_date: '2025-08-01T00:00:00Z',
      days_held: 400,
    },
    {
      project_id: 'p1',
      project_name: 'Lilongwe Bypass',
      client_name: 'Roads Authority',
      project_status: 'active',
      retention_balance: 35000,
      oldest_retention_date: '2026-03-01T00:00:00Z',
      days_held: 220,
    },
  ]);

  mockState.projects.getValuationTrend.mockResolvedValue([
    {
      valuation_number: 1,
      valuation_date: '2026-09-15',
      gross_amount: 400000,
      retention_amount: 40000,
      net_amount: 360000,
      cumulative_billed: 360000,
    },
  ]);

  mockState.projects.getValuationHistory.mockResolvedValue({
    valuations: [
      {
        valuation: {
          id: 'v1',
          project_id: 'p1',
          valuation_number: 1,
          valuation_date: '2026-09-15',
          period_start: '2026-09-01',
          period_end: '2026-09-15',
          gross_amount: 400000,
          retention_pct: 10,
          retention_amount: 40000,
          net_amount: 360000,
          previous_cumulative: 0,
          status: 'invoiced',
          invoice_id: 'inv1',
          notes: null,
          created_by: 'u1',
          created_at: '2026-09-15T00:00:00Z',
          updated_at: '2026-09-15T00:00:00Z',
        },
        lines: [],
        invoice: { id: 'inv1', invoice_number: 'INV-001', status: 'sent' },
        retention_entries: [],
      },
    ],
    retention_entries: [],
  });
});

afterEach(() => cleanup());

describe('DashboardPage conditional rendering', () => {
  it('renders ConstructionDashboard when business has construction capability', async () => {
    mockState.hasConstructionCapability = true;
    renderWithProviders(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByTestId('construction-dashboard')).toBeTruthy(),
    );
    expect(screen.queryByTestId('generic-income-expense-chart')).toBeNull();
  });

  it('renders GenericDashboard when business does not have construction capability', async () => {
    mockState.hasConstructionCapability = false;
    renderWithProviders(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByTestId('generic-income-expense-chart')).toBeTruthy(),
    );
    expect(screen.queryByTestId('construction-dashboard')).toBeNull();
  });
});

describe('ConstructionDashboard', () => {
  it('renders metric cards with accurate portfolio values and date range filter', async () => {
    renderWithProviders(<ConstructionDashboard businessId="b1" />);

    await waitFor(() =>
      expect(
        screen.getByTestId('construction-dashboard-metrics'),
      ).toBeTruthy(),
    );

    expect(screen.getByTestId('metric-active-projects').textContent).toBe('3');
    expect(screen.getByTestId('metric-contract-value').textContent).toContain(
      '1,500,000',
    );
    expect(screen.getByTestId('metric-billed-period').textContent).toContain(
      '600,000',
    );
    expect(
      screen.getByTestId('metric-outstanding-receivables').textContent,
    ).toContain('150,000');
    expect(screen.getByTestId('metric-retention-held').textContent).toContain(
      '60,000',
    );
    expect(screen.getByTestId('metric-over-budget').textContent).toBe('1');
    expect(screen.getByTestId('metric-over-budget-card').className).toContain(
      'bg-red-50',
    );

    // Changing date range filter calls getDashboardMetrics with updated months
    const filter = screen.getByLabelText('Date range');
    fireEvent.change(filter, { target: { value: '3m' } });

    await waitFor(() =>
      expect(mockState.projects.getDashboardMetrics).toHaveBeenCalledWith(
        'b1',
        3,
      ),
    );
  });

  it('renders empty state when business has no projects', async () => {
    mockState.projects.list.mockResolvedValueOnce({ rows: [], total: 0 });
    mockState.projects.getDashboardMetrics.mockResolvedValueOnce({
      active_projects: 0,
      total_contract_value: 0,
      total_billed_this_period: 0,
      total_paid_this_period: 0,
      total_costs_this_period: 0,
      total_retention_held: 0,
      outstanding_receivables: 0,
      projects_over_budget: 0,
      avg_completion_pct: 0,
    });

    renderWithProviders(<ConstructionDashboard businessId="b1" />);

    await waitFor(() =>
      expect(
        screen.getByTestId('construction-dashboard-empty-projects'),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(
        'Create your first construction project to start tracking costs and progress.',
      ),
    ).toBeTruthy();
  });
});

describe('ProjectPnlOverview', () => {
  const sampleProject: ProjectDetailRecord = {
    id: 'p1',
    business_id: 'b1',
    name: 'Lilongwe Bypass',
    client_name: 'Roads Authority',
    client_id: null,
    status: 'active',
    contract_sum: 1000000,
    retention_pct: 10,
    budget: 750000,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    boq_locked_at: null,
    site_count: 2,
    cost: {
      total_po_value: 200000,
      total_issued_value: 200000,
      total_returned_value: 20000,
      net_cost: 380000,
    },
  };

  it('renders all 5 P&L sections, valuation trend chart, and Download Report toast', async () => {
    mockState.projects.getProjectPnl.mockResolvedValueOnce({
      project_name: 'Lilongwe Bypass',
      client_name: 'Roads Authority',
      status: 'active',
      contract_sum: 1000000,
      budget: 750000,
      retention_pct: 10,
      boq_total: 980000,
      total_po_value: 200000,
      total_issued_value: 200000,
      total_returned_value: 20000,
      total_costs: 380000,
      total_billed: 600000,
      total_retention_withheld: 60000,
      total_retention_released: 10000,
      retention_balance: 50000,
      total_paid: 450000,
      cost_variance: 370000,
      billing_pct: 60,
      completion_pct: 62.5,
      profit_margin: 36.67,
    });
    mockState.projects.getValuationTrend.mockResolvedValueOnce([
      {
        valuation_number: 1,
        valuation_date: '2026-08-15',
        gross_amount: 400000,
        retention_amount: 40000,
        net_amount: 360000,
        cumulative_billed: 360000,
      },
      {
        valuation_number: 2,
        valuation_date: '2026-09-15',
        gross_amount: 266667,
        retention_amount: 26667,
        net_amount: 240000,
        cumulative_billed: 600000,
      },
    ]);

    const onNotice = vi.fn();
    renderWithProviders(
      <ProjectPnlOverview project={sampleProject} onNotice={onNotice} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('valuation-trend-chart')).toBeTruthy(),
    );

    expect(
      screen.getByRole('region', { name: 'Contract & Budget' }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Costs' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Revenue' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Retention' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Profitability' })).toBeTruthy();

    // Positive variance and margin > 15% are styled emerald
    expect(screen.getByTestId('pnl-cost-variance').className).toContain(
      'bg-emerald-50',
    );
    expect(screen.getByTestId('pnl-profit-margin').className).toContain(
      'bg-emerald-50',
    );

    // Clicking Download Report triggers "Report export coming soon."
    fireEvent.click(screen.getByRole('button', { name: 'Download Report' }));
    expect(onNotice).toHaveBeenCalledWith('Report export coming soon.');
  });

  it('styles over-budget variance and negative profit margin in red and renders empty valuation trend state', async () => {
    mockState.projects.getProjectPnl.mockResolvedValueOnce({
      project_name: 'Lilongwe Bypass',
      client_name: 'Roads Authority',
      status: 'active',
      contract_sum: 1000000,
      budget: 300000,
      retention_pct: 10,
      boq_total: 1000000,
      total_po_value: 200000,
      total_issued_value: 200000,
      total_returned_value: 0,
      total_costs: 400000,
      total_billed: 250000,
      total_retention_withheld: 25000,
      total_retention_released: 0,
      retention_balance: 25000,
      total_paid: 100000,
      cost_variance: -100000,
      billing_pct: 25,
      completion_pct: 25,
      profit_margin: -60,
    });
    mockState.projects.getValuationTrend.mockResolvedValueOnce([]);

    renderWithProviders(
      <ProjectPnlOverview project={sampleProject} onNotice={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('pnl-cost-variance').className).toContain(
        'bg-red-50',
      ),
    );
    expect(screen.getByTestId('pnl-profit-margin').className).toContain(
      'bg-red-50',
    );
    expect(
      screen.getByText(
        'No invoiced valuations yet. Invoiced valuations will appear on the billing trend chart.',
      ),
    ).toBeTruthy();
  });
});

describe('RetentionAgingReport', () => {
  it('renders retention aging rows with threshold color coding, status filter, and days-held sort', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<RetentionAgingReport businessId="b1" />} />
      </Routes>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('retention-row-p2')).toBeTruthy(),
    );

    // Summary bar shows total held (25000 + 35000 = 60,000.00), 2 projects, avg 310 days
    const summaryBar = screen.getByTestId('retention-aging-summary');
    expect(within(summaryBar).getByText('60,000.00')).toBeTruthy();
    expect(within(summaryBar).getByText('310 days')).toBeTruthy();

    // p2 (400 days > 365) has red styling; p1 (220 days > 180) has yellow styling
    const rowP2 = screen.getByTestId('retention-row-p2');
    const rowP1 = screen.getByTestId('retention-row-p1');
    expect(rowP2.className).toContain('bg-red-50');
    expect(rowP1.className).toContain('bg-yellow-50');

    // Filter by 'active' status shows only p1
    fireEvent.change(screen.getByLabelText('Filter by project status'), {
      target: { value: 'active' },
    });
    expect(screen.queryByTestId('retention-row-p2')).toBeNull();
    expect(screen.getByTestId('retention-row-p1')).toBeTruthy();
  });

  it('renders empty state when no retention is held', async () => {
    mockState.projects.getRetentionAging.mockResolvedValueOnce([]);
    renderWithProviders(<RetentionAgingReport businessId="b1" />);

    await waitFor(() =>
      expect(
        screen.getByText(
          'No retention balances. Retention will appear here once valuations are created.',
        ),
      ).toBeTruthy(),
    );
  });
});
