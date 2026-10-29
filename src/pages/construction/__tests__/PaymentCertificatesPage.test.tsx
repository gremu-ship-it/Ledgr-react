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
  listCertificates: vi.fn(),
  createCertificate: vi.fn(),
  issueCertificate: vi.fn(),
  recordPayment: vi.fn(),
  cancelCertificate: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    projects: {
      list: mocks.listProjects,
      getValuationHistory: mocks.getValuationHistory,
      getRetentionSummary: mocks.getRetentionSummary,
    },
    certificates: {
      list: mocks.listCertificates,
      create: mocks.createCertificate,
      issue: mocks.issueCertificate,
      recordPayment: mocks.recordPayment,
      cancel: mocks.cancelCertificate,
    },
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

import { PaymentCertificatesPage } from '@/pages/construction/PaymentCertificatesPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Business A', base_currency: 'MWK', operating_models: ['PROJECT_BASED'] },
};
const project = {
  id: 'project-1', business_id: 'business-1', name: 'School Block', client_name: 'Council', client_id: null,
  status: 'active', contract_sum: 10000, retention_pct: 10, budget: 9000,
  start_date: '2026-01-01', end_date: '2027-01-01', created_by: 'user-1', created_at: '', updated_at: '', boq_locked_at: null,
};
const valuationDoc = (id: string, status: 'draft' | 'submitted' | 'invoiced', number: number, gross: number, retention: number) => ({
  valuation: {
    id, project_id: project.id, valuation_number: number, valuation_date: `2026-0${number}-30`,
    period_start: null, period_end: null, gross_amount: gross, retention_amount: retention,
    net_amount: gross - retention, previous_cumulative: 0, status, invoice_id: null, notes: null,
    created_by: 'user-1', created_at: '', updated_at: '',
  },
  lines: [], invoice: null, retention_entries: [],
});
const certificate = {
  id: 'certificate-1', business_id: business.business.id, project_id: project.id,
  valuation_id: 'valuation-submitted', certificate_number: 1, certificate_date: '2026-02-28',
  gross_amount: 1000, retention_amount: 100, advance_recovery: 100, penalty_deductions: 25,
  other_deductions: 10, net_amount: 765, retention_percentage: 10, total_retention_held: 300,
  status: 'partially_paid', issued_to_contact_id: null, payment_due_date: null,
  paid_date: '2026-03-01', paid_amount: 265, notes: null, created_by: 'user-1', created_at: '', updated_at: '',
};
const history = {
  valuations: [
    valuationDoc('valuation-draft', 'draft', 1, 900, 90),
    valuationDoc('valuation-submitted', 'submitted', 2, 1000, 100),
    valuationDoc('valuation-invoiced', 'invoiced', 3, 2000, 200),
  ],
  retention_entries: [],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><PaymentCertificatesPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: business as never });
  mocks.listProjects.mockResolvedValue({ rows: [project], count: 1 });
  mocks.getValuationHistory.mockResolvedValue(history);
  mocks.getRetentionSummary.mockResolvedValue({ total_withheld: 400, total_released: 100, balance_held: 300, retention_pct: 10, can_release: false });
  mocks.listCertificates.mockResolvedValue([]);
  mocks.createCertificate.mockResolvedValue('certificate-new');
  mocks.issueCertificate.mockResolvedValue('certificate-1');
  mocks.recordPayment.mockResolvedValue('certificate-1');
  mocks.cancelCertificate.mockResolvedValue('certificate-1');
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('PaymentCertificatesPage', () => {
  it('renders an empty state when the selected project has no certificates', async () => {
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.selectProject), { target: { value: project.id } });
    expect(await screen.findByText(en.construction.certificates.empty)).toBeTruthy();
  });

  it('shows gross period totals, retention held and the unpaid certificate balance', async () => {
    mocks.listCertificates.mockResolvedValue([certificate]);
    mocks.getRetentionSummary.mockResolvedValue({ total_withheld: 400, total_released: 100, balance_held: 300, retention_pct: 10, can_release: false });
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.selectProject), { target: { value: project.id } });
    expect(await screen.findByText(en.construction.certificates.certificateNumber.replace('{{number}}', '1'))).toBeTruthy();
    expect(screen.getAllByText('MWK 1,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('MWK 300.00')).toBeTruthy();
    expect(screen.getByText('MWK 500.00')).toBeTruthy();
    expect(screen.getByText(en.construction.certificates.statuses.partially_paid)).toBeTruthy();
  });

  it('offers only submitted or invoiced valuations without a certificate', async () => {
    mocks.listCertificates.mockResolvedValue([certificate]);
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.selectProject), { target: { value: project.id } });
    const newButton = await screen.findByRole('button', { name: en.construction.certificates.new });
    await waitFor(() => expect((newButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newButton);
    const select = screen.getByLabelText(en.construction.certificates.selectValuation) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['', 'valuation-invoiced']);
    expect(screen.queryByRole('option', { name: /valuation-submitted/ })).toBeNull();
    expect([...select.options].some((option) => option.text.includes('Valuation #1'))).toBe(false);
  });

  it('previews deductions and calls the certificate RPC with the selected valuation values', async () => {
    renderPage();
    await screen.findByRole('option', { name: project.name });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.selectProject), { target: { value: project.id } });
    const newButton = await screen.findByRole('button', { name: en.construction.certificates.new });
    await waitFor(() => expect((newButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newButton);
    fireEvent.change(screen.getByLabelText(en.construction.certificates.selectValuation), { target: { value: 'valuation-submitted' } });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.advanceRecovery), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.penaltyDeductions), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(en.construction.certificates.otherDeductions), { target: { value: '10' } });
    expect(screen.getByText('MWK 765.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.construction.certificates.create }));
    await waitFor(() => expect(mocks.createCertificate).toHaveBeenCalledWith({
      valuationId: 'valuation-submitted', retentionPercentage: 10,
      advanceRecovery: 100, penaltyDeductions: 25, otherDeductions: 10,
    }));
  });
});
