// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const repository = vi.hoisted(() => ({
  listSubcontracts: vi.fn(),
  listSubcontractorProfiles: vi.fn(),
  createSubcontract: vi.fn(),
  updateSubcontractStatus: vi.fn(),
}));
vi.mock('@/dal/repositories/SubcontractRepository', () => ({ subcontractRepository: repository }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { ProjectSubcontracts } from './ProjectSubcontracts';

const AGREEMENT = {
  id: 'agreement-1', business_id: 'business-1', project_id: 'project-1',
  subcontractor_profile_id: 'profile-1', reference: 'SUB-001', title: 'Electrical installation',
  description: null, scope_of_work: 'Install wiring', contract_value: 250000, currency: 'MWK',
  retention_percentage: 5, status: 'draft' as const, start_date: null, end_date: null,
  defects_liability_months: 12, payment_terms: null, notes: null,
  created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z', created_by: null,
  subcontractor_profile: {
    id: 'profile-1', trade: 'Electrical', is_active: true,
    contact: { id: 'contact-1', name: 'Bright Wire Ltd', contact_type: 'supplier', email: null, phone: null,
      address_line1: null, address_line2: null, city: null, country: null, tpin: null, vat_number: null },
  },
  project: { id: 'project-1', name: 'Clinic extension', status: 'active' },
};
const PROFILE = {
  id: 'profile-1', business_id: 'business-1', contact_id: 'contact-1', trade: 'Electrical',
  license_number: null, license_expiry: null, insurance_provider: null, insurance_policy_number: null,
  insurance_expiry: null, compliance_notes: null, safety_rating: null, preferred: false, is_active: true,
  created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z',
  contact: { id: 'contact-1', name: 'Bright Wire Ltd', contact_type: 'supplier', email: null, phone: null,
    address_line1: null, address_line2: null, city: null, country: null, tpin: null, vat_number: null },
};

function renderPage() {
  return render(<ProjectSubcontracts businessId="business-1" projectId="project-1" currency="MWK" />);
}

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  repository.listSubcontracts.mockResolvedValue([AGREEMENT]);
  repository.listSubcontractorProfiles.mockResolvedValue([PROFILE]);
  repository.createSubcontract.mockResolvedValue('agreement-2');
  repository.updateSubcontractStatus.mockResolvedValue(undefined);
});

describe('ProjectSubcontracts', () => {
  it('exposes only valid draft lifecycle transitions', async () => {
    renderPage();
    expect(await screen.findByText('Electrical installation')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'construction.subcontractor.moveTo' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /construction.subcontractor.status.completed/ })).toBeNull();
    const activeButton = screen.getAllByRole('button', { name: 'construction.subcontractor.moveTo' })[0];
    fireEvent.click(activeButton);
    await waitFor(() => expect(repository.updateSubcontractStatus).toHaveBeenCalledWith('business-1', 'agreement-1', 'active'));
  });

  it('creates a project-scoped draft agreement for an existing profile', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'construction.subcontractor.addAgreement' }));
    fireEvent.change(screen.getByLabelText(/construction.subcontractor.reference/), { target: { value: 'SUB-002' } });
    fireEvent.change(screen.getByLabelText(/construction.subcontractor.agreementTitle/), { target: { value: 'Plumbing works' } });
    fireEvent.change(screen.getByLabelText(/construction.subcontractor.contractValue/), { target: { value: '125000' } });
    fireEvent.click(screen.getByRole('button', { name: 'construction.subcontractor.saveAgreement' }));
    await waitFor(() => expect(repository.createSubcontract).toHaveBeenCalledWith('business-1', expect.objectContaining({
      project_id: 'project-1', subcontractor_profile_id: 'profile-1', reference: 'SUB-002',
      title: 'Plumbing works', contract_value: 125000, status: 'draft', currency: 'MWK',
    })));
  });
});
