// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';
import type { BoqSectionWithItems, BoqVersionWithTree, Project } from '@/dal/repositories/ProjectRepository';

const mock = vi.hoisted(() => ({
  projects: {
    listBoqVersions: vi.fn(), getBoqVersion: vi.fn(), getBoqSummary: vi.fn(), createBoqVersion: vi.fn(), activateBoqVersion: vi.fn(),
    createSection: vi.fn(), updateSection: vi.fn(), deleteSection: vi.fn(), reorderSections: vi.fn(),
    createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), bulkImportItems: vi.fn(),
  },
  from: vi.fn(),
}));
vi.mock('@/lib/repositories', () => ({ repos: { projects: mock.projects } }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mock.from } }));
import { ProjectBoqVersionEditor } from '../ProjectBoqVersionEditor';

const project: Project = {
  id: 'project-1', business_id: 'business-1', name: 'Clinic', client_name: 'City', client_id: null,
  status: 'active', contract_sum: 100, retention_pct: 0, budget: 120,
  start_date: null, end_date: null, created_by: 'user-1', created_at: '', updated_at: '', boq_locked_at: null,
};
const item = {
  id: 'item-1', boq_version_id: 'version-1', section_id: 'section-3', business_id: 'business-1',
  item_number: '1.1.1.1', description: 'Footing excavation', unit_of_measure: 'm³', quantity: 2,
  rate: 10, amount: 20, product_id: null, cost_code: null, is_provisional: false, notes: null, sort_order: 0,
};
const provisionalItem = {
  ...item, id: 'item-2', section_id: 'section-2', item_number: '1.1.2', description: 'Provisional allowance',
  unit_of_measure: 'lot', quantity: 1, rate: 10, amount: 10, is_provisional: true,
};
const tree: BoqSectionWithItems[] = [{
  id: 'section-1', boq_version_id: 'version-1', business_id: 'business-1', parent_section_id: null,
  code: '1', title: 'Substructure', description: null, sort_order: 0, level: 0, items: [], sectionTotal: 30,
  children: [{
    id: 'section-2', boq_version_id: 'version-1', business_id: 'business-1', parent_section_id: 'section-1',
    code: '1.1', title: 'Concrete works', description: null, sort_order: 0, level: 1,
    items: [provisionalItem], sectionTotal: 30,
    children: [{
      id: 'section-3', boq_version_id: 'version-1', business_id: 'business-1', parent_section_id: 'section-2',
      code: '1.1.1', title: 'Foundations', description: null, sort_order: 0, level: 2,
      items: [item], children: [], sectionTotal: 20,
    }],
  }],
}];
const activeVersion: BoqVersionWithTree = {
  id: 'version-1', business_id: 'business-1', project_id: 'project-1', version_number: 1,
  version_label: 'Tender issue', status: 'active', total_value: 30, currency: 'MWK', notes: null,
  created_at: '', created_by: 'user-1', sections: tree,
};
const draftVersion: BoqVersionWithTree = { ...activeVersion, id: 'version-2', version_number: 2, status: 'draft', total_value: 30 };

