// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import en from '@/i18n/locales/en.json';
import { useAppStore } from '@/store/useAppStore';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getValuationHistory: vi.fn(),
  getRetentionSummary: vi.fn(),
  releaseRetention: vi.fn(),
  findCapabilities: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: {
      list: mocks.listProjects,
      getValuationHistory: mocks.getValuationHistory,
      getRetentionSummary: mocks.getRetentionSummary,
      releaseRetention: mocks.releaseRetention,
    },
    construction: { findCapabilities: mocks.findCapabilities },
  },
}));
vi.mock('react-i18next', async () => {
  const translations = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>(
    (value, part) => (value as Record<string, unknown> | undefined)?.[part], translations,
  );
  return { useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => {
    const value = lookup(key);
    if (typeof value !== 'string') return key;
    return Object.entries(options ?? {}).reduce((result, [name, replacement]) => result.replaceAll(`{{${name}}}`, String(replacement)), value);
  } }) };
});

import { RetentionRegisterPage } from '@/pages/construction/RetentionRegisterPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Business A', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
};
const project = {
  id: 'project-1', business_id: 'business-1', name: 'School Block', client_name: 'Council', client_id: null,
  status: 'defect_liability', contract_sum: 10000, retention_pct: 10, budget: 9000,
  start_date: '2026-01-01', end_date: '2027-01-01', created_by: 'user-1', created_at: '', updated_at: '', boq_locked_at: null,
};
const retentionEntries = [
  { id: 'withheld-1', project_id: project.id, valuation_id: 'valuation-1', type: 'withheld', amount: 430, description: 'Retention withheld', invoice_id: null, created_by: 'user-1', created_at: '2026-10-01T00:00:00Z', invoice: null },
  { id: 'released-1', project_id: project.id, valuation_id: null, type: 'released', amount: 100, description: 'Practical completion', invoice_id: 'invoice-1', created_by: 'user-1', created_at: '2026-10-15T00:00:00Z', invoice: { id: 'invoice-1', invoice_number: 'INV-1', status: 'draft' } },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><RetentionRegisterPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.listProjects.mockResolvedValue({ rows: [project], count: 1 });
  mocks.getValuationHistory.mockResolvedValue({ valuations: [], retention_entries: retentionEntries });
  mocks.getRetentionSummary.mockResolvedValue({ total_withheld: 430, total_released: 100, balance_held: 330, retention_pct: 10, can_release: true });
  mocks.findCapabilities.mockResolvedValue(['procurement.exception.authorize']);
  mocks.releaseRetention.mockResolvedValue({ retention_entry: retentionEntries[1], invoice: retentionEntries[1].invoice });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('RetentionRegisterPage', () => {
  it('shows retained, released and held totals from the existing ledger summary', async () => {
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.selectProject), { target: { value: project.id } });
    expect(await screen.findByText(en.construction.retentionRegister.types.withheld)).toBeTruthy();
    expect(screen.getAllByText('MWK 430.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MWK 100.00').length).toBeGreaterThan(0);
    expect(screen.getByText('MWK 330.00')).toBeTruthy();
    expect(screen.getByText('INV-1')).toBeTruthy();
  });

  it('blocks a release that exceeds the current ledger balance', async () => {
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.selectProject), { target: { value: project.id } });
    const newReleaseButton = await screen.findByRole('button', { name: en.construction.retentionRegister.newRelease });
    await waitFor(() => expect((newReleaseButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newReleaseButton);
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.releaseAmount), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.releaseDescription), { target: { value: 'Final release' } });
    fireEvent.click(screen.getByRole('button', { name: en.construction.retentionRegister.createRelease }));
    expect((await screen.findAllByText(en.construction.retentionRegister.exceedsHeld)).length).toBeGreaterThan(0);
    expect(mocks.releaseRetention).not.toHaveBeenCalled();
  });

  it('sends an allowed release through the existing release_retention repository command', async () => {
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.selectProject), { target: { value: project.id } });
    const newReleaseButton = await screen.findByRole('button', { name: en.construction.retentionRegister.newRelease });
    await waitFor(() => expect((newReleaseButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newReleaseButton);
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.releaseAmount), { target: { value: '125' } });
    fireEvent.change(screen.getByLabelText(en.construction.retentionRegister.releaseDescription), { target: { value: 'Defects liability release' } });
    fireEvent.click(screen.getByRole('button', { name: en.construction.retentionRegister.createRelease }));
    await waitFor(() => expect(mocks.releaseRetention).toHaveBeenCalledWith(project.id, 125, 'Defects liability release'));
  });
});
