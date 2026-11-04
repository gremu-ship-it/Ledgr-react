// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listRecommendations: vi.fn(),
  listProducts: vi.fn(),
  runMrp: vi.fn(),
  convert: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    manufacturing: {
      listMrpRuns: mocks.listRuns,
      listMrpRecommendations: mocks.listRecommendations,
      runMrp: mocks.runMrp,
      convertMrpRecommendation: mocks.convert,
      dismissMrpRecommendation: mocks.dismiss,
    },
    inventory: { findAllProducts: mocks.listProducts },
  },
}));
vi.mock('@/components/billing/PlanGate', () => ({ PlanGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/billing/CapabilityGate', () => ({ CapabilityGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('react-i18next', async () => {
  const translations = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>(
    (value, part) => (value as Record<string, unknown> | undefined)?.[part], translations,
  );
  return { useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => {
    const value = lookup(key);
    if (typeof value !== 'string') return key;
    return Object.entries(options ?? {}).reduce((result, [name, replacement]) => result.replaceAll(`{{${name}}}`, String(replacement)), value);
  } }) };
});

import { MrpWorkbenchPage } from '@/pages/manufacturing/MrpWorkbenchPage';

const business = {
  role: 'owner',
  business: {
    id: 'business-1', name: 'Chirwa Engineering', organisation_type: 'FOR_PROFIT',
    operating_models: ['MANUFACTURING'], base_currency: 'MWK',
  },
};
const mrpRun = {
  id: 'run-1', business_id: 'business-1', run_number: 4, horizon_start: '2026-11-01',
  horizon_end: '2026-11-30', demand_inputs: [], created_by: 'user-1',
  created_at: '2026-11-01T10:00:00Z', recommendation_count: 1, make_count: 1, buy_count: 0,
};
const makeRecommendation = {
  id: 'rec-1', business_id: 'business-1', run_id: 'run-1', product_id: 'product-1',
  recommendation_type: 'make', required_date: '2026-11-10', gross_requirement: 5,
  on_hand_quantity: 1, active_production_quantity: 1, approved_supply_quantity: 0,
  net_requirement: 3, bom_id: 'bom-1', status: 'open', converted_work_order_id: null,
  created_at: '2026-11-01T10:00:00Z', dismissed_at: null, dismissed_by: null,
  product: { id: 'product-1', name: 'Assembly', sku: 'ASM-1', unit_of_measure: 'ea' },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><MrpWorkbenchPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.listRuns.mockResolvedValue([mrpRun]);
  mocks.listRecommendations.mockResolvedValue([makeRecommendation]);
  mocks.listProducts.mockResolvedValue([{ id: 'product-1', name: 'Assembly', sku: 'ASM-1', is_active: true }]);
  mocks.runMrp.mockResolvedValue('run-2');
  mocks.convert.mockResolvedValue('work-order-1');
  mocks.dismiss.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('MrpWorkbenchPage', () => {
  it('shows planning run history, summary cards, make/buy filters, and netted recommendations', async () => {
    renderPage();
    expect(await screen.findByRole('option', { name: /Run #4/ })).toBeTruthy();
    expect(screen.getByText(en.manufacturing.mrp.title)).toBeTruthy();
    expect(screen.getByText(en.manufacturing.mrp.recommendations.title)).toBeTruthy();
    expect(await screen.findByText('3 ea')).toBeTruthy();
    expect(screen.getAllByText('Assembly').length).toBeGreaterThan(0);
    expect(screen.getByText(en.manufacturing.mrp.recommendations.convertToWorkOrder)).toBeTruthy();
  });

  it('submits manually entered dated demand to the run RPC', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Assembly · ASM-1' });
    fireEvent.change(screen.getByLabelText(`${en.manufacturing.mrp.newRun.product} 1`), { target: { value: 'product-1' } });
    fireEvent.change(screen.getByLabelText(`${en.manufacturing.mrp.newRun.quantity} 1`), { target: { value: '5' } });
    const dates = screen.getAllByLabelText(`${en.manufacturing.mrp.newRun.requiredDate} 1`);
    fireEvent.change(dates[0], { target: { value: '2026-11-10' } });
    const start = screen.getByLabelText(en.manufacturing.mrp.newRun.horizonStart);
    const end = screen.getByLabelText(en.manufacturing.mrp.newRun.horizonEnd);
    fireEvent.change(start, { target: { value: '2026-11-01' } });
    fireEvent.change(end, { target: { value: '2026-11-30' } });
    fireEvent.click(screen.getByRole('button', { name: en.manufacturing.mrp.newRun.run }));
    await waitFor(() => expect(mocks.runMrp).toHaveBeenCalledWith('business-1', '2026-11-01', '2026-11-30', [
      { product_id: 'product-1', quantity: 5, required_date: '2026-11-10' },
    ]));
  });

  it('converts a make recommendation only after the explicit user action', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: en.manufacturing.mrp.recommendations.convertToWorkOrder }));
    await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('rec-1'));
    expect(mocks.runMrp).not.toHaveBeenCalled();
  });
});
