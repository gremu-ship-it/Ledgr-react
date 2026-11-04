// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;

const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    en,
  );

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const value = lookup(key);
      let text = typeof value === 'string' ? value : key;
      if (opts) {
        for (const [name, replacement] of Object.entries(opts)) {
          text = text.split(`{{${name}}}`).join(String(replacement));
        }
      }
      return text;
    },
  }),
}));

const state = vi.hoisted(() => ({
  planTier: 'growth' as string,
  canWrite: true,
  operatingModels: [] as string[],
  locations: [] as Array<Record<string, unknown>>,
  branches: [] as Array<Record<string, unknown>>,
  deactivateCheck: { ok: true, reasons: [] } as {
    ok: boolean;
    reasons: Array<{ code: string; count?: number }>;
  },
}));

vi.mock('@/hooks/useUsage', () => ({
  useUsage: () => ({ planTier: state.planTier }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canWrite: state.canWrite, canRead: true, canDelete: false }),
  isPathAllowedForRole: () => true,
}));

vi.mock('@/hooks/useBusinessProfile', () => ({
  useBusinessProfile: () => ({ profile: { operating_models: state.operatingModels } }),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    location: {
      getAll: vi.fn(async () => state.locations),
      getById: vi.fn(async () => state.locations[0]),
      create: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'new-loc' })),
      updateLocation: vi.fn(async (id: string) => ({ id })),
      setDefault: vi.fn(async () => undefined),
      deactivate: vi.fn(async () =>
        state.deactivateCheck.ok
          ? { ok: true, reasons: [], deactivated: true }
          : { ...state.deactivateCheck, deactivated: false },
      ),
      reactivate: vi.fn(async () => undefined),
      canDeactivate: vi.fn(async () => state.deactivateCheck),
    },
    branch: { findByBusiness: vi.fn(async () => state.branches) },
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({ data: [{ id: 'proj-1', name: 'Zomba Road' }], error: null }),
        }),
      }),
    }),
  },
}));

import { repos } from '@/lib/repositories';
import { LocationsTab } from '../LocationsTab';

const BIZ = 'biz-1';

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsTab businessId={BIZ} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const locationRow = (overrides: Record<string, unknown>) => ({
  id: 'loc-1',
  business_id: BIZ,
  branch_id: null,
  name: 'Main Store',
  code: 'MAIN',
  location_type: 'warehouse',
  project_id: null,
  is_default: false,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  branches: null,
  ...overrides,
});

beforeEach(() => {
  state.planTier = 'growth';
  state.canWrite = true;
  state.operatingModels = [];
  state.locations = [];
  state.branches = [];
  state.deactivateCheck = { ok: true, reasons: [] };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LocationsTab — plan gating (minPlan growth, same as Branches)', () => {
  it('shows the upgrade prompt instead of locations below growth', async () => {
    state.planTier = 'starter';
    renderTab();
    expect(await screen.findByText('Locations requires an upgrade')).toBeTruthy();
    expect(screen.getByText(/available on the Growth plan and above/)).toBeTruthy();
    expect(screen.getByText('View plans')).toBeTruthy();
    expect(repos.location.getAll).not.toHaveBeenCalled();
  });

  it('renders the list on growth and above', async () => {
    state.planTier = 'growth';
    state.locations = [locationRow({})];
    renderTab();
    expect(await screen.findByText('Main Store')).toBeTruthy();
    expect(repos.location.getAll).toHaveBeenCalledWith(BIZ);
  });
});

