// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capabilities: {
    construction: false,
    manufacturing: false,
    pos: false,
    inventory: false,
  } as Record<string, boolean>,
  payrollAllowed: false,
  currentBusiness: {
    role: 'owner',
    business: { id: 'business-1', operating_models: [] as string[] },
  },
  getDashboardMetrics: vi.fn(),
  getPortfolioSummary: vi.fn(),
  getManufacturingDashboardMetrics: vi.fn(),
  findDashboardActiveShift: vi.fn(),
  getDashboardSummary: vi.fn(),
  findByBusiness: vi.fn(),
  findOpenByBusiness: vi.fn(),
  countEmployeesForRun: vi.fn(),
}));

vi.mock('@/hooks/useCapability', () => ({
  useCapability: (capability: string) => mocks.capabilities[capability] ?? false,
}));
vi.mock('@/hooks/usePermissions', () => ({
  isPathAllowedForRole: () => mocks.payrollAllowed,
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ currentBusiness: mocks.currentBusiness }),
}));
vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: { getDashboardMetrics: mocks.getDashboardMetrics, getPortfolioSummary: mocks.getPortfolioSummary },
    pos: { findDashboardActiveShift: mocks.findDashboardActiveShift },
    inventory: { getDashboardSummary: mocks.getDashboardSummary },
    payroll: { findByBusiness: mocks.findByBusiness, countEmployeesForRun: mocks.countEmployeesForRun },
    taxReturn: { findOpenByBusiness: mocks.findOpenByBusiness },
  },
}));
vi.mock('@/dal/repositories/ManufacturingDashboardRepository', () => ({
  getManufacturingDashboardMetrics: mocks.getManufacturingDashboardMetrics,
}));
vi.mock('@/hooks/usePosOwnerAnalytics', () => ({
  usePosOwnerAnalytics: () => ({
    data: { net_sales: 250, order_count: 2 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { DashboardVerticalModules } from '@/components/dashboard/DashboardVerticalModules';

function renderModules() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><DashboardVerticalModules /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

beforeEach(() => {
  Object.assign(mocks.capabilities, { construction: false, manufacturing: false, pos: false, inventory: false });
  mocks.payrollAllowed = false;
  mocks.currentBusiness.business.operating_models = [];
  mocks.getDashboardMetrics.mockResolvedValue({ total_billed_this_period: 1000, total_paid_this_period: 800 });
  mocks.getPortfolioSummary.mockResolvedValue({ active_projects: 2, total_contract_value: 4000, total_retention_held: 100, projects_over_budget: 1 });
  mocks.getManufacturingDashboardMetrics.mockResolvedValue({
    active_work_orders: 3,
    completed_this_period: 2,
    total_output_this_period: 120,
    avg_yield_pct: 96.5,
  });
  mocks.findDashboardActiveShift.mockResolvedValue(null);
  mocks.getDashboardSummary.mockResolvedValue({ stockValue: 0, lowStockCount: 0, stockoutCount: 0, trackedBalanceCount: 0 });
  mocks.findByBusiness.mockResolvedValue([]);
  mocks.findOpenByBusiness.mockResolvedValue([]);
  mocks.countEmployeesForRun.mockResolvedValue(0);
});

describe('DashboardVerticalModules', () => {
  it('renders no section shell or placeholder when no module is enabled', () => {
    renderModules();
    expect(screen.queryByTestId('dashboard-vertical-modules')).toBeNull();
  });

  it('renders only the active capability/model-gated summaries', () => {
    mocks.capabilities.construction = true;
    mocks.capabilities.manufacturing = true;
    mocks.capabilities.pos = true;
    mocks.capabilities.inventory = true;
    mocks.currentBusiness.business.operating_models = ['RETAIL'];
    mocks.payrollAllowed = true;

    renderModules();

    for (const slot of [
      'construction-executive-section',
      'manufacturing-summary-section',
      'pos-summary-section',
      'inventory-summary-section',
      'payroll-summary-section',
    ]) {
      expect(screen.getByTestId(slot)).toBeTruthy();
    }
  });

  it('does not render a POS snapshot without both POS capability and Retail operating model', () => {
    mocks.capabilities.pos = true;
    mocks.currentBusiness.business.operating_models = ['MANUFACTURING'];

    renderModules();

    expect(screen.queryByTestId('pos-summary-section')).toBeNull();
  });

  it('shows a translated empty state when the organisation has no tracked inventory', async () => {
    mocks.capabilities.inventory = true;
    renderModules();
    expect(await screen.findByText('dashboard.verticals.noActivity')).toBeTruthy();
  });

  it('keeps an inventory read failure isolated and offers retry', async () => {
    mocks.capabilities.inventory = true;
    mocks.getDashboardSummary.mockRejectedValueOnce(new Error('network'));
    renderModules();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('dashboard.verticals.inventoryError');
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(mocks.getDashboardSummary).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('inventory-summary-section')).toBeTruthy();
  });
});
