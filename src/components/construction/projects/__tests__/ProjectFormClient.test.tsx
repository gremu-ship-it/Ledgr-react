// @vitest-environment jsdom
/**
 * P2-3 — ProjectForm client linkage.
 *
 * The construction business gets the ClientPicker (absent, not locked: the
 * non-construction path keeps the original text input). Selections carry
 * client_id AND the client_name display cache to the RPC write path;
 * unlinking drops back to manual text with the cache preserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';
import type { Project } from '@/dal/repositories/ProjectRepository';

const mock = vi.hoisted(() => ({
  operatingModels: [] as string[],
  projects: { create: vi.fn(), update: vi.fn() },
  contact: { findClientContacts: vi.fn(), createContact: vi.fn() },
}));
vi.mock('@/lib/repositories', () => ({
  repos: { projects: mock.projects, contact: mock.contact },
}));
vi.mock('@/hooks/useBusinessProfile', () => ({
  useBusinessProfile: () => ({ profile: { operating_models: mock.operatingModels } }),
}));

import { ProjectForm } from '../ProjectForm';

const project: Project = {
  id: 'p1',
  business_id: 'b1',
  name: 'Hospital Wing',
  client_name: 'City Council',
  client_id: 'c1',
  status: 'tender',
  contract_sum: 1000,
  retention_pct: 10,
  budget: 800,
  start_date: null,
  end_date: null,
  created_by: 'u1',
  created_at: '',
  updated_at: '',
  boq_locked_at: null,
};

function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('en');
  mock.operatingModels = ['CONSTRUCTION'];
  mock.contact.findClientContacts.mockResolvedValue([
    { id: 'c1', name: 'City Council', tpin: null, vat_number: null, contact_type: 'customer', is_active: true },
    { id: 'c2', name: 'Roads Authority', tpin: '123', vat_number: null, contact_type: 'both', is_active: true },
  ]);
  mock.projects.create.mockResolvedValue({ id: 'new-1' });
  mock.projects.update.mockResolvedValue({ id: 'p1' });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillRequiredFields(name = 'Clinic Block') {
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Contract sum'), { target: { value: '5000' } });
}

describe('ProjectForm — construction client picker', () => {
  it('replaces the free-text client input with the picker for CONSTRUCTION businesses', () => {
    mount(<ProjectForm businessId="b1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('client-picker')).toBeTruthy();
    // The generic 'Client name' text input is gone; the picker field carries
    // the i18n'd label instead.
    expect(screen.queryByLabelText('Client name')).toBeNull();
    // The picker field label is the i18n'd 'Client' with the required marker.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'SPAN' && element.textContent === 'Client*',
      ),
    ).toBeTruthy();
  });

  it('keeps the original text input for non-construction businesses (absent, not locked)', () => {
    mock.operatingModels = ['RETAIL'];
    mount(<ProjectForm businessId="b1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('client-picker')).toBeNull();
    expect(screen.getByLabelText('Client name')).toBeTruthy();
  });

  it('sends client_id with the contact name as the display cache on create', async () => {
    const onSaved = vi.fn();
    mount(<ProjectForm businessId="b1" onSaved={onSaved} onCancel={vi.fn()} />);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    fireEvent.click(await screen.findByTestId('client-picker-option-c2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.projects.create).toHaveBeenCalled());
    expect(mock.projects.create).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        name: 'Clinic Block',
        client_id: 'c2',
        client_name: 'Roads Authority',
        contract_sum: 5000,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('manual entry keeps client_name required and client_id null (tender stage)', async () => {
    mount(<ProjectForm businessId="b1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillRequiredFields();
    fireEvent.click(screen.getByTestId('client-manual-entry'));
    const manual = screen.getByLabelText('Client name');
    fireEvent.change(manual, { target: { value: 'Ministry of Health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.projects.create).toHaveBeenCalled());
    expect(mock.projects.create).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        client_id: null,
        client_name: 'Ministry of Health',
      }),
    );
  });

  it('validation still refuses an empty client (picker mode, nothing selected)', () => {
    mount(<ProjectForm businessId="b1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(
      screen.getByText('Project name and client name are required.'),
    ).toBeTruthy();
    expect(mock.projects.create).not.toHaveBeenCalled();
  });

  it('shows the linked client when editing and can switch it', async () => {
    mount(
      <ProjectForm businessId="b1" project={project} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('client-picker-linked-name').textContent).toBe(
      'City Council',
    );
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    fireEvent.click(await screen.findByTestId('client-picker-option-c2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.projects.update).toHaveBeenCalled());
    expect(mock.projects.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        client_id: 'c2',
        client_name: 'Roads Authority',
      }),
    );
  });

  it('unlinking via × falls back to manual text with the cache preserved, and update unlinks', async () => {
    mount(
      <ProjectForm businessId="b1" project={project} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('client-picker-unlink'));
    expect(window.confirm).toHaveBeenCalled();
    // The prompt's behavior: the field becomes a plain text input again,
    // still carrying the last-known name.
    const manual = await screen.findByLabelText('Client name');
    expect((manual as HTMLInputElement).value).toBe('City Council');
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(mock.projects.update).toHaveBeenCalled());
    expect(mock.projects.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ client_id: null, client_name: 'City Council' }),
    );
  });
});
