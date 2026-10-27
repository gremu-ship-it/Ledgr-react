// @vitest-environment jsdom
/**
 * Supplier-bill matching — the screen's submit path.
 *
 * The command `match_construction_bill_line_to_receipt` and its rules (exact
 * product, PO supplier, registered reference, explicit conversion, both caps, the
 * evidenced exception for a quantity difference) already have server-side evidence
 * in `tests/release/construction-procurement.test.ts`. These tests cover only the
 * screen: that the primary action actually submits, that the operator chooses WHICH
 * receipt line is matched instead of the screen silently choosing one, that a
 * refusal is shown with its documented explanation, and that the control is
 * disabled with a reason rather than failing on submit.
 *
 * They cannot prove authorisation — a mocked repository proves nothing about the
 * database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { i18n } from '@/i18n';

const construction = vi.hoisted(() => ({
  findCapabilities: vi.fn(),
  findSites: vi.fn(),
  findReceipts: vi.fn(),
  findReceiptLines: vi.fn(),
  findSupplierBillLines: vi.fn(),
  findSupplierInvoiceReferences: vi.fn(),
  findAllocationsForBusiness: vi.fn(),
  matchBillLineToReceipt: vi.fn(),
  registerSupplierInvoiceReference: vi.fn(),
  registerSupplierInvoiceReferenceException: vi.fn(),
}));

const contactList = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));
const productList = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));
const billList = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/repositories', () => ({
  repos: {
    construction,
    contact: { findByBusiness: vi.fn(async () => contactList.value) },
    branch: { findByBusiness: vi.fn(async () => []), findLocations: vi.fn(async () => []) },
    inventory: { findAllProducts: vi.fn(async () => productList.value), findBalancesByLocation: vi.fn(async () => []) },
    expense: { findByBusiness: vi.fn(async () => billList.value) },
  },
}));

import { ConstructionWorkspacePage } from '@/pages/construction/ConstructionWorkspacePage';
import { useAppStore } from '@/store/useAppStore';
import { ConstructionCommandError } from '@/dal/repositories/ConstructionProcurementRepository';

const BUSINESS_ID = '10000000-0000-0000-0000-000000000001';
const SUPPLIER_ID = 'contact-supplier-1';

const RECEIPT = {
  id: 'grn-1',
  business_id: BUSINESS_ID,
  grn_number: 'GRN-000001',
  receipt_date: '2026-10-15',
  site_id: 'site-1',
  project_ref: 'PRJ-1',
  po_id: 'po-1',
};

/**
 * A receipt with TWO accepted lines — the case the matching screen must not
 * decide on its own. Line 1 (BAG) and line 2 (PCS) both hold accepted quantity.
 */
const RECEIPT_LINES = [
  {
    id: 'grnl-1',
    business_id: BUSINESS_ID,
    grn_id: 'grn-1',
    line_number: 1,
    po_line_id: 'pol-1',
    product_id: 'prod-cement',
    uom: 'BAG',
    quantity_received: 10,
    quantity_accepted: 10,
    quantity_rejected: 0,
    quantity_quarantined: 0,
    quantity_disputed: 0,
    received_base: 10,
    accepted_base: 10,
    rejected_base: 0,
    quarantined_base: 0,
    disputed_base: 0,
  },
  {
    id: 'grnl-2',
    business_id: BUSINESS_ID,
    grn_id: 'grn-1',
    line_number: 2,
    po_line_id: 'pol-2',
    product_id: 'prod-nails',
    uom: 'PCS',
    quantity_received: 200,
    quantity_accepted: 200,
    quantity_rejected: 0,
    quantity_quarantined: 0,
    quantity_disputed: 0,
    received_base: 200,
    accepted_base: 200,
    rejected_base: 0,
    quarantined_base: 0,
    disputed_base: 0,
  },
];

const BILL = {
  id: 'bill-1',
  business_id: BUSINESS_ID,
  expense_number: 'EXP-0001',
  expense_type: 'bill',
  contact_id: SUPPLIER_ID,
  reference: 'INV 001/2026',
  currency: 'MWK',
  expense_date: '2026-10-16',
  deleted_at: null,
};

