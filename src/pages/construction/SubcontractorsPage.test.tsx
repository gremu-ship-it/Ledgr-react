// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '@/store/useAppStore';

const repository = vi.hoisted(() => ({
  listSubcontractorProfiles: vi.fn(),
  getSubcontractorProfile: vi.fn(),
  createSubcontractorProfile: vi.fn(),
  updateSubcontractorProfile: vi.fn(),
  listSubcontracts: vi.fn(),
}));
const contactRepository = vi.hoisted(() => ({
  findByBusiness: vi.fn(),
  createContact: vi.fn(),
}));

vi.mock('@/dal/repositories/SubcontractRepository', () => ({ subcontractRepository: repository }));
vi.mock('@/lib/repositories', () => ({ repos: { contact: contactRepository } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { SubcontractorsPage } from './SubcontractorsPage';

const PROFILE = {
  id: 'profile-1',
  business_id: 'business-1',
  contact_id: 'contact-1',
  trade: 'Electrical',
  license_number: 'EL-100',
  license_expiry: null,
  insurance_provider: 'ACME Insurance',
  insurance_policy_number: null,
  insurance_expiry: '2027-01-01',
  compliance_notes: null,
  safety_rating: 'A',
  preferred: false,
  is_active: true,
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  contact: {
    id: 'contact-1', name: 'Bright Wire Ltd', contact_type: 'supplier',
    email: 'work@example.com', phone: null, address_line1: null, address_line2: null,
    city: null, country: null, tpin: null, vat_number: null,
  },
};

function renderPage() {
  return render(<SubcontractorsPage />);
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
  repository.listSubcontractorProfiles.mockResolvedValue([PROFILE]);
  repository.listSubcontracts.mockResolvedValue([]);
  repository.createSubcontractorProfile.mockResolvedValue('profile-2');
  contactRepository.findByBusiness.mockResolvedValue([]);
});

describe('SubcontractorsPage', () => {
  it('loads tenant profiles and filters the directory by search and trade', async () => {
    renderPage();
    expect(await screen.findByText('Bright Wire Ltd')).toBeTruthy();
    expect(repository.listSubcontractorProfiles).toHaveBeenCalledWith('business-1');
    expect(repository.listSubcontracts).toHaveBeenCalledWith('business-1');

    fireEvent.change(screen.getByPlaceholderText('construction.subcontractor.search'), { target: { value: 'plumbing' } });
    expect(screen.getByText('construction.subcontractor.emptyTitle')).toBeTruthy();
  });

  it('creates a supplier contact inline, then saves its construction profile', async () => {
    const createdContact = {
      id: 'contact-new', business_id: 'business-1', contact_type: 'supplier', name: 'New Electric Ltd',
      email: null, phone: null, tpin: null, vat_number: null, address_line1: null, address_line2: null,
      city: null, country: null, is_active: true, deleted_at: null, wht_exempt: false,
    };
    contactRepository.createContact.mockResolvedValue(createdContact);
    repository.listSubcontractorProfiles.mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'construction.subcontractor.addSubcontractor' }));
    fireEvent.click(screen.getByRole('button', { name: 'construction.subcontractor.createNewContact' }));
    fireEvent.change(screen.getByLabelText(/construction.subcontractor.contactName/), { target: { value: 'New Electric Ltd' } });
    fireEvent.click(screen.getByRole('button', { name: 'construction.subcontractor.saveAndSelectContact' }));

    await waitFor(() => expect(contactRepository.createContact).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'business-1', contact_type: 'supplier', name: 'New Electric Ltd', wht_exempt: false,
    })));
    fireEvent.change(screen.getByLabelText(/construction.subcontractor.trade/), { target: { value: 'Electrical' } });
    fireEvent.click(screen.getByRole('button', { name: 'construction.subcontractor.saveProfile' }));

    await waitFor(() => expect(repository.createSubcontractorProfile).toHaveBeenCalledWith('business-1', expect.objectContaining({
      contact_id: 'contact-new', trade: 'Electrical',
    })));
  });
});