function mount(canManage = true, record = project) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProjectBoqVersionEditor project={record} canManage={canManage} currency="MWK" onNotice={vi.fn()} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('en');
  mock.projects.listBoqVersions.mockResolvedValue([{
    id: activeVersion.id, business_id: activeVersion.business_id, project_id: activeVersion.project_id,
    version_number: 1, version_label: activeVersion.version_label, status: activeVersion.status,
    total_value: activeVersion.total_value, currency: activeVersion.currency, notes: null, created_at: '', created_by: 'user-1',
  }]);
  mock.projects.getBoqVersion.mockResolvedValue(activeVersion);
  mock.projects.getBoqSummary.mockResolvedValue({ total_boq_value: 30, contract_sum: 100, variance: 70, line_count: 2, is_locked: false });
  mock.projects.createBoqVersion.mockResolvedValue('version-2');
  mock.projects.activateBoqVersion.mockResolvedValue(undefined);
  mock.projects.createSection.mockResolvedValue('section-new');
  mock.projects.updateSection.mockResolvedValue(undefined);
  mock.projects.deleteSection.mockResolvedValue(undefined);
  mock.projects.reorderSections.mockResolvedValue(undefined);
  mock.projects.createItem.mockResolvedValue('item-new');
  mock.projects.updateItem.mockResolvedValue(undefined);
  mock.projects.deleteItem.mockResolvedValue(undefined);
  mock.projects.bulkImportItems.mockResolvedValue(0);
  mock.from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    return query;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProjectBoqVersionEditor', () => {
  it('renders three nested section levels, provisional sums and contract/budget variances', async () => {
    mount();
    expect(await screen.findByText('Footing excavation')).toBeTruthy();
    expect(screen.getByText('Concrete works')).toBeTruthy();
    expect(screen.getByText('Foundations')).toBeTruthy();
    expect(screen.getByText('Provisional sum')).toBeTruthy();
    expect(screen.getByTestId('boq-summary').textContent).toContain('30.00');
    expect(screen.getByTestId('boq-summary').textContent).toContain('70.00');
    expect(screen.getByTestId('boq-summary').textContent).toContain('90.00');
    expect(screen.getByRole('option', { name: 'Version 1 · Tender issue · Active' })).toBeTruthy();
  });

  it('adds a subsection under a nested section on an editable draft', async () => {
    mock.projects.listBoqVersions.mockResolvedValue([{
      id: draftVersion.id, business_id: draftVersion.business_id, project_id: draftVersion.project_id,
      version_number: 2, version_label: 'Revision', status: 'draft', total_value: 30, currency: 'MWK', notes: null, created_at: '', created_by: 'user-1',
    }]);
    mock.projects.getBoqVersion.mockResolvedValue(draftVersion);
    mount();
    await screen.findByText('Footing excavation');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add subsection' })[1]);
    fireEvent.change(screen.getByLabelText('Section code'), { target: { value: '1.1.1.1' } });
    fireEvent.change(screen.getByLabelText('Section title'), { target: { value: 'Formwork' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mock.projects.createSection).toHaveBeenCalledWith('business-1', expect.objectContaining({
      boq_version_id: 'version-2', parent_section_id: 'section-2', code: '1.1.1.1', title: 'Formwork',
    })));
  });

  it('creates a labeled follow-on version with active-version cloning enabled by default', async () => {
    mount();
    await screen.findByText('Footing excavation');
    fireEvent.click(screen.getAllByRole('button', { name: 'New version' })[0]);
    const dialog = screen.getByRole('dialog');
    const clone = within(dialog).getByRole('checkbox', { name: 'Copy the active BOQ into this draft' }) as HTMLInputElement;
    expect(clone.checked).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Version label (optional)'), { target: { value: 'Issued for construction' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New version' }));
    await waitFor(() => expect(mock.projects.createBoqVersion).toHaveBeenCalledWith('business-1', expect.objectContaining({
      project_id: 'project-1', version_label: 'Issued for construction', currency: 'MWK', clone_from_active: true,
    })));
  });

  it('activates a draft only after confirmation and delegates archiving to the repository', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mock.projects.listBoqVersions.mockResolvedValue([{
      id: draftVersion.id, business_id: draftVersion.business_id, project_id: draftVersion.project_id,
      version_number: 2, version_label: 'Revision', status: 'draft', total_value: 30, currency: 'MWK', notes: null, created_at: '', created_by: 'user-1',
    }]);
    mock.projects.getBoqVersion.mockResolvedValue(draftVersion);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Activate draft' }));
    await waitFor(() => expect(mock.projects.activateBoqVersion).toHaveBeenCalledWith('business-1', 'version-2'));
  });

  it('keeps the editor read-only when the legacy valuation lock is set', async () => {
    mount(true, { ...project, boq_locked_at: '2026-10-29T12:00:00Z' });
    expect(await screen.findByText(/This BOQ is locked because a progress valuation has been created/)).toBeTruthy();
    expect(await screen.findByText('Footing excavation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate draft' })).toBeNull();
    expect((screen.getByLabelText('Quantity for item 1.1.1.1') as HTMLInputElement).disabled).toBe(true);
  });
});
