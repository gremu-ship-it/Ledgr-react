// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConstructionProjectSetupDraftPage } from '@/pages/ConstructionProjectSetupDraftPage';
import { useAppStore } from '@/store/useAppStore';

const BUSINESS_A = { role: 'owner', business: { id: '10000000-0000-0000-0000-000000000001', name: 'Business A' } };
const BUSINESS_B = { role: 'owner', business: { id: '20000000-0000-0000-0000-000000000001', name: 'Business B' } };
const fetchMock = vi.fn();

function storageSnapshot(): Array<[string, string | null]> {
  return Array.from({ length: window.localStorage.length }, (_, index) => {
    const key = window.localStorage.key(index)!;
    return [key, window.localStorage.getItem(key)];
  });
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
  it('keeps fields optional and saves a labeled draft only in page memory', async () => {
    const { container } = render(
      <MemoryRouter>
        <ConstructionProjectSetupDraftPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Construction Project Setup' })).toBeTruthy();
    expect(screen.getByText('Business A')).toBeTruthy();
    expect(screen.getByText(/does not create or read a Ledgr project/i)).toBeTruthy();

    const fields = [
      'Project name',
      'Project code',
      'Client note',
      'Project manager note',
      'Construction site note',
      'Status note',
      'Contract value note',
      'Approved budget note',
      'Planned start date',
      'Target end date',
    ];
    for (const label of fields) {
      expect((screen.getByLabelText(label) as HTMLInputElement).required).toBe(false);
    }

    const storageBefore = storageSnapshot();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Borehole works' } });
    fireEvent.change(screen.getByLabelText('Project code'), { target: { value: 'TEMP-01' } });
    fireEvent.change(screen.getByLabelText('Status note'), { target: { value: 'Awaiting confirmation' } });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('Draft kept in this tab only. It has not been saved to Ledgr.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Borehole works' })).toBeTruthy();
    expect(screen.getByText('TEMP-01')).toBeTruthy();
    expect(screen.getByText('Awaiting confirmation')).toBeTruthy();
    expect(screen.getByText('1 temporary draft')).toBeTruthy();
    expect(storageSnapshot()).toEqual(storageBefore);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards a local draft and clears it when the selected business changes', async () => {
    const { container } = render(
      <MemoryRouter>
        <ConstructionProjectSetupDraftPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Road rehabilitation' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByRole('heading', { name: 'Road rehabilitation' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Discard Road rehabilitation draft' }));
    expect(await screen.findByText('0 temporary drafts')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Road rehabilitation' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Temporary job' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByRole('heading', { name: 'Temporary job' })).toBeTruthy();

    useAppStore.setState({ currentBusiness: BUSINESS_B });
    await waitFor(() => {
      expect(screen.getByText('Business B')).toBeTruthy();
      expect(screen.getByText('0 temporary drafts')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Temporary job' })).toBeNull();
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not permit a draft to be kept without a selected business', async () => {
    useAppStore.setState({ currentBusiness: null });
    const { container } = render(
      <MemoryRouter>
        <ConstructionProjectSetupDraftPage />
      </MemoryRouter>,
    );

    expect((screen.getByRole('button', { name: 'Keep draft in this tab' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Select a business in the main Ledgr workspace');
    expect(container.querySelector('form')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
