// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listRfis: vi.fn(),
  getRfi: vi.fn(),
  createRfi: vi.fn(),
  updateRfi: vi.fn(),
  transitionRfi: vi.fn(),
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
    rfi: {
      listByBusiness: mocks.listRfis,
      listByProject: mocks.listRfis,
      getById: mocks.getRfi,
      create: mocks.createRfi,
      update: mocks.updateRfi,
      transitionStatus: mocks.transitionRfi,
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

import { RfiDetailPage } from '@/pages/construction/RfiDetailPage';
import { RfiListPage } from '@/pages/construction/RfiListPage';
import { RfiNewPage } from '@/pages/construction/RfiNewPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Business A', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
};
const project = {
  id: 'project-1', business_id: 'business-1', name: 'School Block', client_name: 'Council', client_id: null,
  status: 'active', contract_sum: 10000, retention_pct: 10, budget: 9000,
  start_date: '2026-01-01', end_date: '2027-01-01', created_by: 'user-1', created_at: '', updated_at: '', boq_locked_at: null,
};
const rfi = {
  id: 'rfi-1', business_id: 'business-1', project_id: 'project-1', site_id: null,
  rfi_number: 'RFI-001', title: 'Confirm concrete finish', question: 'Please confirm the specified finish.',
  response: null, evidence: 'Drawing A-12, revision 3', proposed_solution: 'Use the revised detail.',
  boq_item_id: null, subcontract_id: null, drawing_reference: 'A-12 Rev 3',
  status: 'draft', priority: 'normal', due_date: null, answered_at: null, answered_by: null,
  closed_at: null, created_by: 'user-1', updated_by: 'user-1',
  created_at: '2026-11-28T08:00:00Z', updated_at: '2026-11-28T08:00:00Z',
};

function renderPage(page: ReactNode, path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/construction/rfis/:id" element={page} /><Route path="*" element={page} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.listProjects.mockResolvedValue({ rows: [project], count: 1 });
  mocks.listRfis.mockResolvedValue([rfi]);
  mocks.getRfi.mockResolvedValue(rfi);
  mocks.createRfi.mockResolvedValue(rfi);
  mocks.updateRfi.mockResolvedValue(rfi);
  mocks.transitionRfi.mockResolvedValue(rfi);
  mocks.findSitesForProject.mockResolvedValue([]);
  mocks.listSubcontracts.mockResolvedValue([]);
  mocks.listBoqVersions.mockResolvedValue([]);
  mocks.getBoqVersion.mockResolvedValue({ sections: [] });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('construction RFI pages', () => {
  it('renders the RFI register and project row', async () => {
    renderPage(<RfiListPage />);

    expect(await screen.findByRole('heading', { name: en.construction.rfis.title })).toBeTruthy();
    expect(await screen.findByText('RFI-001')).toBeTruthy();
    expect(screen.getAllByText(en.construction.rfis.statuses.draft).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: en.construction.rfis.actions.new })).toBeTruthy();
  });

  it('renders RFI detail, question, and draft actions', async () => {
    renderPage(<RfiDetailPage />, '/construction/rfis/rfi-1');

    expect(await screen.findByRole('heading', { name: 'RFI-001' })).toBeTruthy();
    expect(screen.getByText(rfi.question)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.construction.rfis.actions.submit })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.construction.rfis.actions.edit })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.construction.rfis.actions.cancelRfi })).toBeTruthy();
  });

  it('renders the new RFI form with required project and question fields', async () => {
    renderPage(<RfiNewPage />);

    expect(await screen.findByRole('heading', { name: en.construction.rfis.newTitle })).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(en.construction.rfis.fields.project))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(en.construction.rfis.fields.number))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(en.construction.rfis.fields.question))).toBeTruthy();
    expect(screen.getByLabelText(en.construction.rfis.fields.proposedSolution)).toBeTruthy();
    expect(screen.getByLabelText(en.construction.rfis.fields.evidenceReference)).toBeTruthy();
  });
});
