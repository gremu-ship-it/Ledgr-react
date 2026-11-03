// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listChangeOrders: vi.fn(),
  getChangeOrder: vi.fn(),
  getProjectSummary: vi.fn(),
  createChangeOrder: vi.fn(),
  updateChangeOrder: vi.fn(),
  transitionChangeOrder: vi.fn(),
  findSitesForProject: vi.fn(),
  listSubcontracts: vi.fn(),
  listBoqVersions: vi.fn(),
  getBoqVersion: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: {
      list: mocks.listProjects,
      listBoqVersions: mocks.listBoqVersions,
      getBoqVersion: mocks.getBoqVersion,
    },
    construction: { findSitesForProject: mocks.findSitesForProject },
    changeOrder: {
      list: mocks.listChangeOrders,
      getById: mocks.getChangeOrder,
      getProjectSummary: mocks.getProjectSummary,
      create: mocks.createChangeOrder,
      update: mocks.updateChangeOrder,
      transitionStatus: mocks.transitionChangeOrder,
    },
  },
}));
vi.mock('@/dal/repositories/SubcontractRepository', () => ({
  subcontractRepository: { listSubcontracts: mocks.listSubcontracts },
}));
vi.mock('react-i18next', async () => {
  const translations = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>(
    (value, part) => (value as Record<string, unknown> | undefined)?.[part], translations,
  );
  return {
    useTranslation: () => ({
      i18n: { language: 'en' },
      t: (key: string, options?: Record<string, unknown>) => {
        const value = lookup(key);
        if (typeof value !== 'string') return key;
        return Object.entries(options ?? {}).reduce(
          (result, [name, replacement]) => result.replaceAll(`{{${name}}}`, String(replacement)),
          value,
        );
      },
    }),
  };
});

import { ChangeOrderDetailPage } from '@/pages/construction/ChangeOrderDetailPage';
import { ChangeOrderListPage } from '@/pages/construction/ChangeOrderListPage';
import { ChangeOrderNewPage } from '@/pages/construction/ChangeOrderNewPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Business A', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
};
const project = {
  id: 'project-1', business_id: 'business-1', name: 'School Block', client_name: 'Council', client_id: null,
  status: 'active', contract_sum: 10000, retention_pct: 10, budget: 9000,
  start_date: '2026-01-01', end_date: '2027-01-01', created_by: 'user-1', created_at: '', updated_at: '', boq_locked_at: null,
};
const changeOrder = {
  id: 'co-1', business_id: 'business-1', project_id: 'project-1', site_id: null,
  co_number: 'CO-001', title: 'Additional drainage', description: 'Add drainage on the east side.',
  reason: 'Unexpected groundwater.', status: 'draft', cost_impact: 1200, time_impact_days: 3,
  boq_section_id: null, subcontract_id: null, evidence_reference: 'Site instruction SI-17',
  rejection_reason: null, approved_by: null, approved_at: null, submitted_by: null, submitted_at: null,
  created_by: 'user-1', created_at: '2026-11-30T08:00:00Z', updated_at: '2026-11-30T08:00:00Z',
};

function renderPage(page: ReactNode, path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/construction/change-orders/:id" element={page} />
          <Route path="*" element={page} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.listProjects.mockResolvedValue({ rows: [project], count: 1 });
  mocks.listChangeOrders.mockResolvedValue([changeOrder]);
  mocks.getChangeOrder.mockResolvedValue(changeOrder);
  mocks.getProjectSummary.mockResolvedValue({
    project_id: 'project-1', by_status: {}, total_count: 1, total_cost_impact: 1200, total_time_impact_days: 3,
  });
  mocks.createChangeOrder.mockResolvedValue(changeOrder);
  mocks.updateChangeOrder.mockResolvedValue(changeOrder);
  mocks.transitionChangeOrder.mockResolvedValue(undefined);
  mocks.findSitesForProject.mockResolvedValue([]);
  mocks.listSubcontracts.mockResolvedValue([]);
  mocks.listBoqVersions.mockResolvedValue([]);
  mocks.getBoqVersion.mockResolvedValue({ sections: [] });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('construction change order pages', () => {
  it('renders the register, project, status, and impact columns', async () => {
    renderPage(<ChangeOrderListPage />);

    expect(await screen.findByRole('heading', { name: en.changeOrders.title })).toBeTruthy();
    expect(await screen.findByText('CO-001')).toBeTruthy();
    expect(screen.getAllByText('School Block').length).toBeGreaterThan(0);
    expect(screen.getAllByText(en.changeOrders.statuses.draft).length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: en.changeOrders.columns.costImpact })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: en.changeOrders.columns.timeImpact })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.changeOrders.new })).toBeTruthy();
  });

  it('renders change-order detail and uses the repository lifecycle method for submission', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage(<ChangeOrderDetailPage />, '/construction/change-orders/co-1');

    expect(await screen.findByRole('heading', { name: 'CO-001' })).toBeTruthy();
    expect(screen.getByText(changeOrder.description)).toBeTruthy();
    expect(screen.getByText(changeOrder.reason)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.changeOrders.submit })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.changeOrders.edit })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.changeOrders.submit }));

    await waitFor(() => expect(mocks.transitionChangeOrder).toHaveBeenCalledWith('co-1', 'submitted', undefined));
    expect(confirm).toHaveBeenCalledWith(en.changeOrders.confirmSubmit);
    confirm.mockRestore();
  });

  it('requires a reason in the rejection dialog and only offers submitted-state actions', async () => {
    mocks.getChangeOrder.mockResolvedValue({
      ...changeOrder,
      status: 'submitted',
      submitted_by: 'user-1',
      submitted_at: '2026-11-30T09:00:00Z',
    });
    renderPage(<ChangeOrderDetailPage />, '/construction/change-orders/co-1');

    expect(await screen.findByRole('button', { name: en.changeOrders.approve })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.changeOrders.reject })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.changeOrders.edit })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.changeOrders.reject }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(en.changeOrders.confirmReject)).toBeTruthy();
    const rejectDialog = within(screen.getByRole('dialog'));
    expect((rejectDialog.getByRole('button', { name: en.changeOrders.reject }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(rejectDialog.getByLabelText(en.changeOrders.rejectionReason, { exact: false }), { target: { value: 'Scope no longer required.' } });
    fireEvent.click(rejectDialog.getByRole('button', { name: en.changeOrders.reject }));
    await waitFor(() => expect(mocks.transitionChangeOrder).toHaveBeenCalledWith('co-1', 'rejected', 'Scope no longer required.'));
  });

  it('renders the create form with project, change details, deltas, and evidence reference', async () => {
    renderPage(<ChangeOrderNewPage />);

    expect(await screen.findByRole('heading', { name: en.changeOrders.newTitle })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.project, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.number, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.title, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.description, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.reason, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.costImpact, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.timeImpact, { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(en.changeOrders.fields.evidenceReference, { exact: false })).toBeTruthy();
  });
});
