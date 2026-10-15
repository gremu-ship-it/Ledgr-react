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

async function createDraft(name: string, status: 'draft' | 'active' | 'needs_attention' | 'completed', code = '') {
  fireEvent.click(screen.getByRole('button', { name: 'Create project draft' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Project code'), { target: { value: code } });
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
});
