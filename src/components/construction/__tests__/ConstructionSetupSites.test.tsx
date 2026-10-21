// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@/i18n';

const mock = vi.hoisted(() => ({
  construction: {
    findSites: vi.fn(),
    findUomConversions: vi.fn(),
    findPostingPolicy: vi.fn(),
    registerSite: vi.fn(),
    updateSite: vi.fn(),
    setSiteStatus: vi.fn(),
  },
  branch: {
    findByBusiness: vi.fn(),
    findLocations: vi.fn(),
  },
  inventory: {
    findAllProducts: vi.fn(),
  },
  projects: {
    list: vi.fn(),
  },
}));

vi.mock('@/lib/repositories', () => ({ repos: mock }));

import { ConstructionSetupSection } from '../ConstructionSetupSection';

const grants = ['procurement.master.manage'];

const BUSINESS_ID = 'b1';

function siteFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'site-1',
    business_id: BUSINESS_ID,
    branch_id: 'br1',
    location_id: 'loc1',
    site_code: 'SITE-001',
    site_name: 'Main Gate',
    project_id: 'p1',
    project_ref: 'Hospital Building',
    is_active: true,
    created_at: '2026-11-08T00:00:00Z',
    ...overrides,
  };
}

function mount(capabilities: string[] = grants) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConstructionSetupSection businessId={BUSINESS_ID} capabilities={capabilities} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('en');
  mock.construction.findSites.mockResolvedValue([
    siteFixture(),
    siteFixture({
      id: 'site-2',
      site_code: 'SITE-002',
      site_name: 'Old Yard',
      project_id: null,
      project_ref: 'Legacy Ref',
      is_active: false,
    }),
  ]);
  mock.construction.findUomConversions.mockResolvedValue([]);
  mock.construction.findPostingPolicy.mockResolvedValue(null);
  mock.construction.registerSite.mockResolvedValue({ id: 'site-new', idempotent: false });
  mock.construction.updateSite.mockResolvedValue({ status: 'ok' });
  mock.construction.setSiteStatus.mockResolvedValue({ status: 'ok' });
  mock.branch.findByBusiness.mockResolvedValue([{ id: 'br1', name: 'Main Branch' }]);
  mock.branch.findLocations.mockResolvedValue([{ id: 'loc1', name: 'Store A', branch_id: 'br1' }]);
  mock.inventory.findAllProducts.mockResolvedValue([]);
  mock.projects.list.mockResolvedValue({
    rows: [
      { id: 'p1', name: 'Hospital Building' },
      { id: 'p2', name: 'School Block' },
    ],
    count: 2,
  });
});

afterEach(cleanup);

