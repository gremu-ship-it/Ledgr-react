// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CashForecastPage } from '../CashForecastPage';

const mocks = vi.hoisted(() => ({
  scenarios: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: mocks.scenarios, error: null }),
        }),
      }),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mocks.insert(values);
            const scenario = { id: 'scenario-new', ...values };
            mocks.scenarios = [scenario];
            return { data: scenario, error: null };
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                mocks.update(values);
                return { data: { ...mocks.scenarios[0], ...values }, error: null };
              },
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: {
      business: { id: 'business-1', name: 'Test business', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
      role: 'owner',
    },
    currentUser: { id: 'user-1' },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => options ? `${key}:${JSON.stringify(options)}` : key, i18n: { language: 'en' } }),
}));

const forecast = {
  as_of_date: '2026-10-29',
  base_currency: 'MWK',
  horizon_months: 3,
  opening_balance: 1000,
  months: [
    { month: '2026-10-01', opening: 1000, inflows: 200, outflows: 100, net: 100, closing: 1100, receivables: 200, payables: 50, payroll: 50, construction_inflows: 0, purchase_orders: 0 },
    { month: '2026-11-01', opening: 1100, inflows: 0, outflows: 200, net: -200, closing: 900, receivables: 0, payables: 100, payroll: 100, construction_inflows: 0, purchase_orders: 0 },
    { month: '2026-12-01', opening: 900, inflows: 0, outflows: 1000, net: -1000, closing: -100, receivables: 0, payables: 0, payroll: 1000, construction_inflows: 0, purchase_orders: 0 },
  ],
  source_counts: { receivables: 1, payables: 2, payroll: 3, certificates: 0, retention: 0, purchase_orders: 0 },
  shortfall_months: 1,
  average_monthly_payroll: 100,
  construction_available: true,
  unpriced_purchase_order_lines: 0,
  foreign_currency_purchase_order_lines: 0,
  unlinked_certificate_count: 0,
  estimated_retention_projects: 0,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}><CashForecastPage /></QueryClientProvider>);
}

beforeEach(() => {
  mocks.scenarios = [];
  mocks.rpc.mockReset().mockResolvedValue({ data: forecast, error: null });
  mocks.insert.mockReset();
  mocks.update.mockReset();
});

afterEach(() => cleanup());

describe('CashForecastPage', () => {
  it('renders the rolling buckets, alerts on a shortfall, and sends assumption changes to the RPC', async () => {
    renderPage();

    expect(await screen.findByText('reports.cashForecast.monthlyBuckets')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('reports.cashForecast.shortfallAlert');
    expect(screen.getByText('reports.cashForecast.rollForwardExplanation')).toBeTruthy();
    expect(screen.getByText('reports.cashForecast.sources.receivables')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('reports.cashForecast.receivableDelay'), { target: { value: '14' } });
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith('generate_cash_forecast', expect.objectContaining({
      p_business_id: 'business-1',
      p_receivable_delay_days: 14,
      p_horizon_months: 12,
      p_include_construction: true,
    })));
  });

  it('loads a saved scenario into the assumptions and updates its named settings', async () => {
    mocks.scenarios = [{
      id: 'scenario-1',
      business_id: 'business-1',
      created_by: 'user-1',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      name: 'Late collections',
      receivable_delay_days: 30,
      payable_delay_days: 7,
      payroll_growth_percent: 5,
      include_construction: false,
      horizon_months: 6,
    }];
    renderPage();

    await screen.findByRole('option', { name: 'Late collections' });
    fireEvent.change(screen.getByLabelText('reports.cashForecast.selectScenario'), { target: { value: 'scenario-1' } });
    expect((screen.getByLabelText('reports.cashForecast.receivableDelay') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('reports.cashForecast.payableDelay') as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('reports.cashForecast.horizon') as HTMLSelectElement).value).toBe('6');
    expect((screen.getByLabelText('reports.cashForecast.includeConstruction') as HTMLInputElement).checked).toBe(false);

    fireEvent.change(screen.getByLabelText('reports.cashForecast.scenarioName'), { target: { value: 'Late collections v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'reports.cashForecast.updateScenario' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Late collections v2',
      receivable_delay_days: 30,
      payable_delay_days: 7,
      horizon_months: 6,
    })));
  });

  it('saves new assumptions as a named scenario', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('reports.cashForecast.scenarioName'), { target: { value: 'Conservative' } });
    fireEvent.click(screen.getByRole('button', { name: 'reports.cashForecast.saveScenario' }));

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'business-1',
      created_by: 'user-1',
      name: 'Conservative',
      horizon_months: 12,
    })));
    expect(await screen.findByText('reports.cashForecast.scenarioSaved')).toBeTruthy();
  });
});
