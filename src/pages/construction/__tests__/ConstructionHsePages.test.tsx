// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  findSitesForProject: vi.fn(),
  listIncidents: vi.fn(),
  getIncidentById: vi.fn(),
  createIncident: vi.fn(),
  updateIncident: vi.fn(),
  transitionIncidentStatus: vi.fn(),
  listToolboxTalks: vi.fn(),
  createToolboxTalk: vi.fn(),
  listSubcontracts: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: { list: mocks.listProjects, listBoqVersions: vi.fn(), getBoqVersion: vi.fn() },
    construction: { findSitesForProject: mocks.findSitesForProject },
    quality: { listItps: vi.fn(), listCheckpointsByItp: vi.fn() },
    hse: {
      listIncidents: mocks.listIncidents,
      getIncidentById: mocks.getIncidentById,
      createIncident: mocks.createIncident,
      updateIncident: mocks.updateIncident,
      transitionIncidentStatus: mocks.transitionIncidentStatus,
      listToolboxTalks: mocks.listToolboxTalks,
      createToolboxTalk: mocks.createToolboxTalk,
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

import { HseIncidentDetailPage } from '@/pages/construction/HseIncidentDetailPage';
import { HseIncidentListPage } from '@/pages/construction/HseIncidentListPage';
import { HseIncidentNewPage } from '@/pages/construction/HseIncidentNewPage';
import { ToolboxTalkListPage } from '@/pages/construction/ToolboxTalkListPage';
import { ToolboxTalkNewPage } from '@/pages/construction/ToolboxTalkNewPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Business A', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
};
const project = {
  id: 'project-1', business_id: 'business-1', name: 'School Block', client_name: 'Council', client_id: null,
  status: 'active', contract_sum: 10000, retention_pct: 10, budget: 9000,
  start_date: '2026-01-01', end_date: '2027-01-01', created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', boq_locked_at: null,
};
const incident = {
  id: 'incident-1', business_id: 'business-1', project_id: project.id, site_id: null, incident_number: 'HSE-001',
  status: 'reported', severity: 'major', incident_type: 'injury', title: 'Hand injury',
  description: 'A worker injured a hand while handling equipment.', incident_date: '2026-10-20T08:30:00Z',
  location_description: 'North wing', persons_involved: 1, root_cause: null, corrective_action: null,
  evidence_reference: null, reported_by: 'user-1', closed_by: null, closed_at: null,
  created_at: '2026-10-20T08:30:00Z', updated_at: '2026-10-20T08:30:00Z',
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
  mocks.findSitesForProject.mockResolvedValue([]);
  mocks.listIncidents.mockResolvedValue([]);
  mocks.getIncidentById.mockResolvedValue(incident);
  mocks.listToolboxTalks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('construction HSE pages', () => {
  it('renders the HSE incident list page', async () => {
    renderPage(<HseIncidentListPage />);
    expect(await screen.findByRole('heading', { name: en.construction.hseIncidents.title })).toBeTruthy();
  });

  it('renders the new HSE incident page', () => {
    renderPage(<HseIncidentNewPage />);
    expect(screen.getByRole('heading', { name: en.construction.hseIncidents.newTitle })).toBeTruthy();
  });

  it('renders the HSE incident detail page', async () => {
    renderDetail('/construction/hse-incidents/incident-1', <HseIncidentDetailPage />);
    expect(await screen.findByRole('heading', { name: incident.title })).toBeTruthy();
  });

  it('renders the toolbox talk list page', async () => {
    renderPage(<ToolboxTalkListPage />);
    expect(await screen.findByRole('heading', { name: en.construction.toolboxTalks.title })).toBeTruthy();
  });

  it('renders the new toolbox talk page', () => {
    renderPage(<ToolboxTalkNewPage />);
    expect(screen.getByRole('heading', { name: en.construction.toolboxTalks.newTitle })).toBeTruthy();
  });
});