describe('LocationsTab — the list', () => {
  it('renders translated type labels, branch names, default stars and inactive badges', async () => {
    state.locations = [
      locationRow({ id: 'loc-1', name: 'Main Store', location_type: 'warehouse', is_default: true }),
      locationRow({
        id: 'loc-2',
        name: 'Old Yard',
        location_type: 'material_yard',
        is_active: false,
        branch_id: 'br-1',
        branches: { name: 'Blantyre Branch' },
      }),
    ];
    renderTab();
    expect(await screen.findByText('Main Store')).toBeTruthy();
    // The raw DB vocabulary must never reach the table — it is translated
    // through manufacturing.locationType.*.
    expect(screen.getByText('Warehouse')).toBeTruthy();
    expect(screen.getByText('Material Yard')).toBeTruthy();
    expect(screen.queryByText('material_yard')).toBeNull();
    expect(screen.getByText('Blantyre Branch')).toBeTruthy();
    // Inactive badge on the deactivated row.
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    // Default star carries its title.
    expect(screen.getByTitle('Default location')).toBeTruthy();
  });

  it('hides the project column entirely for businesses without construction', async () => {
    state.operatingModels = [];
    state.locations = [locationRow({})];
    renderTab();
    await screen.findByText('Main Store');
    expect(screen.queryByText('Linked project')).toBeNull();
  });

  it('shows the project column for CONSTRUCTION businesses with a jump link', async () => {
    state.operatingModels = ['CONSTRUCTION'];
    state.locations = [locationRow({ project_id: 'proj-1' })];
    renderTab();
    await screen.findByText('Main Store');
    expect(screen.getByText('Linked project')).toBeTruthy();
    // No raw DB vocabulary: the column shows the resolved project name and
    // links to the existing project route (no new routes added).
    expect(screen.queryByText('proj-1')).toBeNull();
    const link = (await screen.findByText('Zomba Road')).closest('a');
    expect(link?.getAttribute('href')).toBe('/construction/projects/proj-1');
  });
});

describe('LocationsTab — type picker filtering (absent, not locked)', () => {
  async function openTypeOptions(models: string[]) {
    state.operatingModels = models;
    renderTab();
    fireEvent.click(await screen.findByTestId('add-location'));
    const select = await screen.findByTestId('location-form-type');
    return Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
  }

  it('offers only warehouse with no vertical models', async () => {
    const labels = await openTypeOptions([]);
    expect(labels).toEqual(['Warehouse']);
  });

  it('adds manufacturing stores only for MANUFACTURING', async () => {
    const labels = await openTypeOptions(['MANUFACTURING']);
    expect(labels).toEqual([
      'Warehouse',
      'Raw Materials Store',
      'Production Floor',
      'Finished Goods Store',
    ]);
  });

  it('adds construction site types only for CONSTRUCTION', async () => {
    const labels = await openTypeOptions(['CONSTRUCTION']);
    expect(labels).toEqual(['Warehouse', 'Job Site', 'Site Office', 'Material Yard']);
  });

  it('offers everything to a dual-vertical business', async () => {
    const labels = await openTypeOptions(['CONSTRUCTION', 'MANUFACTURING']);
    expect(labels).toEqual([
      'Warehouse',
      'Raw Materials Store',
      'Production Floor',
      'Finished Goods Store',
      'Job Site',
      'Site Office',
      'Material Yard',
    ]);
  });

  it('creates with the chosen type and the write gate controls the Add button', async () => {
    state.operatingModels = ['CONSTRUCTION'];
    renderTab();
    fireEvent.click(await screen.findByTestId('add-location'));
    fireEvent.change(await screen.findByTestId('location-form-name'), {
      target: { value: 'Zomba Yard' },
    });
    fireEvent.change(screen.getByTestId('location-form-type'), {
      target: { value: 'material_yard' },
    });
    fireEvent.click(screen.getByTestId('location-form-save'));
    await waitFor(() => expect(repos.location.create).toHaveBeenCalled());
    expect(repos.location.create).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: BIZ,
        name: 'Zomba Yard',
        location_type: 'material_yard',
      }),
    );
  });

  it('hides the Add button without write permission', async () => {
    state.canWrite = false;
    state.locations = [locationRow({})];
    renderTab();
    await screen.findByTestId('locations-table');
    expect(screen.queryByTestId('add-location')).toBeNull();
    // Row actions are also gated — read-only users get no edit controls.
    expect(screen.queryByTestId('location-edit-loc-1')).toBeNull();
  });
});

