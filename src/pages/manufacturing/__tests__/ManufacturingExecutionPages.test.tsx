// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAppStore } from '@/store/useAppStore';

const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
const lookup = (key: string): unknown => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], en);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(options?.[token] ?? `{{${token}}}`));
} }) }));

const mocks = vi.hoisted(() => ({
  listWorkCentres: vi.fn(), createWorkCentre: vi.fn(), updateWorkCentre: vi.fn(),
  listRoutings: vi.fn(), getRoutingWithSteps: vi.fn(), saveRouting: vi.fn(), activateRouting: vi.fn(), archiveRouting: vi.fn(),
  listWorkOrders: vi.fn(), getWorkOrder: vi.fn(), startRun: vi.fn(), completeRun: vi.fn(), abortRun: vi.fn(),
}));
vi.mock('@/lib/repositories', () => ({ repos: { manufacturing: mocks } }));
vi.mock('@/hooks/useCapability', () => ({ useCapability: () => true }));
vi.mock('@/components/billing/PlanGate', () => ({ PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/billing/CapabilityGate', () => ({ CapabilityGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/supabase', () => {
  const results: Record<string, unknown[]> = {
    products: [{ id: 'product-1', name: 'Widget', sku: 'W-1' }],
    manufacturing_boms: [],
    inventory_locations: [{ id: 'location-fg', name: 'Finished Goods', location_type: 'finished_goods_store', is_default: true }],
  };
  return { supabase: { from: (table: string) => {
    const data = results[table] ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null }));
    return chain;
  } } };
});

import { WorkCentresPage } from '@/pages/manufacturing/WorkCentresPage';
import { RoutingsPage } from '@/pages/manufacturing/RoutingsPage';
import { ProductionRunsPage } from '@/pages/manufacturing/ProductionRunsPage';

const businessId = '40000000-0000-4000-8000-000000000001';
const centre = { id: 'centre-1', business_id: businessId, code: 'CUT-1', name: 'Cutting Cell', description: null, centre_type: 'cell', capacity_hours_per_day: 8, cost_rate_per_hour: 12.5, is_active: true, notes: null, created_at: '', updated_at: '' };
const order = {
  id: 'wo-1', business_id: businessId, work_order_number: 'WO-001', product_id: 'product-1', bom_id: 'bom-1',
  planned_quantity: 10, completed_quantity: 0, scrapped_quantity: 0, status: 'released', priority: 'normal',
  routing_id: null, planned_start_date: null, planned_end_date: null, actual_start_date: null, actual_end_date: null,
  from_location_id: null, to_location_id: 'location-fg', notes: null, created_at: '', updated_at: '',
  product: { id: 'product-1', name: 'Widget', sku: 'W-1', unit_of_measure: 'ea' }, component_lines: [], routing: null, runs: [],
};
const t = (key: string) => { const value = lookup(key); return typeof value === 'string' ? value : key; };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listWorkCentres.mockResolvedValue([centre]);
  mocks.createWorkCentre.mockResolvedValue('centre-new');
  mocks.listRoutings.mockResolvedValue([]);
  mocks.saveRouting.mockResolvedValue('route-new');
  mocks.listWorkOrders.mockImplementation(async (_business: string, filters: { status?: string }) => filters.status === order.status ? [order] : []);
  mocks.getWorkOrder.mockResolvedValue(order);
  mocks.startRun.mockResolvedValue('run-new');
  mocks.completeRun.mockResolvedValue(undefined);
  mocks.abortRun.mockResolvedValue(undefined);
  useAppStore.setState({ currentBusiness: { role: 'owner', business: { id: businessId, name: 'Maker', organisation_type: 'FOR_PROFIT', operating_models: ['MANUFACTURING'] } } as never });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const renderPage = (page: React.ReactNode) => render(<MemoryRouter>{page}</MemoryRouter>);

describe('manufacturing execution pages', () => {
  it('creates a work centre through the repository and renders the centre list', async () => {
    renderPage(<WorkCentresPage />);
    await screen.findByText('Cutting Cell');
    fireEvent.change(screen.getByLabelText(t('manufacturing.workCentres.code')), { target: { value: 'MILL-2' } });
    fireEvent.change(screen.getByLabelText(t('manufacturing.workCentres.name')), { target: { value: 'Milling Cell' } });
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mocks.createWorkCentre).toHaveBeenCalledWith(businessId, expect.objectContaining({ code: 'MILL-2', name: 'Milling Cell' })));
  });

  it('saves a routing with an ordered work-centre step', async () => {
    renderPage(<RoutingsPage />);
    await screen.findByText(t('manufacturing.routing.empty'));
    fireEvent.change(screen.getByLabelText(t('manufacturing.routing.product')), { target: { value: 'product-1' } });
    fireEvent.change(screen.getByLabelText(t('manufacturing.routing.code')), { target: { value: 'ROUTE-1' } });
    fireEvent.change(screen.getByLabelText(t('manufacturing.routing.name')), { target: { value: 'Build Widget' } });
    fireEvent.click(screen.getByRole('button', { name: t('manufacturing.routing.addStep') }));
    fireEvent.change(screen.getByLabelText(t('manufacturing.routing.operation')), { target: { value: 'Cut' } });
    fireEvent.change(screen.getByLabelText(t('manufacturing.routing.workCentre')), { target: { value: centre.id } });
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mocks.saveRouting).toHaveBeenCalledWith(businessId, expect.objectContaining({
      product_id: 'product-1', code: 'ROUTE-1', name: 'Build Widget', steps: [expect.objectContaining({ sequence: 1, work_centre_id: centre.id, operation_name: 'Cut' })],
    })));
  });

  it('starts a run from a released work order', async () => {
    renderPage(<ProductionRunsPage />);
    await screen.findByRole('link', { name: 'WO-001' });
    fireEvent.click(screen.getByRole('button', { name: t('manufacturing.runs.startRun') }));
    fireEvent.click(screen.getAllByRole('button', { name: t('manufacturing.runs.startRun') }).at(-1)!);
    await waitFor(() => expect(mocks.startRun).toHaveBeenCalledWith(businessId, order.id, 'location-fg'));
  });

  it('completes an in-progress run through the repository execution command', async () => {
    const inProgressOrder = { ...order, status: 'in_progress', runs: [{ id: 'run-1', run_number: 1, output_quantity: 0, scrap_quantity: 0, status: 'in_progress', work_order_id: order.id, created_by: 'u', created_at: '', notes: null, started_at: '', completed_at: null, output_location_id: 'location-fg', lines: [] }] };
    mocks.listWorkOrders.mockImplementation(async (_business: string, filters: { status?: string }) => filters.status === 'in_progress' ? [inProgressOrder] : []);
    mocks.getWorkOrder.mockResolvedValue(inProgressOrder);
    renderPage(<ProductionRunsPage />);
    await screen.findByRole('link', { name: 'WO-001' });
    fireEvent.click(screen.getByRole('button', { name: t('manufacturing.runs.completeRun') }));
    fireEvent.change(screen.getByLabelText(t('manufacturing.wo.outputQty')), { target: { value: '4' } });
    fireEvent.click(screen.getAllByRole('button', { name: t('manufacturing.runs.completeRun') }).at(-1)!);
    await waitFor(() => expect(mocks.completeRun).toHaveBeenCalledWith(businessId, 'run-1', expect.objectContaining({ quantity_produced: 4, quantity_scrapped: 0, output_location_id: 'location-fg' })));
  });
});
