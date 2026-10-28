// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAppStore } from '@/store/useAppStore';

const repository = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock('@/dal/repositories/ConstructionRepository', () => ({
  constructionRepository: repository,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { ConstructionProjectsPage } from './ConstructionProjectsPage';

const PROJECT = {
  id: 'project-1',
  business_id: 'business-1',
  name: 'Bridge rehabilitation',
  client_name: 'District Council',
  contract_sum: 250000,
  retention_pct: 5,
  budget: 210000,
  status: 'active' as const,
  start_date: '2026-11-01',
  end_date: null,
  created_by: 'user-1',
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  boq_locked_at: null,
  client_id: null,
};

function renderPage() {
  return render(<MemoryRouter><ConstructionProjectsPage /></MemoryRouter>);
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    currentBusiness: {
      role: 'owner',
      business: { id: 'business-1', name: 'Works Department', base_currency: 'MWK' },
    },
  });
  repository.listProjects.mockResolvedValue([PROJECT]);
  repository.createProject.mockResolvedValue({ ...PROJECT, id: 'project-2', status: 'draft' });
});

describe('ConstructionProjectsPage', () => {
  it('loads real project records for the selected business', async () => {
    renderPage();
    expect(await screen.findByText('Bridge rehabilitation')).toBeTruthy();
    expect(screen.getByText('District Council')).toBeTruthy();
    expect(repository.listProjects).toHaveBeenCalledWith('business-1');
    expect(screen.getByRole('link', { name: 'construction.openProject' })).toBeTruthy();
  });

  it('submits validated project details to the persistence repository', async () => {
    repository.listProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([PROJECT]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'construction.createFirstProject' }));
    fireEvent.change(screen.getByLabelText(/construction.fields.projectName/), { target: { value: 'New clinic' } });
    fireEvent.change(screen.getByLabelText(/construction.fields.clientName/), { target: { value: 'Health Ministry' } });
    fireEvent.click(screen.getByRole('button', { name: 'construction.createProject' }));

    await waitFor(() => expect(repository.createProject).toHaveBeenCalledWith('business-1', expect.objectContaining({
      name: 'New clinic',
      client_name: 'Health Ministry',
      contract_sum: 0,
      budget: 0,
    })));
    expect(await screen.findByText('Bridge rehabilitation')).toBeTruthy();
  });
});
