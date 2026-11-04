// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listBoqVersions: vi.fn(),
  getBoqVersion: vi.fn(),
  findSitesForProject: vi.fn(),
  listSubcontracts: vi.fn(),
  listItps: vi.fn(),
  getItpById: vi.fn(),
  listCheckpointsByItp: vi.fn(),
  createItp: vi.fn(),
  createCheckpoint: vi.fn(),
  updateCheckpoint: vi.fn(),
  transitionItpStatus: vi.fn(),
  listNcrs: vi.fn(),
  getNcrById: vi.fn(),
  createNcr: vi.fn(),
  updateNcr: vi.fn(),
  transitionNcrStatus: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: {
      list: mocks.listProjects,
      listBoqVersions: mocks.listBoqVersions,
      getBoqVersion: mocks.getBoqVersion,
    },
    construction: { findSitesForProject: mocks.findSitesForProject },
    quality: {
      listItps: mocks.listItps,
      getItpById: mocks.getItpById,
      listCheckpointsByItp: mocks.listCheckpointsByItp,
      createItp: mocks.createItp,
      createCheckpoint: mocks.createCheckpoint,
      updateCheckpoint: mocks.updateCheckpoint,
      transitionItpStatus: mocks.transitionItpStatus,
      listNcrs: mocks.listNcrs,
      getNcrById: mocks.getNcrById,
      createNcr: mocks.createNcr,
      updateNcr: mocks.updateNcr,
      transitionNcrStatus: mocks.transitionNcrStatus,
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

import { ItpDetailPage } from '@/pages/construction/ItpDetailPage';
import { ItpListPage } from '@/pages/construction/ItpListPage';
import { ItpNewPage } from '@/pages/construction/ItpNewPage';
import { NcrDetailPage } from '@/pages/construction/NcrDetailPage';
import { NcrListPage } from '@/pages/construction/NcrListPage';
import { NcrNewPage } from '@/pages/construction/NcrNewPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Business A', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
};
const project = {
  id: 'project-1', business_id: 'business-1', name: 'School Block', client_name: 'Council', client_id: null,
  status: 'active', contract_sum: 10000, retention_pct: 10, budget: 9000,
  start_date: '2026-01-01', end_date: '2027-01-01', created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', boq_locked_at: null,
};
const itp = {
  id: 'itp-1', business_id: 'business-1', project_id: project.id, site_id: null, itp_number: 'ITP-001',
  title: 'Concrete placement', scope: 'Inspect concrete placement.', status: 'draft', boq_section_id: null,
  subcontract_id: null, evidence_reference: null, created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const ncr = {
  id: 'ncr-1', business_id: 'business-1', project_id: project.id, site_id: null, ncr_number: 'NCR-001',
  title: 'Concrete finish issue', description: 'The surface does not meet specification.', severity: 'major',
  status: 'open', root_cause: null, corrective_action: null, preventive_action: null, itp_checkpoint_id: null,
  subcontract_id: null, evidence_reference: null, created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

function renderPage(element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>);
}

function renderDetail(path: string, element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={`${path.slice(0, path.lastIndexOf('/'))}/:id`} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.listProjects.mockResolvedValue({ rows: [project], count: 1 });
  mocks.listBoqVersions.mockResolvedValue([]);
  mocks.getBoqVersion.mockResolvedValue({ sections: [] });
  mocks.findSitesForProject.mockResolvedValue([]);
  mocks.listSubcontracts.mockResolvedValue([]);
  mocks.listItps.mockResolvedValue([]);
  mocks.getItpById.mockResolvedValue(itp);
  mocks.listCheckpointsByItp.mockResolvedValue([]);
  mocks.listNcrs.mockResolvedValue([]);
  mocks.getNcrById.mockResolvedValue(ncr);
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('construction quality pages', () => {
  it('renders the ITP list page', async () => {
    renderPage(<ItpListPage />);
    expect(await screen.findByRole('heading', { name: en.construction.itps.title })).toBeTruthy();
  });

  it('renders the new ITP page', () => {
    renderPage(<ItpNewPage />);
    expect(screen.getByRole('heading', { name: en.construction.itps.newTitle })).toBeTruthy();
  });

  it('renders the ITP detail page', async () => {
    renderDetail('/construction/itps/itp-1', <ItpDetailPage />);
    expect(await screen.findByRole('heading', { name: itp.title })).toBeTruthy();
  });

  it('renders the NCR list page', async () => {
    renderPage(<NcrListPage />);
    expect(await screen.findByRole('heading', { name: en.construction.ncrs.title })).toBeTruthy();
  });

  it('renders the new NCR page', () => {
    renderPage(<NcrNewPage />);
    expect(screen.getByRole('heading', { name: en.construction.ncrs.newTitle })).toBeTruthy();
  });

  it('renders the NCR detail page', async () => {
    renderDetail('/construction/ncrs/ncr-1', <NcrDetailPage />);
    expect(await screen.findByRole('heading', { name: ncr.title })).toBeTruthy();
  });
});
