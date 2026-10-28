// @vitest-environment jsdom
/**
 * The invoice builder's construction behaviour (Stage B).
 *
 * Two customer-facing promises are tested here, and nothing about the database:
 *
 *   1. A construction invoice may be a *summary* — a description and a price with
 *      no product line — and creating it must not deduct stock or post cost of
 *      sales. Stock only ever moves through the construction material-issue
 *      command, which lives in the construction workspace; raising an invoice is
 *      not a second inventory ledger.
 *   2. The optional construction project link sets `invoices.project_code` from the
 *      selected site's `project_ref`. That column is TEXT, not a foreign key, so the
 *      only guard rails are the ones asserted here: the site must be in the
 *      branch-scoped list the signed-in user was given, it must belong to this
 *      business, and it must agree with the invoice's branch when one is chosen.
 *
 * These tests prove the screen's behaviour, not authorisation: a mocked repository
 * proves nothing about row level security.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const inventory = vi.hoisted(() => ({ db: { from: vi.fn() }, findAllProducts: vi.fn() }));
const invoice = vi.hoisted(() => ({ findByBusiness: vi.fn(), createWithLines: vi.fn() }));
const business = vi.hoisted(() => ({ reserveNextInvoiceNumber: vi.fn() }));
const contact = vi.hoisted(() => ({ findByBusiness: vi.fn(), create: vi.fn() }));
const construction = vi.hoisted(() => ({ findSites: vi.fn() }));
const createInvoiceReceivableEntry = vi.hoisted(() => vi.fn());
const deductStockAndPostCogs = vi.hoisted(() => vi.fn());
const resolveTransactionRate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories', () => ({ repos: { inventory, invoice, business, contact, construction } }));
vi.mock('@/services/journalService', () => ({
  createInvoiceJournalEntry: vi.fn(),
  createInvoiceReceivableEntry,
}));
vi.mock('@/services/inventoryJournalService', () => ({ deductStockAndPostCogs }));
vi.mock('@/lib/currency', () => ({ resolveTransactionRate }));
vi.mock('@/hooks/useUsage', () => ({ useUsage: () => ({ planTier: 'business', usage: null }) }));
vi.mock('@/partner/PartnerContext', () => ({
  usePartner: () => ({ isFeatureEnabled: () => false, partner: null }),
  PartnerProvider: ({ children }: { children: unknown }) => children,
}));

import { IncomePage } from '@/pages/IncomePage';
import { useAppStore } from '@/store/useAppStore';

const BUSINESS_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_BUSINESS_ID = '20000000-0000-4000-8000-000000000001';
const BRANCH_A1 = '30000000-0000-4000-8000-000000000001';
const BRANCH_A2 = '30000000-0000-4000-8000-000000000002';
const SITE_ID = '40000000-0000-4000-8000-000000000001';
const SITE_OTHER_BRANCH = '40000000-0000-4000-8000-000000000002';
const SITE_OTHER_BUSINESS = '40000000-0000-4000-8000-000000000003';
const CONTACT_ID = '50000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '60000000-0000-4000-8000-000000000001';

const SUMMARY_DESCRIPTION = 'Construction of office building';

function site(over: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    business_id: BUSINESS_ID,
    branch_id: BRANCH_A1,
    location_id: '70000000-0000-4000-8000-000000000001',
    site_code: 'SITE-01',
    site_name: 'Area 47 offices',
    project_ref: 'PRJ-OFFICE-1',
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

/** The chain the page's branch/department hooks await on. */
function tableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    is: vi.fn(chain),
    order: vi.fn(async () => result),
  });
  return query;
}

function renderBuilder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/income?action=invoice']}>
        <IncomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Finds a select by one of its option labels, because the page's labels are not `for`-bound. */
function selectShowing(optionText: string): HTMLSelectElement {
  const match = screen
    .getAllByRole('combobox')
    .find((element) => within(element as HTMLElement).queryByText(optionText));
  if (!match) throw new Error(`No select offers "${optionText}"`);
  return match as HTMLSelectElement;
}

