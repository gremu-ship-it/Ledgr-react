// @vitest-environment jsdom
/**
 * The tax-configuration screen: an effective-dated schedule with its evidence.
 *
 * The database is the authority for the non-overlap rule and the evidence rule
 * (migration 20261022000000; proven in tests/release/tax-configurations.test.ts).
 * These tests are about what the screen does with a schedule and with a refusal:
 * that it shows every stored period — not only the one in force today, which is
 * what the previous "active as of today" query hid — that it distinguishes the
 * business's own rate from the rate the product evidences, that adopting the
 * supported rate costs one deliberate click and carries the evidence reference,
 * that it never rewrites a business's stored rate to make it agree, and that a
 * refusal (including the silent one row level security produces) is shown as a
 * refusal rather than as success.
 *
 * They cannot prove authorisation: a mocked repository proves nothing about the
 * database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const tax = vi.hoisted(() => ({
  findScheduleByBusiness: vi.fn(),
  findPayeBands: vi.fn(),
  findByCode: vi.fn(),
  findActiveByBusiness: vi.fn(),
  getVatRate: vi.fn(),
  getWhtRate: vi.fn(),
  calculatePaye: vi.fn(),
  client: { from: vi.fn() },
}));
const account = vi.hoisted(() => ({ findPostingAccounts: vi.fn() }));

vi.mock('@/lib/repositories', () => ({ repos: { tax, account } }));

import { TaxPage } from '@/pages/TaxPage';
import { useAppStore } from '@/store/useAppStore';
import { NO_ROW_CHANGED_MESSAGE } from '@/lib/tax/taxConfiguration';
import { VAT_STANDARD_RATE_EVIDENCE_REFERENCE } from '@/lib/vat';

const BUSINESS_ID = '10000000-0000-0000-0000-000000000001';
const TODAY = new Date().toISOString().slice(0, 10);
/** The product only evidences the standard rate from this date on. */
const SUPPORTED_FROM = '2026-01-01';

/** What a write returns: rows (so the screen can tell a refusal from success) or an error. */
const write = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  eq: vi.fn(),
  outcome: { data: [{ id: 'cfg-1' }], error: null } as { data: unknown; error: unknown },
}));

function storedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    business_id: BUSINESS_ID,
    tax_code: 'vat_standard',
    name: 'VAT — Standard Rate',
    description: null,
    rate: 17.5,
    employer_rate: null,
    employee_rate: null,
    mra_reference: VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
    effective_from: SUPPORTED_FROM,
    effective_to: null,
    is_active: true,
    tax_payable_account_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openNewConfig() {
  await screen.findByRole('button', { name: /New Tax Config/ });
  fireEvent.click(screen.getAllByRole('button', { name: /New Tax Config/ })[0]);
  return screen.findByRole('heading', { name: 'New Tax Configuration' });
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Create' }));

beforeEach(() => {
  vi.clearAllMocks();
  write.outcome = { data: [{ id: 'cfg-1' }], error: null };
  tax.client.from.mockImplementation(() => ({
    insert: (payload: unknown) => {
      write.insert(payload);
      return { select: async () => write.outcome };
    },
    update: (payload: unknown) => {
      write.update(payload);
      return { eq: (column: string, id: string) => { write.eq(column, id); return { select: async () => write.outcome }; } };
    },
    delete: () => ({ eq: (column: string, id: string) => { write.eq(column, id); write.remove(id); return { select: async () => write.outcome }; } }),
  }));
  tax.findScheduleByBusiness.mockResolvedValue([storedRow()]);
  tax.findPayeBands.mockResolvedValue([]);
  account.findPostingAccounts.mockResolvedValue([]);
  useAppStore.setState({
    currentBusiness: { role: 'owner', business: { id: BUSINESS_ID, name: 'Business A', base_currency: 'MWK' } },
  } as never);
});

afterEach(cleanup);

describe('tax configurations — the stored schedule', () => {
  it('shows a period that has not started and one that has ended, not only what is in force today', async () => {
    tax.findScheduleByBusiness.mockResolvedValue([
      storedRow({ id: 'now', effective_from: TODAY }),
      storedRow({ id: 'later', tax_code: 'wht_15', name: 'WHT 15%', rate: 15, effective_from: '2099-01-01', mra_reference: 'Income Tax Act Cap 13:02' }),
      storedRow({ id: 'past', tax_code: 'cit', name: 'CIT', rate: 30, effective_from: '2020-01-01', effective_to: '2020-12-31', mra_reference: 'Income Tax Act Cap 13:02' }),
    ]);
    renderPage();

    expect(await screen.findByText('wht_15')).toBeTruthy();
    expect(screen.getByText('cit')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('Ended')).toBeTruthy();
    expect(screen.getByText('In effect')).toBeTruthy();
    expect(tax.findScheduleByBusiness).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it('flags a rate above 0 that records no evidence reference, and leaves a zero-rate row alone', async () => {
    tax.findScheduleByBusiness.mockResolvedValue([
      storedRow({ id: 'no-ref', tax_code: 'fbt', name: 'FBT', rate: 30, mra_reference: null }),
      storedRow({ id: 'zero', tax_code: 'vat_exempt', name: 'VAT — Exempt', rate: 0, mra_reference: null }),
    ]);
    renderPage();

    expect(await screen.findByText('Not recorded')).toBeTruthy();
    expect(screen.getAllByText('Not recorded')).toHaveLength(1);
  });
});

describe('tax configurations — the standard VAT rate', () => {
  it('offers the evidenced rate when the business has none, prefilled with that rate and its reference', async () => {
    tax.findScheduleByBusiness.mockResolvedValue([storedRow({ id: 'wht', tax_code: 'wht_10', name: 'WHT 10%', rate: 10, mra_reference: 'Income Tax Act Cap 13:02' })]);
    renderPage();

    expect(await screen.findByText(/No VAT rate is recorded for this business/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Record the standard rate/ }));
    expect(await screen.findByRole('heading', { name: 'New Tax Configuration' })).toBeTruthy();

    expect((screen.getByLabelText(/MRA \/ evidence reference/) as HTMLInputElement).value).toBe(VAT_STANDARD_RATE_EVIDENCE_REFERENCE);
    expect((screen.getByLabelText(/Rate \(%\)/) as HTMLInputElement).value).toBe('17.5');
    expect((screen.getByLabelText(/Effective From/) as HTMLInputElement).value).toBe(SUPPORTED_FROM);

    save();
    await waitFor(() => expect(write.insert).toHaveBeenCalledTimes(1));
    expect(write.insert.mock.calls[0][0]).toMatchObject({
      business_id: BUSINESS_ID,
      tax_code: 'vat_standard',
      rate: 17.5,
      mra_reference: VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
      effective_from: SUPPORTED_FROM,
      effective_to: null,
    });
    expect(await screen.findByText('Tax config created.')).toBeTruthy();
  });

  it('says nothing about adopting a rate when the business already records the evidenced one', async () => {
    renderPage();
    expect(await screen.findByText('vat_standard')).toBeTruthy();
    expect(screen.queryByText(/No VAT rate is recorded/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Record the standard rate/ })).toBeNull();
  });

  it('shows the business its own rate when it differs from the evidenced one, and changes nothing itself', async () => {
    tax.findScheduleByBusiness.mockResolvedValue([
      storedRow({ id: 'old', rate: 16.5, effective_from: '2024-01-01', mra_reference: 'VAT Act Cap 42:02 — 16.5% schedule' }),
    ]);
    renderPage();

    expect(await screen.findByText(/This business records 16\.50% for/)).toBeTruthy();
    // The screen states the disagreement; it never rewrites the business's row to agree.
    expect(write.update).not.toHaveBeenCalled();
    expect(write.insert).not.toHaveBeenCalled();
  });

  it('names conflicting periods instead of resolving a rate from them', async () => {
    tax.findScheduleByBusiness.mockResolvedValue([
      storedRow({ id: 'a', rate: 16.5, effective_from: '2024-01-01' }),
      storedRow({ id: 'b', rate: 17.5, effective_from: '2024-01-01' }),
    ]);
    renderPage();

    expect(await screen.findByText(/Conflicting periods: vat_standard/)).toBeTruthy();
    expect(screen.getByText(/no single rate can be resolved/i)).toBeTruthy();
    expect(screen.queryByText(/No VAT rate is recorded/)).toBeNull();
  });
});

describe('tax configurations — refusals', () => {
  it('explains an overlap refusal from the server and keeps the server’s own wording', async () => {
    write.outcome = {
      data: null,
      error: Object.assign(
        new Error('conflicting key value violates exclusion constraint "tax_configurations_no_overlap"'),
        { code: '23P01' },
      ),
    };
    tax.findScheduleByBusiness.mockResolvedValue([]);
    renderPage();
    await openNewConfig();
    fireEvent.change(screen.getByLabelText(/^Name/) as HTMLInputElement, { target: { value: 'WHT 15%' } });
    fireEvent.change(screen.getByLabelText(/Rate \(%\)/) as HTMLInputElement, { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/MRA \/ evidence reference/) as HTMLInputElement, { target: { value: 'Income Tax Act Cap 13:02' } });
    save();

    expect(await screen.findByText(/already covers part of these dates/i)).toBeTruthy();
    expect(screen.getAllByText(/ends the day before/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/tax_configurations_no_overlap/)).toBeTruthy();
    expect(screen.queryByText('Tax config created.')).toBeNull();
  });

  it('explains a missing evidence reference from the server', async () => {
    write.outcome = {
      data: null,
      error: Object.assign(
        new Error('new row for relation "tax_configurations" violates check constraint "tax_configurations_evidence_chk"'),
        { code: '23514' },
      ),
    };
    tax.findScheduleByBusiness.mockResolvedValue([]);
    renderPage();
    await openNewConfig();
    fireEvent.change(screen.getByLabelText(/^Name/) as HTMLInputElement, { target: { value: 'CIT' } });
    fireEvent.change(screen.getByLabelText(/Rate \(%\)/) as HTMLInputElement, { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/MRA \/ evidence reference/) as HTMLInputElement, { target: { value: 'pending' } });
    save();

    expect(await screen.findByText(/must record the reference it relies on/i)).toBeTruthy();
    expect(screen.getByText(/tax_configurations_evidence_chk/)).toBeTruthy();
  });

  it('reports a write that changed no row (row level security hides it) instead of success', async () => {
    write.outcome = { data: [], error: null };
    tax.findScheduleByBusiness.mockResolvedValue([]);
    renderPage();
    await openNewConfig();
    fireEvent.change(screen.getByLabelText(/^Name/) as HTMLInputElement, { target: { value: 'WHT 15%' } });
    fireEvent.change(screen.getByLabelText(/Rate \(%\)/) as HTMLInputElement, { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/MRA \/ evidence reference/) as HTMLInputElement, { target: { value: 'Income Tax Act Cap 13:02' } });
    save();

    expect(await screen.findByText(NO_ROW_CHANGED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Tax config created.')).toBeNull();
  });

  it('reports a delete that removed nothing (row level security hid the row) and leaves it on screen', async () => {
    write.outcome = { data: [], error: null };
    renderPage();
    await screen.findByText('vat_standard');
    fireEvent.click(screen.getByRole('button', { name: /^Delete VAT — Standard Rate/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(NO_ROW_CHANGED_MESSAGE)).toBeTruthy();
    expect(write.remove).toHaveBeenCalledWith('cfg-1');
    expect(screen.getByText('vat_standard')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Delete?' })).toBeNull();
  });

  it('treats an authority denial as authority, not as a data problem', async () => {
    write.outcome = {
      data: null,
      error: Object.assign(new Error('permission denied for table tax_configurations'), { code: '42501' }),
    };
    renderPage();
    await openNewConfig();
    fireEvent.change(screen.getByLabelText(/^Name/) as HTMLInputElement, { target: { value: 'WHT 15%' } });
    fireEvent.change(screen.getByLabelText(/Rate \(%\)/) as HTMLInputElement, { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/MRA \/ evidence reference/) as HTMLInputElement, { target: { value: 'Income Tax Act Cap 13:02' } });
    save();

    expect(await screen.findByText('The change was not saved.')).toBeTruthy();
    expect(screen.getByText(/Ask a business owner or administrator/)).toBeTruthy();
    expect(screen.getByText(/permission denied for table tax_configurations/)).toBeTruthy();
  });

  it('refuses a rate above 0 without its reference before calling the server at all', async () => {
    tax.findScheduleByBusiness.mockResolvedValue([]);
    renderPage();
    await openNewConfig();
    fireEvent.change(screen.getByLabelText(/^Name/) as HTMLInputElement, { target: { value: 'CIT' } });
    fireEvent.change(screen.getByLabelText(/Rate \(%\)/) as HTMLInputElement, { target: { value: '30' } });
    save();

    expect(await screen.findByText(/must record the reference it relies on/i)).toBeTruthy();
    expect(write.insert).not.toHaveBeenCalled();
  });
});

describe('tax configurations — editing a stored period', () => {
  /**
   * Everything an edit writes goes out as one statement against one row, so a
   * refusal cannot leave the row half-changed: the database either applies the
   * whole update or none of it. These two cases pin that down — the screen never
   * follows a refusal with a second write, and never compensates for one.
   */
  async function openEdit() {
    await screen.findByText('vat_standard');
    fireEvent.click(screen.getByRole('button', { name: /^Edit VAT — Standard Rate/ }));
    return screen.findByRole('heading', { name: 'Edit Tax Configuration' });
  }

  it('sends one update for the stored row and nothing else', async () => {
    renderPage();
    await openEdit();

    expect((screen.getByLabelText(/Effective From/) as HTMLInputElement).value).toBe(SUPPORTED_FROM);
    // The row records the new rate from 1 January 2026; correcting the start date
    // is a single update of that row — not a delete and re-insert.
    fireEvent.change(screen.getByLabelText(/Effective From/) as HTMLInputElement, { target: { value: '2026-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(write.update).toHaveBeenCalledTimes(1));
    expect(write.update.mock.calls[0][0]).toMatchObject({
      business_id: BUSINESS_ID,
      tax_code: 'vat_standard',
      rate: 17.5,
      mra_reference: VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
      effective_from: '2026-02-01',
    });
    expect(write.eq).toHaveBeenCalledWith('id', 'cfg-1');
    expect(write.insert).not.toHaveBeenCalled();
    expect(write.remove).not.toHaveBeenCalled();
    expect(await screen.findByText('Tax config updated.')).toBeTruthy();
  });

  it('reports a refused edit as a refusal, with one attempt and no compensating write', async () => {
    write.outcome = {
      data: null,
      error: Object.assign(
        new Error('conflicting key value violates exclusion constraint "tax_configurations_no_overlap"'),
        { code: '23P01' },
      ),
    };
    renderPage();
    await openEdit();
    fireEvent.change(screen.getByLabelText(/Effective From/) as HTMLInputElement, { target: { value: '2025-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText(/already covers part of these dates/i)).toBeTruthy();
    expect(screen.getByText(/tax_configurations_no_overlap/)).toBeTruthy();
    expect(write.update).toHaveBeenCalledTimes(1);
    expect(write.insert).not.toHaveBeenCalled();
    expect(write.remove).not.toHaveBeenCalled();
    expect(screen.queryByText('Tax config updated.')).toBeNull();
  });
});
