// @vitest-environment jsdom
/**
 * Manufacturing Phase C — work order pages (list, create, detail) UI contract.
 *
 * Focuses on the spec's UI requirements that are verifiable without a live
 * database: i18n usage with no hardcoded English, capability gating, the
 * active-BOM filter on the create form, and context-sensitive status actions.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';

const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], en);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const value = lookup(key);
      return typeof value === 'string' ? value : key;
    },
  }),
}));

const rpcCalls: Array<{ name: string; params: unknown }> = [];
let products: Array<Record<string, unknown>> = [];
let activeBomProductIds: string[] = [];
let workOrders: Array<Record<string, unknown>> = [];
let locations: Array<Record<string, unknown>> = [];
let lines: Array<Record<string, unknown>> = [];
let runs: Array<Record<string, unknown>> = [];
let transactions: Array<Record<string, unknown>> = [];
let confirmAnswer = true;

vi.mock('@/hooks/useCapability', () => ({
  useCapability: () => true,
  resolveBusinessCapability: () => true,
  useOrganisationCapabilityVisibility: () => () => true,
}));

vi.mock('@/lib/supabase', () => {
  const makeChain = (table: string, result: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
      chain[method] = () => chain;
    }
    // `.single()` resolves the one row a detail page would receive.
    chain.single = () =>
      Promise.resolve({ data: Array.isArray(result) ? result[0] ?? null : result, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chain as any).then = (resolve: (value: unknown) => unknown) => resolve({ data: result, error: null });
    void table;
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        const data =
          table === 'products'
            ? products
            : table === 'manufacturing_boms'
              ? activeBomProductIds.map((product_id, index) => ({ id: `bom-${index + 1}`, product_id, version: 1, status: 'active' }))
              : table === 'inventory_locations'
                ? locations
                : table === 'manufacturing_work_orders'
                  ? workOrders
                  : table === 'manufacturing_work_order_lines'
                    ? lines
                    : table === 'manufacturing_production_runs'
                      ? runs
                      : table === 'manufacturing_material_transactions'
                        ? transactions
                        : [];
        return {
          select: () => makeChain(table, data),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new' }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      },
      rpc: (name: string, params: unknown) => {
        rpcCalls.push({ name, params });
        if (name === 'manufacturing_bom_cost') return Promise.resolve({ data: 400, error: null });
        return Promise.resolve({ data: 'new-work-order-id', error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-id' } }, error: null }) },
    },
    isSupabaseConfigured: true,
  };
});

vi.mock('@/hooks/useUsage', () => ({ useUsage: () => ({ planTier: 'enterprise' }) }));

import { WorkOrderListPage } from '@/pages/manufacturing/WorkOrderListPage';
import { WorkOrderCreatePage } from '@/pages/manufacturing/WorkOrderCreatePage';
import { WorkOrderDetailPage } from '@/pages/manufacturing/WorkOrderDetailPage';

const BUSINESS_ID = '40000000-0000-4000-8000-000000000001';

const MANUFACTURING_BUSINESS = {
  role: 'owner',
  business: {
    id: BUSINESS_ID,
    name: 'Chirwa Manufacturing',
    organisation_type: 'FOR_PROFIT',
    operating_models: ['MANUFACTURING'],
  },
};

const LOCATIONS = [
  { id: 'loc-raw', name: 'Raw Materials Store', location_type: 'raw_materials_store', is_default: false },
  { id: 'loc-floor', name: 'Production Floor', location_type: 'production_floor', is_default: false },
  { id: 'loc-fg', name: 'Finished Goods Store', location_type: 'finished_goods_store', is_default: true },
];

/** A work order row for each status the lifecycle defines. */
function workOrderFixture(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `wo-${status}`,
    business_id: BUSINESS_ID,
    work_order_number: `WO-2026-${status.slice(0, 3).toUpperCase()}`,
    product_id: 'prod-frame',
    bom_id: 'bom-1',
    planned_quantity: 100,
    completed_quantity: status === 'draft' || status === 'released' ? 0 : 60,
    scrapped_quantity: status === 'draft' || status === 'released' ? 0 : 5,
    status,
    planned_start_date: '2026-11-01',
    planned_end_date: '2026-11-30',
    actual_start_date: null,
    actual_end_date: null,
    from_location_id: 'loc-raw',
    to_location_id: 'loc-fg',
    notes: null,
    created_at: '2026-11-01T08:00:00Z',
    updated_at: '2026-11-01T08:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  confirmAnswer = true;
  products = [
    { id: 'prod-frame', name: 'Bicycle Frame', product_type: 'finished_good', unit_of_measure: 'pcs' },
    { id: 'prod-steel', name: 'Steel Bar', product_type: 'raw_material', unit_of_measure: 'pcs' },
    { id: 'prod-bolt', name: 'Bolt Pack', product_type: 'raw_material', unit_of_measure: 'pcs' },
  ];
  activeBomProductIds = ['prod-frame'];
  locations = LOCATIONS;
  workOrders = [];
  lines = [];
  runs = [];
  transactions = [];
  useAppStore.setState({ currentBusiness: MANUFACTURING_BUSINESS as never });
  vi.spyOn(window, 'confirm').mockImplementation(() => confirmAnswer);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function withProviders(children: React.ReactNode, initialPath = '/manufacturing/production') {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** Renders the detail page at its real route so `useParams` resolves `:id`. */
function withDetailRoute(id = 'wo-in_progress') {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/manufacturing/production/${id}`]}>
        <Routes>
          <Route path="/manufacturing/production/:id" element={<WorkOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('work order list page', () => {
  it('renders its title from the i18n bundle, not hardcoded', () => {
    render(withProviders(<WorkOrderListPage />));
    expect(screen.getByText('Work Orders')).toBeTruthy();
  });

  it('shows the manufacturing.wo.emptyState message when there are no work orders', async () => {
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() =>
      expect(
        screen.getByText('No work orders yet. Create a work order to start a production run.'),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId('work-order-empty-state')).toBeTruthy();
  });

  it('renders one row per work order with a status badge and a progress bar', async () => {
    workOrders = [workOrderFixture('in_progress'), workOrderFixture('draft')];
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(2));
    expect(screen.getByTestId('status-badge-in_progress')).toBeTruthy();
    expect(screen.getByTestId('status-badge-draft')).toBeTruthy();
    // 60 of 100 completed → 60%
    const bars = screen.getAllByRole('progressbar');
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0].getAttribute('aria-valuenow')).toBe('60');
  });

  it('links each row through to its detail page', async () => {
    workOrders = [workOrderFixture('completed')];
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(1));
    expect(screen.getByTestId('work-order-link').getAttribute('href')).toBe(
      '/manufacturing/production/wo-completed',
    );
  });

  it('filters by status, product name and planned date range', async () => {
    workOrders = [workOrderFixture('draft'), workOrderFixture('completed')];
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(2));

    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'draft' } });
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(1));

    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'all' } });
    fireEvent.change(screen.getByTestId('from-date'), { target: { value: '2026-12-01' } });
    await waitFor(() => expect(screen.queryAllByTestId('work-order-link')).toHaveLength(0));
  });
});

describe('work order status actions are context-sensitive', () => {
  const cases: Array<[string, string[]]> = [
    ['draft', ['Release', 'Cancel', 'View']],
    ['released', ['Start Production', 'Complete', 'Cancel', 'View']],
    ['in_progress', ['Complete', 'Cancel', 'View']],
    ['completed', ['Close', 'Cancel', 'View']],
    ['closed', ['View']],
    ['cancelled', ['View']],
  ];

  it.each(cases)('a %s work order offers exactly %j', async (status, expected) => {
    workOrders = [workOrderFixture(status)];
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(1));
    const actions = screen.getByTestId('row-actions');
    const labels = Array.from(actions.querySelectorAll('button, a'))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);
    expect(labels.sort()).toEqual([...expected].sort());
  });

  it('calls the matching release RPC for a draft order', async () => {
    workOrders = [workOrderFixture('draft')];
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(1));
    fireEvent.click(screen.getByText('Release'));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    expect(rpcCalls[0].name).toBe('manufacturing_wo_release');
    expect(rpcCalls[0].params).toEqual({ p_work_order_id: 'wo-draft' });
  });

  it('does not call the cancel RPC when the confirmation is dismissed', async () => {
    confirmAnswer = false;
    workOrders = [workOrderFixture('draft')];
    render(withProviders(<WorkOrderListPage />));
    await waitFor(() => expect(screen.getAllByTestId('work-order-link')).toHaveLength(1));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(rpcCalls).toHaveLength(0));
  });
});

describe('work order create page', () => {
  it('offers only products that have an active BOM, and explains the rest', async () => {
    render(withProviders(<WorkOrderCreatePage />));
    await waitFor(() => expect(screen.getByTestId('output-product-select')).toBeTruthy());
    const select = screen.getByTestId('output-product-select') as HTMLSelectElement;
    const options = Array.from(select.options);

    const enabled = options.filter((o) => !o.disabled).map((o) => o.textContent);
    const disabled = options.filter((o) => o.disabled).map((o) => o.textContent);

    expect(enabled.some((text) => text?.includes('Bicycle Frame'))).toBe(true);
    // The two raw materials have no BOM: they are present but not selectable,
    // and each carries the "No active BOM — create one first." explanation.
    expect(disabled.some((text) => text?.includes('Steel Bar'))).toBe(true);
    expect(disabled.some((text) => text?.includes('Bolt Pack'))).toBe(true);
    for (const text of disabled) {
      expect(text).toContain('No active BOM — create one first.');
    }
  });

  it('defaults the source and destination to the raw materials and finished goods stores', async () => {
    render(withProviders(<WorkOrderCreatePage />));
    await waitFor(() => expect(screen.getByTestId('source-location-select')).toBeTruthy());
    const from = screen.getByTestId('source-location-select') as HTMLSelectElement;
    const to = screen.getByTestId('destination-location-select') as HTMLSelectElement;
    expect(from.value).toBe('loc-raw');
    expect(to.value).toBe('loc-fg');
    // Production Floor is offered as a location but is never the default route.
    expect(Array.from(from.options).map((o) => o.value)).toContain('loc-floor');
  });

  it('calls create_work_order_from_bom with the form values on save', async () => {
    render(withProviders(<WorkOrderCreatePage />));
    await waitFor(() => expect(screen.getByTestId('output-product-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('output-product-select'), { target: { value: 'prod-frame' } });
    fireEvent.change(screen.getByTestId('planned-quantity-input'), { target: { value: '25' } });
    fireEvent.change(screen.getByTestId('planned-start-input'), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByTestId('planned-end-input'), { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByTestId('save-work-order-button'));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    expect(rpcCalls[0].name).toBe('create_work_order_from_bom');
    expect(rpcCalls[0].params).toMatchObject({
      p_business_id: BUSINESS_ID,
      p_product_id: 'prod-frame',
      p_bom_version_id: 'bom-1',
      p_quantity: 25,
      p_planned_start: '2026-11-03',
      p_planned_end: '2026-11-20',
      p_from_location_id: 'loc-raw',
      p_to_location_id: 'loc-fg',
      p_priority: 'normal',
    });
  });
});

describe('work order detail page', () => {
  beforeEach(() => {
    workOrders = [workOrderFixture('in_progress')];
    lines = [
      {
        id: 'line-1',
        work_order_id: 'wo-in_progress',
        component_product_id: 'prod-steel',
        planned_quantity: 200,
        actual_quantity_consumed: 210,
        unit_of_measure: 'pcs',
        scrap_pct: 0,
      },
      {
        id: 'line-2',
        work_order_id: 'wo-in_progress',
        component_product_id: 'prod-bolt',
        planned_quantity: 400,
        actual_quantity_consumed: 380,
        unit_of_measure: 'pcs',
        scrap_pct: 0,
      },
    ];
    runs = [
      {
        id: 'run-1',
        work_order_id: 'wo-in_progress',
        run_number: 1,
        output_quantity: 40,
        scrap_quantity: 2,
        status: 'completed',
        started_at: '2026-11-05T08:00:00Z',
        completed_at: '2026-11-05T16:00:00Z',
        notes: null,
      },
    ];
    transactions = [
      {
        id: 'txn-1',
        work_order_id: 'wo-in_progress',
        run_id: 'run-1',
        component_product_id: 'prod-steel',
        quantity: 8,
        transaction_type: 'consume',
        from_location_id: 'loc-raw',
        to_location_id: null,
        recorded_by: 'user-id',
        recorded_at: '2026-11-05T16:00:00Z',
        notes: null,
      },
    ];
  });

  it('renders the header, cost summary and all three tabs', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('status-badge')).toBeTruthy());
    expect(screen.getByText('WO-2026-IN_')).toBeTruthy();
    expect(screen.getByText('Bicycle Frame')).toBeTruthy();
    expect(screen.getByTestId('tab-materials')).toBeTruthy();
    expect(screen.getByTestId('tab-runs')).toBeTruthy();
    expect(screen.getByTestId('tab-transactions')).toBeTruthy();
    expect(screen.getByText('Cost Summary')).toBeTruthy();
  });

  it('highlights over-consumption on the materials tab', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('tab-materials')).toBeTruthy());
    // Steel: 210 consumed against 200 planned → over-consumed.
    expect(screen.getByText('Over-consumed')).toBeTruthy();
    // Exactly one component is over; the bolt line is under.
    expect(screen.getAllByText('Over-consumed')).toHaveLength(1);
  });

  it('offers Record Production Run and Record Consumption only while the order is live', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('record-run-button')).toBeTruthy());
    expect(screen.getByTestId('record-consumption-button')).toBeTruthy();

    cleanup();
    workOrders = [workOrderFixture('closed')];
    render(withDetailRoute('wo-closed'));
    await waitFor(() => expect(screen.getByTestId('status-badge')).toBeTruthy());
    expect(screen.queryByTestId('record-run-button')).toBeNull();
    expect(screen.queryByTestId('record-consumption-button')).toBeNull();
  });

  it('shows the context-sensitive status actions for an in-progress order', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('status-actions')).toBeTruthy());
    const labels = Array.from(screen.getByTestId('status-actions').querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toContain('Complete');
    expect(labels).toContain('Cancel');
    expect(labels).not.toContain('Release');
    expect(labels).not.toContain('Close');
  });

  it('makes notes editable for a draft order and read-only afterwards', async () => {
    workOrders = [workOrderFixture('draft')];
    render(withDetailRoute('wo-draft'));
    await waitFor(() => expect(screen.getByTestId('notes-textarea')).toBeTruthy());

    cleanup();
    workOrders = [workOrderFixture('completed')];
    render(withDetailRoute('wo-completed'));
    await waitFor(() => expect(screen.getByTestId('notes-readonly')).toBeTruthy());
    expect(screen.queryByTestId('notes-textarea')).toBeNull();
  });

  it('submits a production run through the record-run RPC', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('record-run-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('record-run-button'));
    await waitFor(() => expect(screen.getByTestId('run-output-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('run-output-input'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('run-scrap-input'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('run-submit-button'));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    const call = rpcCalls.find((c) => c.name === 'manufacturing_wo_record_run');
    expect(call?.params).toMatchObject({
      p_work_order_id: 'wo-in_progress',
      p_output_qty: 30,
      p_scrap_qty: 1,
    });
  });

  it('warns before submitting output that exceeds the 10% tolerance', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('record-run-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('record-run-button'));
    await waitFor(() => expect(screen.getByTestId('run-output-input')).toBeTruthy());
    // 60 already completed of 100 planned: (60 + 51) > 110 → over the tolerance.
    fireEvent.change(screen.getByTestId('run-output-input'), { target: { value: '51' } });
    expect(screen.getByText('Output exceeds planned quantity by more than 10%.')).toBeTruthy();
  });

  it('submits manual consumption through the record-consumption RPC', async () => {
    render(withDetailRoute());
    await waitFor(() => expect(screen.getByTestId('record-consumption-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('record-consumption-button'));
    await waitFor(() => expect(screen.getByTestId('consumption-component-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('consumption-component-select'), { target: { value: 'prod-steel' } });
    fireEvent.change(screen.getByTestId('consumption-quantity-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('consumption-submit-button'));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    const call = rpcCalls.find((c) => c.name === 'manufacturing_wo_record_consumption');
    expect(call?.params).toMatchObject({
      p_work_order_id: 'wo-in_progress',
      p_component_id: 'prod-steel',
      p_quantity: 5,
      p_from_location_id: 'loc-raw',
    });
  });
});
