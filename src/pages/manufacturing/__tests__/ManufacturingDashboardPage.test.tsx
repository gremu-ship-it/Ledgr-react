// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({ getDashboard: vi.fn(), pushError: vi.fn() }));
vi.mock('@/dal/repositories/ManufacturingDashboardRepository', () => ({
  getManufacturingDashboard: mocks.getDashboard,
}));
vi.mock('@/lib/notifications', () => ({ pushError: mocks.pushError }));
vi.mock('react-i18next', async () => {
  const translations = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>(
    (value, part) => (value as Record<string, unknown> | undefined)?.[part], translations,
  );
  return { useTranslation: () => ({ t: (key: string) => {
    const value = lookup(key);
    return typeof value === 'string' ? value : key;
  } }) };
});

vi.mock('@/hooks/useUsage', () => ({ useUsage: () => ({ planTier: 'enterprise' }) }));

import { ManufacturingDashboardPage } from '@/pages/manufacturing/ManufacturingDashboardPage';

const business = {
  role: 'owner',
  business: {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Chirwa Engineering',
    organisation_type: 'FOR_PROFIT',
    operating_models: ['MANUFACTURING'],
    base_currency: 'MWK',
  },
};

const metrics = {
  active_work_orders: 3,
  completed_this_period: 2,
  total_output_this_period: 48,
  total_scrap_this_period: 2,
  avg_yield_pct: 96,
  wip_value: 12500,
  total_material_cost_this_period: 5000,
};

function emptyData() {
  return {
    metrics: { ...metrics, active_work_orders: 0, completed_this_period: 0, total_output_this_period: 0, total_scrap_this_period: 0, avg_yield_pct: 0, wip_value: 0 },
    previousMetrics: { ...metrics, total_output_this_period: 0 },
    throughput: [],
    yieldByProduct: [],
    wipAging: [],
    costVariance: [],
    productionSummary: [],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ManufacturingDashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.getDashboard.mockResolvedValue({
    metrics,
    previousMetrics: { ...metrics, total_output_this_period: 40 },
    throughput: [{ period_start: '2026-10-01', output_quantity: 48, scrap_quantity: 2, work_order_count: 2 }],
    yieldByProduct: [{ product_id: 'p-1', product_name: 'Steel Frame', total_output: 48, total_scrap: 2, yield_pct: 96, work_order_count: 2 }],
    wipAging: [{ work_order_id: 'wo-1', work_order_number: 'WO-2026-001', product_name: 'Steel Frame', status: 'in_progress', planned_quantity: 50, completed_quantity: 20, days_in_wip: 9, wip_cost: 12500, age_bucket: '8-14 days' }],
    costVariance: [{ work_order_id: 'wo-2', work_order_number: 'WO-2026-002', product_name: 'Steel Frame', planned_cost: 10000, actual_cost: 9500, variance: -500, variance_pct: -5 }],
    productionSummary: [{ product_id: 'p-1', product_name: 'Steel Frame', total_planned: 50, total_completed: 48, total_scrapped: 2, yield_pct: 96, total_material_cost: 9500, cost_per_unit: 197.92, work_order_count: 2, production_run_count: 3 }],
  });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('ManufacturingDashboardPage', () => {
  it('renders summary metrics and detailed reporting data', async () => {
    renderPage();
    expect(await screen.findByText(en.manufacturing.dashboard.title)).toBeTruthy();
    expect(screen.getByText('Chirwa Engineering')).toBeTruthy();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getByText('48 units')).toBeTruthy();
    expect(screen.getAllByText('96%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MWK 12,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText('WO-2026-001')).toBeTruthy();
    expect(screen.getByText('WO-2026-002')).toBeTruthy();
    expect(screen.getByText(en.manufacturing.dashboard.productionSummary)).toBeTruthy();
  });

  it('shows helpful empty states when there is no manufacturing data', async () => {
    mocks.getDashboard.mockResolvedValue(emptyData());
    renderPage();
    expect(await screen.findByText(en.manufacturing.dashboard.emptyWip)).toBeTruthy();
    expect(screen.getAllByText(en.manufacturing.dashboard.emptyVariance).length).toBe(2);
    expect(screen.getByText(en.manufacturing.dashboard.emptyThroughput)).toBeTruthy();
    expect(screen.getByText(en.manufacturing.dashboard.emptyYield)).toBeTruthy();
  });

  it('re-fetches for the selected period and uses weekly aggregation for a quarter', async () => {
    renderPage();
    await screen.findByText('48 units');
    const initialCalls = mocks.getDashboard.mock.calls.length;
    fireEvent.change(screen.getByLabelText(en.manufacturing.dashboard.period.label), { target: { value: 'thisQuarter' } });
    await waitFor(() => expect(mocks.getDashboard.mock.calls.length).toBeGreaterThan(initialCalls));
    const [, range] = mocks.getDashboard.mock.calls.at(-1) as [string, { granularity: string }];
    expect(range.granularity).toBe('week');
  });

  it('caches the resolved current period when switching away and back', async () => {
    renderPage();
    await screen.findByText('48 units');
    const initialCalls = mocks.getDashboard.mock.calls.length;
    const periodSelector = screen.getByLabelText(en.manufacturing.dashboard.period.label);
    fireEvent.change(periodSelector, { target: { value: 'thisWeek' } });
    await waitFor(() => expect(mocks.getDashboard.mock.calls.length).toBeGreaterThan(initialCalls));
    const afterWeek = mocks.getDashboard.mock.calls.length;
    fireEvent.change(periodSelector, { target: { value: 'thisMonth' } });
    await waitFor(() => expect(screen.getByText('48 units')).toBeTruthy());
    expect(mocks.getDashboard.mock.calls.length).toBe(afterWeek);
  });

  it('labels the page for MANUFACTURING and leaves route capability gating in place', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: en.manufacturing.dashboard.title })).toBeTruthy();
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source).toContain('<CapabilityGate capability="manufacturing">');
    expect(source).toContain('<ManufacturingDashboardPage />');
  });
});