async function chooseCustomer() {
  const select = await waitFor(() => selectShowing('Select customer…'));
  fireEvent.change(select, { target: { value: CONTACT_ID } });
}

async function fillSummaryLine() {
  fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: SUMMARY_DESCRIPTION } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '5000000' } });
}

async function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    currentBusiness: {
      role: 'owner',
      business: { id: BUSINESS_ID, name: 'Ledgr Builders', base_currency: 'MWK' },
    },
  } as never);

  inventory.db.from.mockImplementation((table: string) =>
    table === 'branches'
      ? tableQuery({ data: [{ id: BRANCH_A1, name: 'Blantyre', code: 'BT' }], error: null })
      : tableQuery({ data: [], error: null }),
  );
  inventory.findAllProducts.mockResolvedValue([]);
  invoice.findByBusiness.mockResolvedValue([]);
  invoice.createWithLines.mockResolvedValue({
    invoice: { id: 'inv-1', business_id: BUSINESS_ID, invoice_number: 'INV-001', status: 'draft' },
    lines: [],
  });
  business.reserveNextInvoiceNumber.mockResolvedValue('INV-001');
  contact.findByBusiness.mockResolvedValue([{ id: CONTACT_ID, name: 'Ministry of Works', contact_type: 'customer' }]);
  construction.findSites.mockResolvedValue([site()]);
  resolveTransactionRate.mockResolvedValue({ rate: 1, rateDate: '2026-10-16', isStale: false });
  createInvoiceReceivableEntry.mockResolvedValue(undefined);
  deductStockAndPostCogs.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvoiceBuilderTab — construction summary invoice', () => {
  it('links the selected site as the project reference without adding any material line', async () => {
    renderBuilder();
    await chooseCustomer();
    await fillSummaryLine();

    const projectSelect = await waitFor(() => selectShowing('SITE-01 · Area 47 offices (PRJ-OFFICE-1)'));
    fireEvent.change(projectSelect, { target: { value: SITE_ID } });
    await submit();

    await waitFor(() => expect(invoice.createWithLines).toHaveBeenCalledTimes(1));
    const [header, lines] = invoice.createWithLines.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>[]];

    expect(header.project_code).toBe('PRJ-OFFICE-1');
    // Exactly the one line the user typed: no materials were appended.
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe(SUMMARY_DESCRIPTION);
    expect(lines[0].product_id).toBeNull();
  });

  it('posts no stock and no cost of sales for a summary line', async () => {
    invoice.createWithLines.mockResolvedValue({
      invoice: { id: 'inv-1', business_id: BUSINESS_ID, invoice_number: 'INV-001', status: 'sent' },
      lines: [],
    });
    renderBuilder();
    await chooseCustomer();
    await fillSummaryLine();
    await submit();

    await waitFor(() => expect(createInvoiceReceivableEntry).toHaveBeenCalledTimes(1));
    // The stock path is reached but with an empty product list — nothing to move,
    // which is what "no second inventory ledger" means in practice.
    expect(deductStockAndPostCogs).toHaveBeenCalledTimes(1);
    const stockArgs = deductStockAndPostCogs.mock.calls[0] as unknown[];
    expect(stockArgs[2]).toEqual([]);
  });

  it('still deducts stock for a product line', async () => {
    inventory.findAllProducts.mockResolvedValue([
      { id: PRODUCT_ID, name: 'Cement 50kg', product_type: 'product', unit_of_measure: 'BAG', sales_account_id: 'acct-1' },
    ]);
    invoice.createWithLines.mockResolvedValue({
      invoice: { id: 'inv-2', business_id: BUSINESS_ID, invoice_number: 'INV-002', status: 'sent' },
      lines: [],
    });
    renderBuilder();
    await chooseCustomer();
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Cement' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '25000' } });

    const productSelect = await waitFor(() => selectShowing('Cement 50kg'));
    fireEvent.change(productSelect, { target: { value: PRODUCT_ID } });
    await submit();

    await waitFor(() => expect(invoice.createWithLines).toHaveBeenCalledTimes(1));
    const [, lines] = invoice.createWithLines.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>[]];
    expect(lines[0].product_id).toBe(PRODUCT_ID);
    expect(lines[0].account_id).toBe('acct-1');

    await waitFor(() => expect(deductStockAndPostCogs).toHaveBeenCalledTimes(1));
    const stockArgs = deductStockAndPostCogs.mock.calls[0] as unknown[];
    expect(stockArgs[2]).toEqual([{ productId: PRODUCT_ID, quantity: 2 }]);
  });

  it('refuses a project that belongs to another business', async () => {
    construction.findSites.mockResolvedValue([
      site({ id: SITE_OTHER_BUSINESS, business_id: OTHER_BUSINESS_ID, site_code: 'SITE-99', project_ref: 'PRJ-FOREIGN' }),
    ]);
    renderBuilder();
    await chooseCustomer();
    await fillSummaryLine();

    const projectSelect = await waitFor(() => selectShowing('SITE-99 · Area 47 offices (PRJ-FOREIGN)'));
    fireEvent.change(projectSelect, { target: { value: SITE_OTHER_BUSINESS } });
    await submit();

    expect(await screen.findByText(/belongs to another business/i)).toBeTruthy();
    expect(invoice.createWithLines).not.toHaveBeenCalled();
  });

  it('refuses a project whose branch differs from the invoice branch', async () => {
    construction.findSites.mockResolvedValue([
      site({ id: SITE_OTHER_BRANCH, branch_id: BRANCH_A2, site_code: 'SITE-02', project_ref: 'PRJ-OFFICE-2' }),
    ]);
    renderBuilder();
    await chooseCustomer();
    await fillSummaryLine();
    const branchSelect = await waitFor(() => selectShowing('Blantyre (BT)'));
    fireEvent.change(branchSelect, { target: { value: BRANCH_A1 } });

    const projectSelect = await waitFor(() => selectShowing('SITE-02 · Area 47 offices (PRJ-OFFICE-2)'));
    fireEvent.change(projectSelect, { target: { value: SITE_OTHER_BRANCH } });
    await submit();

    expect(await screen.findByText(/branch differ/i)).toBeTruthy();
    expect(invoice.createWithLines).not.toHaveBeenCalled();
  });
});