const BILL_LINES = [
  {
    id: 'bl-1',
    business_id: BUSINESS_ID,
    expense_id: 'bill-1',
    line_number: 1,
    description: 'Cement 50kg',
    product_id: 'prod-cement',
    quantity: 10,
    unit_price: 900,
    tax_code: 'none',
  },
  {
    id: 'bl-2',
    business_id: BUSINESS_ID,
    expense_id: 'bill-1',
    line_number: 2,
    description: 'Roofing nails',
    product_id: 'prod-nails',
    quantity: 200,
    unit_price: 12,
    tax_code: 'none',
  },
];

/** The bill reference is registered, which is what matching depends on. */
const REGISTRATION = {
  id: 'reg-1',
  business_id: BUSINESS_ID,
  supplier_contact_id: SUPPLIER_ID,
  expense_id: 'bill-1',
  reference_raw: 'INV 001/2026',
  reference_normalized: 'INV 001/2026',
  source: 'expense_reference',
  status: 'active' as const,
  exception_of: null,
  exception_reason: null,
  recorded_by: 'user-9',
  recorded_at: '2026-10-16T08:00:00Z',
};

function renderWorkspace(entry = '/construction/bill-matching') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<ConstructionWorkspacePage />, { wrapper: Wrapper });
}

beforeEach(() => {
  void i18n.changeLanguage('en');
  Object.values(construction).forEach((mock) => mock.mockReset());
  construction.findCapabilities.mockResolvedValue(['procurement.bill.match']);
  construction.findSites.mockResolvedValue([{ id: 'site-1', site_code: 'SITE-1' }]);
  construction.findReceipts.mockResolvedValue([RECEIPT]);
  construction.findReceiptLines.mockResolvedValue(RECEIPT_LINES);
  construction.findSupplierBillLines.mockResolvedValue(BILL_LINES);
  construction.findSupplierInvoiceReferences.mockResolvedValue([REGISTRATION]);
  construction.findAllocationsForBusiness.mockResolvedValue([]);
  contactList.value = [{ id: SUPPLIER_ID, name: 'Supplier A', contact_type: 'supplier', is_active: true }];
  productList.value = [
    { id: 'prod-cement', name: 'Cement 50kg', unit_of_measure: 'BAG' },
    { id: 'prod-nails', name: 'Roofing nails', unit_of_measure: 'PCS' },
  ];
  billList.value = [BILL];
  useAppStore.setState({
    currentUser: { id: 'user-1', email: 'owner@example.com' },
    currentBusiness: { role: 'owner', business: { id: BUSINESS_ID, name: 'Business A', base_currency: 'MWK' } } as never,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Fills the matching form but leaves the receipt line alone. */
async function fillMatchForm() {
  const form = await screen.findByRole('form', { name: /Match a supplier bill line to a receipt line/i });
  fireEvent.change(within(form).getByLabelText('Goods receipt'), { target: { value: 'grn-1' } });
  await screen.findByLabelText('Supplier bill');
  fireEvent.change(within(form).getByLabelText('Supplier bill'), { target: { value: 'bill-1' } });
  fireEvent.change(within(form).getByLabelText('Bill line'), { target: { value: 'bl-1' } });
  fireEvent.change(within(form).getByLabelText('Bill unit'), { target: { value: 'BAG' } });
  fireEvent.change(within(form).getByLabelText('Bill quantity'), { target: { value: '10' } });
  fireEvent.change(within(form).getByLabelText('Receipt quantity'), { target: { value: '10' } });
  return form;
}

describe('Construction workspace — supplier bill matching', () => {
  it('submits the match command when the operator presses the primary action', async () => {
    construction.matchBillLineToReceipt.mockResolvedValue({ id: 'alloc-1', idempotent: false, is_exception: false });

    renderWorkspace();
    const form = await fillMatchForm();
    fireEvent.change(within(form).getByLabelText('Receipt line'), { target: { value: 'grnl-1' } });
    const submit = within(form).getByRole('button', { name: /Match bill line to the receipt/i }) as HTMLButtonElement;

    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    // A click must reach the command. (The control is inside the form, so it has
    // to actually submit it — a control that renders as type="button" with no
    // handler produces a button that does nothing at all.)
    await waitFor(() => expect(construction.matchBillLineToReceipt).toHaveBeenCalledTimes(1));
    const [payload] = construction.matchBillLineToReceipt.mock.calls[0];
    expect(payload).toMatchObject({
      business_id: BUSINESS_ID,
      expense_line_id: 'bl-1',
      bill_uom: 'BAG',
      bill_quantity: '10',
      receipt_quantity: '10',
      grn_line_id: 'grnl-1',
    });
    expect(await screen.findByText(/matched to the receipt line/i)).toBeTruthy();
  });

  it('lets the operator choose which receipt line is matched, and targets the chosen one', async () => {
    construction.matchBillLineToReceipt.mockResolvedValue({ id: 'alloc-1', idempotent: false, is_exception: false });

    renderWorkspace();
    const form = await fillMatchForm();

    // With two accepted lines the target is a decision, not a default: the screen
    // offers both and names the product, not just a line number.
    const linePicker = within(form).getByLabelText('Receipt line') as HTMLSelectElement;
    const offered = Array.from(linePicker.options).map((option) => option.textContent ?? '');
    expect(offered.some((label) => label.includes('Cement 50kg'))).toBe(true);
    expect(offered.some((label) => label.includes('Roofing nails'))).toBe(true);
    // The quantity shown is the accepted BASE quantity — not the unit the line was
    // recorded in, which the conversion rules may differ from.
    expect(offered.filter((label) => label.includes('base units accepted'))).toHaveLength(2);

    fireEvent.change(linePicker, { target: { value: 'grnl-2' } });
    fireEvent.click(within(form).getByRole('button', { name: /Match bill line to the receipt/i }));

    await waitFor(() => expect(construction.matchBillLineToReceipt).toHaveBeenCalledTimes(1));
    const [payload] = construction.matchBillLineToReceipt.mock.calls[0];
    // The second line, not the first one the query happened to return.
    expect(payload.grn_line_id).toBe('grnl-2');
  });

  it('shows a refusal with its documented explanation and never reports success', async () => {
    construction.matchBillLineToReceipt.mockRejectedValue(
      new ConstructionCommandError({ message: 'product-mismatch: the bill line product is not the product on the receipt line', code: '22023' }, 'refused'),
    );

    renderWorkspace();
    const form = await fillMatchForm();
    fireEvent.change(within(form).getByLabelText('Receipt line'), { target: { value: 'grnl-1' } });
    fireEvent.click(within(form).getByRole('button', { name: /Match bill line to the receipt/i }));

    // The token appears twice by design: inside the server's message and again as
    // the named refusal. Both are the server's own wording.
    expect((await screen.findAllByText(/product-mismatch/)).length).toBeGreaterThan(0);
    // The documented next step is shown beside the server's own wording.
    expect((await screen.findAllByText(/same product/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/matched to the receipt line/i)).toBeNull();
  });

  it('disables the action with a reason until the target and both quantities are chosen', async () => {
    renderWorkspace();
    const form = await screen.findByRole('form', { name: /Match a supplier bill line to a receipt line/i });

    const submit = within(form).getByRole('button', { name: /Match bill line to the receipt/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toMatch(/choose a receipt/i);
    expect(construction.matchBillLineToReceipt).not.toHaveBeenCalled();
  });

  it('selects the only accepted line on a single-line receipt, so the common case stays one click', async () => {
    construction.findReceiptLines.mockResolvedValue([RECEIPT_LINES[0]]);
    construction.matchBillLineToReceipt.mockResolvedValue({ id: 'alloc-1', idempotent: false, is_exception: false });

    renderWorkspace();
    const form = await fillMatchForm();
    // No explicit choice is needed: there is nothing to choose between.
    const linePicker = within(form).getByLabelText('Receipt line') as HTMLSelectElement;
    expect(linePicker.value).toBe('grnl-1');

    fireEvent.click(within(form).getByRole('button', { name: /Match bill line to the receipt/i }));
    await waitFor(() => expect(construction.matchBillLineToReceipt).toHaveBeenCalledTimes(1));
    expect(construction.matchBillLineToReceipt.mock.calls[0][0].grn_line_id).toBe('grnl-1');
  });

  it('says why the action is unavailable when the receipt has nothing accepted', async () => {
    construction.findReceiptLines.mockResolvedValue([
      { ...RECEIPT_LINES[0], quantity_accepted: 0, accepted_base: 0 },
    ]);

    renderWorkspace();
    const form = await fillMatchForm();

    const submit = within(form).getByRole('button', { name: /Match bill line to the receipt/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toMatch(/nothing accepted yet|no accepted quantity/i);
    expect(within(form).getByText(/nothing accepted yet/i)).toBeTruthy();
  });
});