describe('construction setup — site lifecycle (P2-4)', () => {
  it('shows edit and deactivate/reactivate actions only to procurement.master.manage holders', async () => {
    mount(grants);
    expect(await screen.findByText('SITE-001')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
    expect(screen.getAllByLabelText('Edit site')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Deactivate site' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivate site' })).toBeTruthy();

    cleanup();
    mount([]);
    expect(await screen.findByText('SITE-001')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    expect(screen.queryByLabelText('Edit site')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate site' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reactivate site' })).toBeNull();
  });

  it('greys inactive rows out but keeps them listed with their badge', async () => {
    mount();
    const inactiveRow = (await screen.findByText('SITE-002')).closest('tr');
    expect(inactiveRow?.className).toContain('opacity-60');
    expect(within(inactiveRow as HTMLElement).getByText('Inactive')).toBeTruthy();
    const activeRow = screen.getByText('SITE-001').closest('tr');
    expect(activeRow?.className).not.toContain('opacity-60');
    expect(within(activeRow as HTMLElement).getByText('Active')).toBeTruthy();
  });

  it('saves name and link edits through the update RPC and documents the re-register rule', async () => {
    mount();
    fireEvent.click((await screen.findAllByLabelText('Edit site'))[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('To change the branch or location, re-register with the same site code.')).toBeTruthy();
    const nameInput = within(dialog).getByLabelText('Site name') as HTMLInputElement;
    expect(nameInput.value).toBe('Main Gate');
    fireEvent.change(nameInput, { target: { value: 'Hospital Main Gate' } });
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() =>
      expect(mock.construction.updateSite).toHaveBeenCalledWith('site-1', {
        siteName: 'Hospital Main Gate',
        projectId: 'p1',
        projectRef: 'Hospital Building',
      }),
    );
    expect(await screen.findByText('Site updated.')).toBeTruthy();
  });

  it('auto-fills the editable project reference when the linked project changes', async () => {
    mount();
    fireEvent.click((await screen.findAllByLabelText('Edit site'))[0]);
    const dialog = screen.getByRole('dialog');
    const picker = within(dialog).getByLabelText('Linked project');
    expect((picker as HTMLSelectElement).value).toBe('p1');
    fireEvent.change(picker, { target: { value: 'p2' } });
    const refInput = within(dialog).getByLabelText('Project reference') as HTMLInputElement;
    expect(refInput.value).toBe('School Block');
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() =>
      expect(mock.construction.updateSite).toHaveBeenCalledWith('site-1', {
        siteName: 'Main Gate',
        projectId: 'p2',
        projectRef: 'School Block',
      }),
    );
  });

  it('unlinks the project without touching the reference text', async () => {
    mount();
    fireEvent.click((await screen.findAllByLabelText('Edit site'))[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Linked project'), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() =>
      expect(mock.construction.updateSite).toHaveBeenCalledWith('site-1', {
        siteName: 'Main Gate',
        projectId: null,
        projectRef: 'Hospital Building',
      }),
    );
  });

  it('deactivates with a reason through the lifecycle RPC', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate site' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Deactivate this site?')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'The site will no longer be available for new purchase orders or material issues. Existing completed documents are unaffected.',
      ),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason for deactivation'), {
      target: { value: 'Project completed' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate site' }));
    await waitFor(() =>
      expect(mock.construction.setSiteStatus).toHaveBeenCalledWith('site-1', false, 'Project completed'),
    );
    expect(await screen.findByText('Site deactivated.')).toBeTruthy();
  });

  it('localizes the open-PO refusal with the server-reported count', async () => {
    mock.construction.setSiteStatus.mockRejectedValueOnce(
      new Error('Cannot deactivate: 3 open purchase order(s) reference this site'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate site' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate site' }));
    expect(
      await screen.findByText(
        'Cannot deactivate: 3 open purchase order(s) reference this site. Complete or cancel them first.',
      ),
    ).toBeTruthy();
  });

  it('localizes the stock-on-hand refusal with the server-reported quantity', async () => {
    mock.construction.setSiteStatus.mockRejectedValueOnce(
      new Error('Cannot deactivate: linked location has 12.5 units on hand'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate site' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate site' }));
    expect(
      await screen.findByText(
        'Cannot deactivate: the linked location has 12.5 units on hand. Transfer or adjust stock first.',
      ),
    ).toBeTruthy();
  });

  it('shows unrecognized refusals verbatim through the house failure banner', async () => {
    mock.construction.setSiteStatus.mockRejectedValueOnce(
      new Error('Not authorized: the procurement.master.manage capability has not been granted for this business.'),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate site' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate site' }));
    expect(
      await screen.findByText(
        'Not authorized: the procurement.master.manage capability has not been granted for this business.',
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it('reactivates without guards or a reason', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate site' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reactivate this site?')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Reason for deactivation')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate site' }));
    await waitFor(() =>
      expect(mock.construction.setSiteStatus).toHaveBeenCalledWith('site-2', true, undefined),
    );
    expect(await screen.findByText('Site reactivated.')).toBeTruthy();
  });

  it('links the authoritative project FK right after a successful registration', async () => {
    mount();
    await screen.findByText('SITE-001');
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'br1' } });
    fireEvent.change(screen.getByLabelText('Inventory location'), { target: { value: 'loc1' } });
    fireEvent.change(screen.getByLabelText('Site code'), { target: { value: 'SITE-003' } });
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'Annex Gate' } });
    fireEvent.change(screen.getByLabelText('Linked project'), { target: { value: 'p2' } });
    // Selecting the project auto-filled the editable reference.
    expect((screen.getByLabelText('Project reference') as HTMLInputElement).value).toBe('School Block');
    fireEvent.click(screen.getByRole('button', { name: 'Register site' }));
    await waitFor(() =>
      expect(mock.construction.registerSite).toHaveBeenCalledWith({
        businessId: BUSINESS_ID,
        branchId: 'br1',
        locationId: 'loc1',
        siteCode: 'SITE-003',
        siteName: 'Annex Gate',
        projectRef: 'School Block',
      }),
    );
    await waitFor(() =>
      expect(mock.construction.updateSite).toHaveBeenCalledWith('site-new', { projectId: 'p2' }),
    );
    expect(await screen.findByText('Construction site registered.')).toBeTruthy();
  });

  it('registers without a project link and never calls the update RPC', async () => {
    mount();
    await screen.findByText('SITE-001');
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'br1' } });
    fireEvent.change(screen.getByLabelText('Inventory location'), { target: { value: 'loc1' } });
    fireEvent.change(screen.getByLabelText('Site code'), { target: { value: 'SITE-004' } });
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'North Yard' } });
    fireEvent.change(screen.getByLabelText('Project reference'), { target: { value: 'Ref X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register site' }));
    await waitFor(() => expect(mock.construction.registerSite).toHaveBeenCalled());
    expect(mock.construction.updateSite).not.toHaveBeenCalled();
  });
});
