// @vitest-environment jsdom
/**
 * P2-3 — the contact type selector exposes 'both' ("Customer & Supplier").
 * The DB CHECK always accepted customer|supplier|both; the UI previously
 * could not express it, which blocked construction contacts that are
 * simultaneously clients and vendors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';

const mock = vi.hoisted(() => ({
  contact: { createContact: vi.fn(), updateContact: vi.fn() },
}));
vi.mock('@/lib/repositories', () => ({ repos: { contact: mock.contact } }));

import { ContactModal } from '../ContactModal';

function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('en');
  mock.contact.createContact.mockImplementation(async (payload) => ({
    id: 'new-1',
    ...payload,
  }));
  mock.contact.updateContact.mockResolvedValue({ id: 'e1' });
});

afterEach(cleanup);

describe('ContactModal — contact type selector', () => {
  it('offers customer, supplier and the new both type', () => {
    mount(<ContactModal contactType="customer" businessId="b1" onClose={vi.fn()} />);
    const selector = screen.getByTestId('contact-modal-type') as HTMLSelectElement;
    const options = Array.from(selector.options).map((option) => [
      option.value,
      option.textContent,
    ]);
    expect(options).toEqual([
      ['customer', 'Customer'],
      ['supplier', 'Supplier'],
      ['both', 'Customer & Supplier'],
    ]);
    expect(selector.value).toBe('customer');
  });

  it('creates a both contact when selected', async () => {
    mount(<ContactModal contactType="customer" businessId="b1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('contact-modal-type'), {
      target: { value: 'both' },
    });
    fireEvent.change(screen.getByTestId('contact-modal-name'), {
      target: { value: 'Mzuzu Hardware' },
    });
    fireEvent.click(screen.getByTestId('contact-modal-save'));
    await waitFor(() => expect(mock.contact.createContact).toHaveBeenCalled());
    expect(mock.contact.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'b1',
        name: 'Mzuzu Hardware',
        contact_type: 'both',
        is_active: true,
      }),
    );
  });

  it('prefills defaultName and reports the created row through onCreated', async () => {
    const onCreated = vi.fn();
    mount(
      <ContactModal
        contactType="customer"
        businessId="b1"
        defaultName="Zomba Ltd"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    expect((screen.getByTestId('contact-modal-name') as HTMLInputElement).value).toBe(
      'Zomba Ltd',
    );
    fireEvent.click(screen.getByTestId('contact-modal-save'));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'new-1', name: 'Zomba Ltd', contact_type: 'customer' }),
      ),
    );
  });

  it('edits an existing both contact with the selector reflecting its type', async () => {
    const existing = {
      id: 'e1',
      business_id: 'b1',
      name: 'Buildwell',
      contact_type: 'both',
      trading_name: null,
      email: null,
      phone: null,
      tpin: null,
      address_line1: null,
      address_line2: null,
      city: null,
      country: 'Malawi',
      notes: null,
      wht_exempt: false,
      is_active: true,
    };
    const onCreated = vi.fn();
    mount(
      <ContactModal
        contactType="customer"
        existing={existing as never}
        businessId="b1"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    expect((screen.getByTestId('contact-modal-type') as HTMLSelectElement).value).toBe(
      'both',
    );
    fireEvent.click(screen.getByTestId('contact-modal-save'));
    await waitFor(() => expect(mock.contact.updateContact).toHaveBeenCalled());
    expect(mock.contact.updateContact).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ contact_type: 'both', name: 'Buildwell' }),
    );
    // onCreated is create-only.
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('still refuses a nameless contact', async () => {
    mount(<ContactModal contactType="supplier" businessId="b1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('contact-modal-save'));
    await waitFor(() =>
      expect(screen.getByText('Name is required')).toBeTruthy(),
    );
    expect(mock.contact.createContact).not.toHaveBeenCalled();
  });
});