describe('what the customer-facing surfaces can disclose', () => {
  /**
   * The invoice PDF echoes each *stored* line's description, quantity, unit price
   * and line total verbatim (`documentGenerator.ts`), and an export echoes the
   * stored rows. So the disclosure boundary is what the invoice stores: this test
   * pins that a construction invoice stores the summary line and the project
   * reference and nothing that describes material consumed on site.
   */
  it('stores only the summary line and the project reference, so no material detail can be echoed', async () => {
    renderBuilder();
    await chooseCustomer();
    await fillSummaryLine();
    const projectSelect = await waitFor(() => selectShowing('SITE-01 · Area 47 offices (PRJ-OFFICE-1)'));
    fireEvent.change(projectSelect, { target: { value: SITE_ID } });
    await submit();

    await waitFor(() => expect(invoice.createWithLines).toHaveBeenCalledTimes(1));
    const [header, lines] = invoice.createWithLines.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>[]];

    expect(header.project_code).toBe('PRJ-OFFICE-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe(SUMMARY_DESCRIPTION);

    // Nothing that describes site consumption or the construction ledger.
    const payload = JSON.stringify({ header, lines });
    for (const leak of ['material_issue', 'issue_out', 'stock_movement', 'quantity_base', 'construction_']) {
      expect(payload).not.toContain(leak);
    }
  });
});
