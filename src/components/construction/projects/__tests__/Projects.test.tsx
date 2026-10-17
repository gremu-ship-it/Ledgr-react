// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';
import type {
  Project,
  ProjectStatus,
  ProjectValuationDocument,
  ProjectValuationStatus,
} from '@/dal/repositories/ProjectRepository';
const mock = vi.hoisted(() => ({
  projects: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    transitionStatus: vi.fn(),
    locations: vi.fn(),
    linkSite: vi.fn(),
    unlinkSite: vi.fn(),
    getBoqLines: vi.fn(),
    getBoqSummary: vi.fn(),
    bulkUpsertBoqLines: vi.fn(),
    getValuationHistory: vi.fn(),
    getRetentionSummary: vi.fn(),
    createValuation: vi.fn(),
    updateValuation: vi.fn(),
    submitValuation: vi.fn(),
    generateInvoice: vi.fn(),
    releaseRetention: vi.fn(),
  },
  construction: {
    findPurchaseOrders: vi.fn(),
    findMaterialIssues: vi.fn(),
    findSites: vi.fn(),
  },
}));
vi.mock('@/lib/repositories', () => ({ repos: mock }));
vi.mock('../../ConstructionPurchaseOrdersSection', () => ({
  ConstructionPurchaseOrdersSection: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-orders">{projectId}</div>
  ),
}));
vi.mock('../../ConstructionMaterialIssuesSection', () => ({
  ConstructionMaterialIssuesSection: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-issues">{projectId}</div>
  ),
}));
vi.mock('../../ConstructionReturnsSection', () => ({
  ConstructionReturnsSection: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-returns">{projectId}</div>
  ),
}));
import { ProjectsSection } from '../ProjectsSection';
import { ProjectForm } from '../ProjectForm';
import { validateProject } from '@/lib/construction/projectValidation';
import { ProjectDetail } from '../ProjectDetail';
const grants = ['procurement.master.manage'];
const project: Project = {
  id: 'p1',
  business_id: 'b1',
  name: 'Hospital',
  client_name: 'City Council',
  status: 'tender',
  contract_sum: 1000,
  retention_pct: 10,
  budget: 800,
  start_date: '2026-10-01',
  end_date: '2027-10-01',
  created_by: 'u1',
  created_at: '',
  updated_at: '',
  boq_locked_at: null,
};
function detail(status: ProjectStatus = 'tender') {
  return {
    ...project,
    status,
    site_count: 1,
    cost: {
      total_po_value: 400,
      total_issued_value: 200,
      total_returned_value: 50,
      net_cost: 350,
    },
  };
}
function valuationDocument(status: ProjectValuationStatus = 'draft'): ProjectValuationDocument {
  return {
    valuation: {
      id: 'v1',
      project_id: 'p1',
      valuation_number: 1,
      valuation_date: '2026-10-17',
      period_start: null,
      period_end: null,
      gross_amount: 250,
      retention_amount: 25,
      net_amount: 225,
      previous_cumulative: 0,
      status,
      invoice_id: status === 'invoiced' ? 'inv1' : null,
      notes: null,
      created_by: 'u1',
      created_at: '2026-10-17T00:00:00Z',
      updated_at: '2026-10-17T00:00:00Z',
    },
    lines: [{
      id: 'vl1',
      valuation_id: 'v1',
      boq_line_id: 'boq1',
      cumulative_pct: 25,
      cumulative_value: 250,
      previous_cumulative_value: 0,
      period_value: 250,
      notes: null,
    }],
    invoice: status === 'invoiced' ? { id: 'inv1', invoice_number: 'INV-001', status: 'draft' } : null,
    retention_entries: [],
  };
}
function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('en');
  mock.projects.list.mockResolvedValue({ rows: [project], count: 1 });
  mock.projects.getById.mockResolvedValue(detail());
  mock.projects.getBoqLines.mockResolvedValue([]);
  mock.projects.getBoqSummary.mockResolvedValue({ total_boq_value: 0, contract_sum: 1000, variance: 1000, line_count: 0, is_locked: false });
  mock.projects.getValuationHistory.mockResolvedValue({ valuations: [], retention_entries: [] });
  mock.projects.getRetentionSummary.mockResolvedValue({ total_withheld: 0, total_released: 0, balance_held: 0, retention_pct: 10, can_release: false });
  mock.projects.createValuation.mockResolvedValue(valuationDocument());
  mock.projects.updateValuation.mockResolvedValue(valuationDocument());
  mock.projects.submitValuation.mockResolvedValue(valuationDocument('submitted'));
  mock.projects.generateInvoice.mockResolvedValue(valuationDocument('invoiced'));
  mock.projects.releaseRetention.mockResolvedValue({ retention_entry: {}, invoice: { id: 'inv1', invoice_number: 'INV-001', status: 'draft' } });
  mock.projects.locations.mockResolvedValue([
    { id: 'linked', name: 'Site One', project_id: 'p1' },
    { id: 'available', name: 'Main Store', project_id: null },
    { id: 'other', name: 'Other project site', project_id: 'p2' },
  ]);
  mock.construction.findPurchaseOrders.mockResolvedValue([]);
  mock.construction.findMaterialIssues.mockResolvedValue([]);
  mock.construction.findSites.mockResolvedValue([]);
});
afterEach(cleanup);
describe('construction project list', () => {
  it('renders columns, status badge, filter and paginated repository call', async () => {
    mount(<ProjectsSection businessId="b1" capabilities={grants} />);
    await screen.findByText('Hospital');
    for (const column of [
      'Name',
      'Client',
      'Status',
      'Contract Sum',
      'Budget',
      'Start Date',
      'End Date',
    ])
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    expect(
      screen.getByText('Tender', { selector: 'span' }).className,
    ).toContain('bg-gray-100');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'active' },
    });
    await waitFor(() =>
      expect(mock.projects.list).toHaveBeenLastCalledWith('b1', {
        status: 'active',
        page: 0,
      }),
    );
  });
  it('shows the first-project prompt and disables creation without manage grants', async () => {
    mock.projects.list.mockResolvedValue({ rows: [], count: 0 });
    mount(<ProjectsSection businessId="b1" capabilities={[]} />);
    await screen.findByText(
      'Create your first construction project to start tracking costs and progress.',
    );
    for (const button of screen.getAllByRole('button', { name: 'New Project' }))
      expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('creates with retention default 10 and navigates to the detail route', async () => {
    mock.projects.create.mockResolvedValue(project);
    mount(
      <Routes>
        <Route
          path="/"
          element={<ProjectsSection businessId="b1" capabilities={grants} />}
        />
        <Route
          path="/construction/projects/:projectId"
          element={<p>Detail destination</p>}
        />
      </Routes>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Hospital' },
    });
    fireEvent.change(screen.getByLabelText('Client name'), {
      target: { value: 'City Council' },
    });
    fireEvent.change(screen.getByLabelText('Contract sum'), {
      target: { value: '1000' },
    });
    expect(
      (screen.getByLabelText('Retention %') as HTMLInputElement).value,
    ).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await screen.findByText('Detail destination');
    expect(mock.projects.create).toHaveBeenCalledWith('b1', {
      name: 'Hospital',
      client_name: 'City Council',
      contract_sum: 1000,
      retention_pct: 10,
      budget: 0,
      start_date: null,
      end_date: null,
    });
  });
});
describe('project creation validation', () => {
  it('rejects invalid required fields, amounts, retention and date ranges', () => {
    expect(validateProject({ ...project, name: ' ' })).toBe('required');
    expect(validateProject({ ...project, client_name: '' })).toBe('required');
    for (const patch of [
      { contract_sum: -1 },
      { contract_sum: NaN },
      { budget: -1 },
      { retention_pct: 101 },
      { retention_pct: -1 },
      { contract_sum: 1.234 },
    ])
      expect(validateProject({ ...project, ...patch })).toBe('amounts');
    expect(
      validateProject({
        ...project,
        start_date: '2026-10-02',
        end_date: '2026-10-01',
      }),
    ).toBe('dates');
    expect(validateProject(project)).toBeNull();
  });
  it('shows authoritative server rejection and keeps the form open', async () => {
    mock.projects.create.mockRejectedValue(
      new Error('Server refused this project.'),
    );
    mount(<ProjectForm businessId="b1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    for (const [label, value] of [
      ['Project name', 'Hospital'],
      ['Client name', 'City Council'],
      ['Contract sum', '1000'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Server refused this project.'),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
describe('project detail', () => {
  it('loads scoped detail including cost summary and the BOQ editor', async () => {
    mount(
      <ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />,
    );
    await screen.findByText('Hospital');
    expect(mock.projects.getById).toHaveBeenCalledWith('b1', 'p1');
    expect(screen.getByText('350')).toBeTruthy();
    expect(screen.getByText('Number of sites')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'BOQ' }));
    expect(await screen.findByText('Add your first BOQ line to define the schedule of values for this project.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Valuations' }));
    expect(
      await screen.findByText('No progress valuations have been created for this project.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Procurement' }));
    for (const id of ['project-orders', 'project-issues', 'project-returns'])
      expect(screen.getByTestId(id).textContent).toBe('p1');
  });
  it.each([
    ['tender', 'Activate Project', 'active'],
    ['active', 'Mark Practical Completion', 'practical_completion'],
    ['practical_completion', 'Start Defect Liability', 'defect_liability'],
    ['defect_liability', 'Close Project', 'closed'],
  ] as const)(
    'confirms %s transition with optional reason',
    async (status, label, next) => {
      mock.projects.getById.mockResolvedValue(detail(status));
      mock.projects.transitionStatus.mockResolvedValue({
        ...project,
        status: next,
      });
      mount(
        <ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />,
      );
      fireEvent.click(await screen.findByRole('button', { name: label }));
      fireEvent.change(screen.getByLabelText('Reason (optional)'), {
        target: { value: 'Handover agreed' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm transition' }),
      );
      await waitFor(() =>
        expect(mock.projects.transitionStatus).toHaveBeenCalledWith(
          'p1',
          next,
          'Handover agreed',
        ),
      );
    },
  );
  it('has no transition action after closure', async () => {
    mock.projects.getById.mockResolvedValue(detail('closed'));
    mount(
      <ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />,
    );
    await screen.findByText('Hospital');
    expect(screen.queryByRole('button', { name: 'Close Project' })).toBeNull();
  });
  it('lists linked and available locations, excluding other projects, and links/unlinks', async () => {
    mount(
      <ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Sites' }));
    await screen.findByText('Main Store');
    expect(screen.getByText('Site One')).toBeTruthy();
    expect(screen.queryByText('Other project site')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link to project' }));
    await waitFor(() =>
      expect(mock.projects.linkSite).toHaveBeenCalledWith('available', 'p1'),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Unlink' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() =>
      expect(mock.projects.unlinkSite).toHaveBeenCalledWith('linked'),
    );
  });
  it('warns about tagged material activity before unlinking, without blocking a confirmed action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mock.construction.findMaterialIssues.mockResolvedValue([
      { location_id: 'linked' },
    ]);
    mount(
      <ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Sites' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    expect(confirm).toHaveBeenCalled();
    expect(mock.projects.unlinkSite).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() =>
      expect(mock.projects.unlinkSite).toHaveBeenCalledWith('linked'),
    );
    confirm.mockRestore();
  });
  it('does not render a project that is not accessible', async () => {
    mock.projects.getById.mockResolvedValue(null);
    mount(
      <ProjectDetail
        businessId="b1"
        projectId="foreign"
        capabilities={grants}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Project not found or not accessible.'),
    );
    expect(screen.queryByRole('tab')).toBeNull();
  });
  it('opens edit with existing values and sends metadata only', async () => {
    mock.projects.update.mockResolvedValue({ ...project, name: 'Clinic' });
    mount(
      <ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Project' }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Project name'), {
      target: { value: 'Clinic' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save project' }),
    );
    await waitFor(() =>
      expect(mock.projects.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          name: 'Clinic',
          client_name: 'City Council',
        }),
      ),
    );
    expect(mock.projects.update.mock.calls[0][1]).not.toHaveProperty('status');
  });
  it('creates cumulative valuation deltas and the first valuation locks the BOQ', async () => {
    mock.projects.getById.mockResolvedValue(detail('active'));
    mock.projects.getBoqLines.mockResolvedValue([{
      id: 'boq1', project_id: 'p1', line_number: '1', description: 'Foundation',
      quantity: 1, unit: 'item', rate: 1000, total_value: 1000, sort_order: 0,
      created_at: '', updated_at: '',
    }]);
    mock.projects.getBoqSummary.mockResolvedValue({ total_boq_value: 1000, contract_sum: 1000, variance: 0, line_count: 1, is_locked: true });
    mock.projects.createValuation.mockResolvedValue(valuationDocument());
    mount(<ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Valuations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create valuation' }));
    fireEvent.change(screen.getByLabelText('Cumulative % 1'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mock.projects.createValuation).toHaveBeenCalledWith('p1', expect.objectContaining({
      lines: [{ boq_line_id: 'boq1', cumulative_pct: 25, notes: null }],
      notes: null,
    })));
    fireEvent.click(screen.getByRole('tab', { name: 'BOQ' }));
    expect(await screen.findByText('This BOQ is locked because a valuation has been created. To make changes, contact your project administrator.')).toBeTruthy();
  });
  it('requires a correction reason for negative period values before saving', async () => {
    mock.projects.getById.mockResolvedValue(detail('active'));
    mock.projects.getBoqLines.mockResolvedValue([{
      id: 'boq1', project_id: 'p1', line_number: '1', description: 'Foundation',
      quantity: 1, unit: 'item', rate: 1000, total_value: 1000, sort_order: 0,
      created_at: '', updated_at: '',
    }]);
    const prior = valuationDocument('invoiced');
    mock.projects.getValuationHistory.mockResolvedValue({ valuations: [prior], retention_entries: [] });
    mount(<ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Valuations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create valuation' }));
    fireEvent.change(screen.getByLabelText('Cumulative % 1'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('A reason is required when any period value is negative.')).toBeTruthy();
    expect(mock.projects.createValuation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Valuation notes / correction reason'), { target: { value: 'Corrected over-measurement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mock.projects.createValuation).toHaveBeenCalledWith('p1', expect.objectContaining({
      lines: [{ boq_line_id: 'boq1', cumulative_pct: 20, notes: null }],
      notes: 'Corrected over-measurement',
    })));
  });
  it('edits drafts only, then submits them through the lifecycle command', async () => {
    mock.projects.getById.mockResolvedValue(detail('active'));
    mock.projects.getBoqLines.mockResolvedValue([{
      id: 'boq1', project_id: 'p1', line_number: '1', description: 'Foundation',
      quantity: 1, unit: 'item', rate: 1000, total_value: 1000, sort_order: 0,
      created_at: '', updated_at: '',
    }]);
    mock.projects.getValuationHistory.mockResolvedValue({ valuations: [valuationDocument('draft')], retention_entries: [] });
    mock.projects.updateValuation.mockResolvedValue(valuationDocument('draft'));
    mount(<ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Valuations' }));
    expect(await screen.findByRole('button', { name: 'Create valuation' })).toHaveProperty('disabled', true);
    expect(await screen.findByRole('button', { name: 'Edit draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate invoice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    fireEvent.change(screen.getByLabelText('Valuation notes / correction reason'), { target: { value: 'Reviewed measurement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(mock.projects.updateValuation).toHaveBeenCalledWith('v1', expect.objectContaining({ notes: 'Reviewed measurement' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit valuation' }));
    await waitFor(() => expect(mock.projects.submitValuation).toHaveBeenCalledWith('v1'));
  });
  it('keeps invoice generation on submitted valuations and uses the existing invoice command', async () => {
    mock.projects.getById.mockResolvedValue(detail('active'));
    mock.projects.getBoqLines.mockResolvedValue([{
      id: 'boq1', project_id: 'p1', line_number: '1', description: 'Foundation',
      quantity: 1, unit: 'item', rate: 1000, total_value: 1000, sort_order: 0,
      created_at: '', updated_at: '',
    }]);
    mock.projects.getValuationHistory.mockResolvedValue({ valuations: [valuationDocument('submitted')], retention_entries: [] });
    mock.projects.generateInvoice.mockResolvedValue(valuationDocument('invoiced'));
    mount(<ProjectDetail businessId="b1" projectId="p1" capabilities={grants} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Valuations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate invoice' }));
    await waitFor(() => expect(mock.projects.generateInvoice).toHaveBeenCalledWith('v1'));
    expect(await screen.findByText('Invoice INV-001 created for valuation V-1.')).toBeTruthy();
  });
  it('creates a manual retention release invoice only when allowed and within the held balance', async () => {
    mock.projects.getById.mockResolvedValue(detail('practical_completion'));
    mock.projects.getValuationHistory.mockResolvedValue({
      valuations: [],
      retention_entries: [{
        id: 'r1', project_id: 'p1', valuation_id: 'v1', type: 'withheld', amount: 100,
        description: 'Retention for valuation', invoice_id: null, created_by: 'u1', created_at: '2026-10-17T00:00:00Z',
      }],
    });
    mock.projects.getRetentionSummary.mockResolvedValue({ total_withheld: 100, total_released: 0, balance_held: 100, retention_pct: 10, can_release: true });
    mock.projects.releaseRetention.mockResolvedValue({
      retention_entry: { id: 'r2', project_id: 'p1', valuation_id: null, type: 'released', amount: 40, description: 'Practical completion', invoice_id: 'inv2', created_by: 'u1', created_at: '2026-10-17T00:00:00Z' },
      invoice: { id: 'inv2', invoice_number: 'INV-RET-001', status: 'draft' },
    });
    mount(<ProjectDetail businessId="b1" projectId="p1" capabilities={[...grants, 'procurement.exception.authorize']} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Valuations' }));
    fireEvent.change(await screen.findByLabelText('Release amount'), { target: { value: '40' } });
    fireEvent.change(await screen.findByLabelText('Release description / reason'), { target: { value: 'Practical completion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create release invoice' }));
    await waitFor(() => expect(mock.projects.releaseRetention).toHaveBeenCalledWith('p1', 40, 'Practical completion'));
  });
  it('does not expose manual release before practical completion', async () => {
    mock.projects.getById.mockResolvedValue(detail('active'));
    mock.projects.getRetentionSummary.mockResolvedValue({ total_withheld: 100, total_released: 0, balance_held: 100, retention_pct: 10, can_release: false });
    mount(<ProjectDetail businessId="b1" projectId="p1" capabilities={[...grants, 'procurement.exception.authorize']} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Valuations' }));
    await screen.findByText('Manual retention release is available at practical completion or later.');
    expect(screen.queryByRole('button', { name: 'Create release invoice' })).toBeNull();
    expect(mock.projects.releaseRetention).not.toHaveBeenCalled();
  });
});
