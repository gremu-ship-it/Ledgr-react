// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConstructionProjectSetupDraftPage } from '@/pages/ConstructionProjectSetupDraftPage';
import { useAppStore } from '@/store/useAppStore';

const BUSINESS_A = {
  role: 'owner',
  business: {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Business A',
    base_currency: 'MWK',
  },
};
const BUSINESS_B = {
  role: 'owner',
  business: {
    id: '20000000-0000-0000-0000-000000000001',
    name: 'Business B',
    base_currency: 'ZMW',
  },
};
const fetchMock = vi.fn();

function storageSnapshot(): Array<[string, string | null]> {
  return Array.from({ length: window.localStorage.length }, (_, index) => {
    const key = window.localStorage.key(index)!;
    return [key, window.localStorage.getItem(key)];
  });
}

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <ConstructionProjectSetupDraftPage />
    </MemoryRouter>,
  );
}

async function createDraft(
  name: string,
  status: 'draft' | 'active' | 'needs_attention' | 'completed',
  code = '',
  siteName = '',
  siteLocation = '',
) {
  fireEvent.click(screen.getByRole('button', { name: 'Create project draft' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Project code'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('Site name'), { target: { value: siteName } });
  fireEvent.change(screen.getByLabelText('Site location'), { target: { value: siteLocation } });
  fireEvent.change(screen.getByLabelText('Local status'), { target: { value: status } });
  fireEvent.submit(document.querySelector('form')!);
  expect(await screen.findByRole('heading', { name })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ currentBusiness: BUSINESS_A });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ConstructionProjectSetupDraftPage', () => {
  it('shows an honest empty state and does not load or persist projects', () => {
    const storageBefore = storageSnapshot();
    renderWorkspace();

    expect(screen.getByRole('heading', { name: 'Construction workspace' })).toBeTruthy();
    expect(screen.getByText(/No saved project records are loaded or changed here/i)).toBeTruthy();
    expect(screen.getByText(/No sample project data is shown as real business data/i)).toBeTruthy();
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Create the first project draft' })).toBeTruthy();
    expect(storageSnapshot()).toEqual(storageBefore);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates, creates, inspects, edits, searches, and filters local drafts', async () => {
    const storageBefore = storageSnapshot();
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Create project draft' }));
    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    expect(await screen.findByText('Project name is required to keep a draft in this tab.')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: 'Borehole works' } });
    fireEvent.change(screen.getByLabelText('Project code'), { target: { value: 'TEMP-01' } });
    fireEvent.change(screen.getByLabelText('Client or customer'), { target: { value: 'Client note only' } });
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'North site' } });
    fireEvent.change(screen.getByLabelText('Site location'), { target: { value: 'Blantyre' } });
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: '1250.50' } });
    fireEvent.change(screen.getByLabelText('Approved project budget'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Planned start date'), { target: { value: '2027-01-10' } });
    fireEvent.change(screen.getByLabelText('Planned completion date'), { target: { value: '2027-02-10' } });
    fireEvent.change(screen.getByLabelText('Project manager note'), { target: { value: 'Manager note only' } });
    fireEvent.change(screen.getByLabelText('Local status'), { target: { value: 'active' } });
    fireEvent.submit(form);

    expect(await screen.findByRole('heading', { name: 'Borehole works' })).toBeTruthy();
    expect(screen.getByText('Local draft · Business A')).toBeTruthy();
    expect(screen.getByText('Client / customer note')).toBeTruthy();
    expect(screen.getByText('Client note only')).toBeTruthy();
    expect(screen.getByText('North site')).toBeTruthy();
    expect(screen.getByText('Blantyre')).toBeTruthy();
    expect(screen.getByText('MWK 1250.50')).toBeTruthy();
    expect(screen.getByText('MWK 900')).toBeTruthy();
    expect(screen.getByText('Manager note only')).toBeTruthy();
    expect(screen.getByText('Active · local')).toBeTruthy();
    expect(screen.getByText(/not a saved Ledgr project/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue editing draft' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: 'Borehole works phase 2' } });
    fireEvent.submit(document.querySelector('form')!);
    expect(await screen.findByRole('heading', { name: 'Borehole works phase 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));

    await createDraft('Road rehabilitation', 'completed', 'TEMP-02');
    expect(screen.getByText('2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    expect(screen.getByRole('button', { name: 'View Borehole works phase 2 draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View Road rehabilitation draft' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'TEMP-02' } });
    expect(screen.getByRole('button', { name: 'View Road rehabilitation draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View Borehole works phase 2 draft' })).toBeNull();
    expect(storageSnapshot()).toEqual(storageBefore);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards a local draft and clears drafts when the business changes', async () => {
    renderWorkspace();
    await createDraft('Temporary job', 'draft');

    fireEvent.click(screen.getByRole('button', { name: 'View Temporary job draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }));
    expect(screen.getByRole('heading', { name: 'No project drafts in this tab yet' })).toBeTruthy();

    await createDraft('Business A draft', 'active');
    useAppStore.setState({ currentBusiness: BUSINESS_B });
    await waitFor(() => {
      expect(screen.getByText(/Organise project briefs for Business B/)).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'No project drafts in this tab yet' })).toBeTruthy();
      expect(screen.getAllByText('0')).toHaveLength(4);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a selected business before a draft can be started', () => {
    useAppStore.setState({ currentBusiness: null });
    renderWorkspace();

    expect((screen.getByRole('button', { name: 'Create project draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Select a business in Ledgr before keeping a local draft');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prepares a source-referenced receipt note, keeps it local, and clears it with the business context', async () => {
    const storageBefore = storageSnapshot();
    renderWorkspace();
    await createDraft('Borehole works', 'active', 'TEMP-01', 'North site', 'Blantyre');

    fireEvent.click(screen.getByRole('button', { name: 'View Borehole works draft' }));
    expect(screen.getByRole('heading', { name: 'Material receipt preparation' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare receipt note' }));

    fireEvent.change(screen.getByLabelText('Source document type'), { target: { value: 'supplier_delivery_note' } });
    fireEvent.change(screen.getByLabelText('Source document reference'), { target: { value: 'DN-0057' } });
    fireEvent.change(screen.getByLabelText('Source document date'), { target: { value: '2026-10-14' } });
    fireEvent.change(screen.getByLabelText('Supplier name note'), { target: { value: 'Supplier note only' } });
    expect((screen.getByLabelText('Destination site or storage-point note') as HTMLInputElement).value)
      .toBe('North site · Blantyre');
    fireEvent.change(screen.getByLabelText('Material description'), { target: { value: 'Cement' } });
    fireEvent.change(screen.getByLabelText('Item or code note'), { target: { value: 'CEM-01' } });
    fireEvent.change(screen.getByLabelText('Unit note'), { target: { value: 'bag' } });
    fireEvent.change(screen.getByLabelText('Delivered quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Accepted quantity (optional)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Rejected quantity (optional)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add material line' }));
    const initialDescriptions = screen.getAllByLabelText('Material description');
    fireEvent.change(initialDescriptions[1], { target: { value: 'Steel bar' } });
    fireEvent.change(screen.getAllByLabelText('Unit note')[1], { target: { value: 'length' } });
    fireEvent.change(screen.getAllByLabelText('Delivered quantity')[1], { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));

    expect(await screen.findByRole('heading', { name: 'Supplier delivery note · DN-0057' })).toBeTruthy();
    expect(screen.getByText('Prepared in this tab · not approved')).toBeTruthy();
    expect(screen.getByText('Supplier note only')).toBeTruthy();
    expect(screen.getByText('Cement')).toBeTruthy();
    expect(screen.getByText('Steel bar')).toBeTruthy();
    expect(screen.getByText('Preparation only — not a goods receipt.')).toBeTruthy();
    expect(screen.getByText(/not receipt acceptance, source matching, stock movements, approvals, or accounting entries/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /post|issue stock|transfer stock/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(storageBefore);

    fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View Borehole works draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'View receipt preparation DN-0057' }));
    expect(screen.getByRole('heading', { name: 'Supplier delivery note · DN-0057' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit preparation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add material line' }));
    const reopenedDescriptions = screen.getAllByLabelText('Material description');
    expect(reopenedDescriptions).toHaveLength(3);
    fireEvent.change(reopenedDescriptions[2], { target: { value: 'Rebar' } });
    fireEvent.change(screen.getAllByLabelText('Unit note')[2], { target: { value: 'piece' } });
    fireEvent.change(screen.getAllByLabelText('Delivered quantity')[2], { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));
    expect(await screen.findByText('Rebar')).toBeTruthy();
    expect(screen.getByText('Steel bar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));
    useAppStore.setState({ currentBusiness: BUSINESS_B });
    await waitFor(() => {
      expect(screen.getByText(/Organise project briefs for Business B/)).toBeTruthy();
      expect(screen.queryByText('Material receipt preparation')).toBeNull();
      expect(screen.getAllByText('0')).toHaveLength(4);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(storageBefore);
  });

  it('rejects an invalid receipt quantity and does not create a receipt preparation', async () => {
    renderWorkspace();
    await createDraft('Bridge repairs', 'draft');
    fireEvent.click(screen.getByRole('button', { name: 'View Bridge repairs draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare receipt note' }));

    fireEvent.change(screen.getByLabelText('Source document type'), { target: { value: 'purchase_order' } });
    fireEvent.change(screen.getByLabelText('Source document reference'), { target: { value: 'PO-14' } });
    fireEvent.change(screen.getByLabelText('Destination site or storage-point note'), { target: { value: 'Bridge site' } });
    fireEvent.change(screen.getByLabelText('Material description'), { target: { value: 'Steel bar' } });
    fireEvent.change(screen.getByLabelText('Unit note'), { target: { value: 'length' } });
    fireEvent.change(screen.getByLabelText('Delivered quantity'), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));

    expect(await screen.findByText('Enter a finite delivered quantity greater than zero.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Correct the highlighted fields');
    expect(screen.queryByRole('button', { name: 'View receipt preparation PO-14' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
