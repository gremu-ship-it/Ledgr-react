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

async function createDraft(name: string, code: string, siteName: string, siteLocation: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Create project draft' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Project code'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('Site name'), { target: { value: siteName } });
  fireEvent.change(screen.getByLabelText('Site location'), { target: { value: siteLocation } });
  fireEvent.submit(document.querySelector('form')!);
  expect(await screen.findByRole('heading', { name })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));
}

async function openProject(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `View ${name} draft` }));
  expect(await screen.findByRole('heading', { name: 'Store-to-site transfer preparation' })).toBeTruthy();
}

async function fillTransferHeader(reference = 'TR-NOTE-01') {
  fireEvent.change(screen.getByLabelText('Transfer reference note'), { target: { value: reference } });
  fireEvent.change(screen.getByLabelText('Source document reference note'), { target: { value: 'REQ-NOTE-8' } });
  fireEvent.change(screen.getByLabelText('Transfer date note'), { target: { value: '2026-10-14' } });
  fireEvent.change(screen.getByLabelText('Source store or location note'), { target: { value: 'Main store note' } });
  fireEvent.change(screen.getByLabelText('Material description'), { target: { value: 'Cement' } });
  fireEvent.change(screen.getByLabelText('Item or code note'), { target: { value: 'CEM-01' } });
  fireEvent.change(screen.getByLabelText('Unit note'), { target: { value: 'bag' } });
  fireEvent.change(screen.getByLabelText('Requested quantity'), { target: { value: '5' } });
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

describe('Construction store-to-site transfer preparation', () => {
  it('prepares, dispatches, and records a receipt observation locally with validation retries', async () => {
    const storageBefore = storageSnapshot();
    renderWorkspace();
    await createDraft('Borehole works', 'TEMP-01', 'North site', 'Blantyre');
    fireEvent.click(screen.getByRole('button', { name: 'View Borehole works draft' }));

    expect(screen.getByRole('heading', { name: 'Store-to-site transfer preparation' })).toBeTruthy();
    expect(screen.getByText(/not an inventory transfer/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare transfer note' }));
    await fillTransferHeader();
    expect((screen.getByLabelText('Destination site or location note') as HTMLInputElement).value)
      .toBe('North site · Blantyre');
    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));

    expect(await screen.findByRole('heading', { name: 'TR-NOTE-01' })).toBeTruthy();
    expect(screen.getByText(/not an approval or a saved transfer/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /post|issue stock|transfer stock/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add dispatch observation' }));
    fireEvent.change(screen.getByLabelText('Dispatch date note'), { target: { value: '2026-10-15' } });
    fireEvent.change(screen.getByLabelText('Dispatch note'), { target: { value: 'Vehicle note only' } });
    fireEvent.change(screen.getByLabelText('Dispatched quantity note'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save dispatch observation in this tab' }));

    expect(await screen.findByText('Dispatch quantity cannot exceed the requested quantity.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Correct the highlighted fields');
    expect(screen.queryByText('Dispatch quantities noted · not posted')).toBeNull();

    fireEvent.change(screen.getByLabelText('Dispatched quantity note'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save dispatch observation in this tab' }));
    expect(await screen.findByText(/source stock was not decreased/i)).toBeTruthy();
    expect(screen.getByText(/Vehicle note only/)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add receipt observation' }));
    fireEvent.change(screen.getByLabelText('Receipt date note'), { target: { value: '2026-10-16' } });
    fireEvent.change(screen.getByLabelText('Receipt note'), { target: { value: 'Counted at site, local note' } });
    fireEvent.change(screen.getByLabelText('Received quantity note'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save receipt observation in this tab' }));

    expect(await screen.findByText('Receipt quantity cannot exceed the dispatch quantity.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Received quantity note'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save receipt observation in this tab' }));

    expect(await screen.findByRole('heading', { name: 'TR-NOTE-01' })).toBeTruthy();
    expect(screen.getByText('Receipt quantities noted · not posted')).toBeTruthy();
    expect(screen.getByText(/Counted at site, local note/)).toBeTruthy();
    expect(screen.getByText('Receipt note is below the dispatch note; review the difference. No adjustment is recorded.')).toBeTruthy();
    expect(screen.getByText(/destination stock was not increased/i)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(storageBefore);
  });

  it('isolates notes by project and clears the in-memory note when business context changes', async () => {
    const storageBefore = storageSnapshot();
    renderWorkspace();
    await createDraft('Project One', 'P-01', 'Site one', 'Blantyre');
    await createDraft('Project Two', 'P-02', 'Site two', 'Zomba');

    await openProject('Project One');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare transfer note' }));
    await fillTransferHeader('ONLY-PROJECT-ONE');
    fireEvent.click(screen.getByRole('button', { name: 'Mark prepared in this tab' }));
    expect(await screen.findByRole('heading', { name: 'ONLY-PROJECT-ONE' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View Project Two draft' }));
    expect(screen.getByRole('heading', { name: 'Store-to-site transfer preparation' })).toBeTruthy();
    expect(screen.getByText(/No store-to-site transfer preparations for this local project/i)).toBeTruthy();
    expect(screen.queryByText('ONLY-PROJECT-ONE')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Back to workspace/ }));
    useAppStore.setState({ currentBusiness: BUSINESS_B });
    await waitFor(() => {
      expect(screen.getByText(/Organise project briefs for Business B/)).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'No project drafts in this tab yet' })).toBeTruthy();
    });
    expect(screen.queryByText('ONLY-PROJECT-ONE')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(storageBefore);
  });
});