describe('LocationsTab — safe deactivation flow', () => {
  it('blocks with the specific stock reason and refuses to confirm', async () => {
    state.locations = [locationRow({ id: 'loc-rm', name: 'Raw Materials Store' })];
    state.deactivateCheck = { ok: false, reasons: [{ code: 'stock_on_hand', count: 150 }] };
    renderTab();
    fireEvent.click(await screen.findByTestId('location-deactivate-loc-rm'));

    expect(await screen.findByTestId('deactivate-blocked')).toBeTruthy();
    expect(screen.getByText('Cannot deactivate')).toBeTruthy();
    expect(screen.getByText(/150 units of stock on hand/)).toBeTruthy();
    // The confirm button must not exist while a block is showing — and the
    // repository deactivate (which re-checks anyway) must not be reached.
    expect(screen.queryByTestId('deactivate-confirm')).toBeNull();
    expect(repos.location.deactivate).not.toHaveBeenCalled();
  });

  it('lists every blocking reason at once', async () => {
    state.locations = [locationRow({ id: 'loc-1', is_default: true })];
    state.deactivateCheck = {
      ok: false,
      reasons: [
        { code: 'open_work_orders', count: 2 },
        { code: 'active_procurement_site', count: 1 },
        { code: 'last_default' },
      ],
    };
    renderTab();
    fireEvent.click(await screen.findByTestId('location-deactivate-loc-1'));
    await screen.findByTestId('deactivate-blocked');
    expect(screen.getByText(/assigned to 2 open work order/)).toBeTruthy();
    expect(screen.getByText(/linked to an active procurement site/)).toBeTruthy();
    expect(screen.getByText(/Cannot deactivate the only default location/)).toBeTruthy();
    // A blocked dialog still offers a way out, just not a confirm.
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('offers confirm only after the checks pass, then deactivates', async () => {
    state.locations = [locationRow({ id: 'loc-1' })];
    state.deactivateCheck = { ok: true, reasons: [] };
    renderTab();
    fireEvent.click(await screen.findByTestId('location-deactivate-loc-1'));
    const confirm = await screen.findByTestId('deactivate-confirm');
    expect(screen.queryByTestId('deactivate-blocked')).toBeNull();
    // The confirm button stays disabled until the pre-check query resolves —
    // a click before that must never reach the repository.
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(repos.location.deactivate).toHaveBeenCalledWith(BIZ, 'loc-1'));
    expect(await screen.findByText('Location deactivated.')).toBeTruthy();
  });

  it('reactivates an inactive location with a single click', async () => {
    state.locations = [locationRow({ id: 'loc-2', name: 'Old Yard', is_active: false })];
    renderTab();
    fireEvent.click(await screen.findByTestId('location-reactivate-loc-2'));
    await waitFor(() => expect(repos.location.reactivate).toHaveBeenCalledWith(BIZ, 'loc-2'));
    expect(await screen.findByText('Location reactivated.')).toBeTruthy();
  });
});

describe('LocationsTab — default management', () => {
  it('sets a location as default directly when nothing else holds the flag', async () => {
    state.locations = [
      locationRow({ id: 'loc-1' }),
      locationRow({ id: 'loc-2', name: 'Site Office' }),
    ];
    renderTab();
    fireEvent.click(await screen.findByTestId('location-set-default-loc-2'));
    await waitFor(() => expect(repos.location.setDefault).toHaveBeenCalledWith(BIZ, 'loc-2'));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('confirms before taking the default away from another location', async () => {
    state.locations = [
      locationRow({ id: 'loc-1', name: 'Main Store', is_default: true }),
      locationRow({ id: 'loc-2', name: 'Site Office' }),
    ];
    renderTab();
    fireEvent.click(await screen.findByTestId('location-set-default-loc-2'));
    // Confirmation dialog names the location losing the flag.
    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText(/replace Main Store as your default stock location/)).toBeTruthy();
    expect(repos.location.setDefault).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(repos.location.setDefault).toHaveBeenCalledWith(BIZ, 'loc-2'));
    expect(await screen.findByText('Default location updated.')).toBeTruthy();
  });

  it('offers no set-default action on the row that is already default', async () => {
    state.locations = [locationRow({ id: 'loc-1', is_default: true })];
    renderTab();
    await screen.findByTestId('location-row-loc-1');
    expect(screen.queryByTestId('location-set-default-loc-1')).toBeNull();
  });
});
