// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { i18n } from '@/i18n';

const mock = vi.hoisted(() => ({
  contact: {
    findClientContacts: vi.fn(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
  },
}));
vi.mock('@/lib/repositories', () => ({
  repos: { contact: mock.contact },
}));

import { ClientPicker } from '../ClientPicker';

const BIZ = 'b1';

const clientContact = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'City Council',
  tpin: null,
  vat_number: null,
  contact_type: 'customer',
  is_active: true,
  ...overrides,
});

function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function picker(props: Partial<Parameters<typeof ClientPicker>[0]> = {}, onChange = vi.fn()) {
  mount(
    <ClientPicker
      businessId={BIZ}
      value={null}
      clientName=""
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  void i18n.changeLanguage('en');
  mock.contact.findClientContacts.mockResolvedValue([
    clientContact(),
    clientContact({ id: 'c2', name: 'Zomba Builders', tpin: '100200300' }),
    clientContact({ id: 'c3', name: 'Mzuzu Hardware', contact_type: 'both' }),
  ]);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ClientPicker — listing and selection', () => {
  it('shows the placeholder closed, lists billing-eligible contacts open', async () => {
    picker();
    expect(screen.getByText('Search clients...')).toBeTruthy();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    expect(await screen.findByTestId('client-picker-option-c1')).toBeTruthy();
    expect(screen.getByText('City Council')).toBeTruthy();
    // TPIN subtitle when present.
    expect(screen.getByText('TPIN 100200300')).toBeTruthy();
    expect(mock.contact.findClientContacts).toHaveBeenCalledWith(BIZ, '');
  });

  it('badges dual-role contacts as Customer & Supplier', async () => {
    picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    await screen.findByTestId('client-picker-option-c3');
    expect(screen.getByText('Customer & Supplier')).toBeTruthy();
  });

  it('selecting a contact reports (id, name) through onChange and closes', async () => {
    const onChange = picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    fireEvent.click(await screen.findByTestId('client-picker-option-c2'));
    expect(onChange).toHaveBeenCalledWith('c2', 'Zomba Builders');
    expect(screen.queryByTestId('client-picker-dropdown')).toBeNull();
  });

  it('debounces the search and pushes terms of 2+ chars to the repository', async () => {
    picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    const search = await screen.findByTestId('client-picker-search');
    mock.contact.findClientContacts.mockClear();
    fireEvent.change(search, { target: { value: 'zo' } });
    await waitFor(() =>
      expect(mock.contact.findClientContacts).toHaveBeenCalledWith(BIZ, 'zo'),
    );
  });

  it('shows the empty state when there are no clients and nothing typed', async () => {
    mock.contact.findClientContacts.mockResolvedValue([]);
    picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    expect(
      await screen.findByText('No clients found. Add one to get started.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('client-picker-create')).toBeNull();
  });
});

describe('ClientPicker — inline creation', () => {
  it('offers Create client "<term>" on an unmatched search and selects the new contact', async () => {
    mock.contact.findClientContacts.mockResolvedValue([]);
    mock.contact.createContact.mockResolvedValue({
      id: 'new-1',
      name: 'Zomba Ltd',
      contact_type: 'customer',
    });
    const onChange = picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    fireEvent.change(await screen.findByTestId('client-picker-search'), {
      target: { value: 'Zomba Ltd' },
    });
    const createOption = await screen.findByTestId('client-picker-create');
    expect(createOption.textContent).toContain('Create client "Zomba Ltd"');
    fireEvent.click(createOption);
    await waitFor(() =>
      expect(mock.contact.createContact).toHaveBeenCalledWith({
        business_id: BIZ,
        name: 'Zomba Ltd',
        contact_type: 'customer',
        is_active: true,
        wht_exempt: false,
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('new-1', 'Zomba Ltd'));
  });

  it('does not offer inline create when a typed name exactly matches a listed contact', async () => {
    picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    fireEvent.change(await screen.findByTestId('client-picker-search'), {
      target: { value: 'City Council' },
    });
    await waitFor(() =>
      expect(mock.contact.findClientContacts).toHaveBeenCalledWith(BIZ, 'City Council'),
    );
    expect(screen.queryByTestId('client-picker-create')).toBeNull();
  });

  it('opens the shared ContactModal from Add new client with the typed name prefilled', async () => {
    picker();
    fireEvent.click(screen.getByTestId('client-picker-toggle'));
    fireEvent.change(await screen.findByTestId('client-picker-search'), {
      target: { value: 'Mchinji' },
    });
    fireEvent.click(await screen.findByTestId('client-picker-add-new'));
    expect(await screen.findByTestId('contact-modal')).toBeTruthy();
    expect((screen.getByTestId('contact-modal-name') as HTMLInputElement).value).toBe(
      'Mchinji',
    );
  });
});

describe('ClientPicker — linked state and unlinking', () => {
  it('renders the linked client with its badge', () => {
    picker({ value: 'c1', clientName: 'City Council' });
    expect(screen.getByTestId('client-picker-linked-name').textContent).toBe(
      'City Council',
    );
    expect(screen.getByText('Linked client')).toBeTruthy();
    expect(screen.getByTestId('client-picker-unlink')).toBeTruthy();
  });

  it('unlinking confirms first, then reports (null, preserved name)', () => {
    const onChange = picker({ value: 'c1', clientName: 'City Council' });
    fireEvent.click(screen.getByTestId('client-picker-unlink'));
    expect(window.confirm).toHaveBeenCalledWith(
      'Remove the client link? The project will keep the client name as text.',
    );
    expect(onChange).toHaveBeenCalledWith(null, 'City Council');
  });

  it('a declined confirmation keeps the link untouched', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const onChange = picker({ value: 'c1', clientName: 'City Council' });
    fireEvent.click(screen.getByTestId('client-picker-unlink'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
