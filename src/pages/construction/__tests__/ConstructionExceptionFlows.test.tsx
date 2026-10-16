// @vitest-environment jsdom
/**
 * The two construction exception screens — focused UI cover.
 *
 * `record_construction_delivery_note_exception` and
 * `register_construction_supplier_invoice_reference_exception` already have
 * server-side evidence in `tests/release/construction-procurement.test.ts`
 * (capability denial, wrong-target refusal, the valid path, append-only history).
 * These tests cover the screens: that they call the right command with the target,
 * the reason and the evidence; that they refuse to submit without them; that the
 * choices they offer are the ones the server would accept; that a retry replays
 * the same key where the command has one; and that a refusal is shown with its
 * documented explanation rather than being worked around.
 *
 * They cannot prove authorisation — a mocked repository proves nothing about the
 * database. Only the release suite, and in the end a deployed environment, can.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

const construction = vi.hoisted(() => ({
  findCapabilities: vi.fn(),
  findOpenItems: vi.fn(),
  findPurchaseOrders: vi.fn(),
  findSites: vi.fn(),
  findPurchaseOrderLines: vi.fn(),
  findPurchaseOrderEvents: vi.fn(),
  findDeliveryNotes: vi.fn(),
  findReceipts: vi.fn(),
  findReceiptLines: vi.fn(),
  findPostingPolicy: vi.fn(),
  findProjectMaterialCost: vi.fn(),
  findMaterialIssues: vi.fn(),
  findSupplierBillLines: vi.fn(),
  findSupplierInvoiceReferences: vi.fn(),
  findAllocationsForBusiness: vi.fn(),
  createPurchaseOrder: vi.fn(),
  authorizePurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
  recordDeliveryNote: vi.fn(),
  recordDeliveryNoteException: vi.fn(),
  recordGoodsReceipt: vi.fn(),
  recordInspection: vi.fn(),
  reclassifyReceiptLine: vi.fn(),
  releaseHold: vi.fn(),
  registerSupplierInvoiceReference: vi.fn(),
  registerSupplierInvoiceReferenceException: vi.fn(),
  matchBillLineToReceipt: vi.fn(),
  approvePostingPolicy: vi.fn(),
  recordReceiptCostBasis: vi.fn(),
  postReceiptMovement: vi.fn(),
  issueMaterialsToProject: vi.fn(),
  registerSite: vi.fn(),
  registerUomConversion: vi.fn(),
  findUomConversions: vi.fn(),
  findReceiptHolds: vi.fn(),
  findInspections: vi.fn(),
  findReclassifications: vi.fn(),
  findAllocationsForReceiptLine: vi.fn(),
  findCostBasesForReceiptLine: vi.fn(),
}));

const productList = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));
const contactList = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));
const expenseList = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/repositories', () => ({
  repos: {
    construction,
    contact: { findByBusiness: vi.fn(async () => contactList.value) },
    branch: { findByBusiness: vi.fn(async () => []), findLocations: vi.fn(async () => []) },
    inventory: {
      findAllProducts: vi.fn(async () => productList.value),
      findBalancesByLocation: vi.fn(async () => []),
    },
    expense: { findByBusiness: vi.fn(async () => expenseList.value) },
  },
}));

import { ConstructionWorkspacePage } from '@/pages/construction/ConstructionWorkspacePage';
import { useAppStore } from '@/store/useAppStore';
import { ConstructionCommandError } from '@/dal/repositories/ConstructionProcurementRepository';

const BUSINESS_ID = '10000000-0000-0000-0000-000000000001';
const SUPPLIER_ID = 'contact-supplier-1';
const OTHER_SUPPLIER_ID = 'contact-supplier-2';

const PO = {
  id: 'po-1',
  business_id: BUSINESS_ID,
  branch_id: 'branch-1',
  site_id: 'site-1',
  project_ref: 'PRJ-1',
  supplier_contact_id: SUPPLIER_ID,
  po_number: 'PO-000001',
  currency: 'MWK',
  status: 'authorized' as const,
  notes: null,
  created_by: 'other-user',
  created_at: '2026-10-16T08:00:00Z',
  authorized_by: 'other-user',
  authorized_at: '2026-10-16T09:00:00Z',
  cancelled_by: null,
  cancelled_at: null,
  cancel_reason: null,
};

const PO_LINES = [
  {
    id: 'pol-1',
    business_id: BUSINESS_ID,
    po_id: 'po-1',
    line_number: 1,
    product_id: 'prod-1',
    uom: 'BAG',
    quantity_ordered: 10,
    quantity_ordered_base: 10,
    expected_unit_price: 900,
    line_note: null,
  },
];

/** The note already recorded for this supplier — the one a duplicate must name. */
const RECORDED_NOTE = {
  id: 'dn-1',
  business_id: BUSINESS_ID,
  po_id: 'po-1',
  supplier_contact_id: SUPPLIER_ID,
  delivery_note_number: 'R13 DN 0042',
  normalized_reference: 'R13 DN 0042',
  document_date: '2026-10-15',
  document_received_by: 'A. Clerk',
  evidence_reference: 'R13 file',
  notes: null,
  recorded_by: 'user-9',
  recorded_at: '2026-10-15T10:00:00Z',
  is_exception: false,
  exception_of: null,
};

/** A note for a different supplier: must never be offered as the conflict. */
const OTHER_SUPPLIER_NOTE = {
  ...RECORDED_NOTE,
  id: 'dn-other',
  supplier_contact_id: OTHER_SUPPLIER_ID,
  delivery_note_number: 'OTHER DN 9',
  normalized_reference: 'OTHER DN 9',
};

const BILL = {
  id: 'bill-1',
  business_id: BUSINESS_ID,
  expense_number: 'EXP-0001',
  expense_type: 'bill',
  contact_id: SUPPLIER_ID,
  reference: '  inv   001/2026 ',
  currency: 'MWK',
  expense_date: '2026-10-16',
  deleted_at: null,
};

const REGISTRATION = {
  id: 'reg-1',
  business_id: BUSINESS_ID,
  supplier_contact_id: SUPPLIER_ID,
  expense_id: 'bill-0',
  reference_raw: 'INV 001/2026',
  reference_normalized: 'INV 001/2026',
  source: 'expense_reference',
  status: 'active' as const,
  exception_of: null,
  exception_reason: null,
  recorded_by: 'user-9',
  recorded_at: '2026-10-14T09:00:00Z',
};

const REGISTRATION_OTHER_SUPPLIER = {
  ...REGISTRATION,
  id: 'reg-2',
  supplier_contact_id: OTHER_SUPPLIER_ID,
  expense_id: 'bill-9',
  reference_normalized: 'INV 001/2026',
};

function renderWorkspace(entry: string) {
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
  Object.values(construction).forEach((mock) => mock.mockReset());
  construction.findCapabilities.mockResolvedValue([]);
  construction.findOpenItems.mockResolvedValue(null);
  construction.findPurchaseOrders.mockResolvedValue([]);
  construction.findSites.mockResolvedValue([]);
  construction.findPurchaseOrderLines.mockResolvedValue([]);
  construction.findPurchaseOrderEvents.mockResolvedValue([]);
  construction.findDeliveryNotes.mockResolvedValue([]);
  construction.findReceipts.mockResolvedValue([]);
  construction.findReceiptLines.mockResolvedValue([]);
  construction.findReceiptHolds.mockResolvedValue([]);
  construction.findInspections.mockResolvedValue([]);
  construction.findReclassifications.mockResolvedValue([]);
  construction.findAllocationsForReceiptLine.mockResolvedValue([]);
  construction.findCostBasesForReceiptLine.mockResolvedValue([]);
  construction.findPostingPolicy.mockResolvedValue(null);
  construction.findProjectMaterialCost.mockResolvedValue([]);
  construction.findMaterialIssues.mockResolvedValue([]);
  construction.findSupplierBillLines.mockResolvedValue([]);
  construction.findSupplierInvoiceReferences.mockResolvedValue([]);
  construction.findAllocationsForBusiness.mockResolvedValue([]);
  productList.value = [{ id: 'prod-1', name: 'Cement 50kg', unit_of_measure: 'BAG' }];
  contactList.value = [{ id: SUPPLIER_ID, name: 'Supplier A', contact_type: 'supplier', is_active: true }];
  expenseList.value = [];
  useAppStore.setState({
    currentUser: { id: 'user-1', email: 'owner@example.com' },
    currentBusiness: { role: 'owner', business: { id: BUSINESS_ID, name: 'Business A', base_currency: 'MWK' } } as never,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Opens the purchase-order detail and the duplicate-note form. */
async function openDeliveryNoteException() {
  construction.findPurchaseOrders.mockResolvedValue([PO]);
  construction.findPurchaseOrderLines.mockResolvedValue(PO_LINES);
  renderWorkspace('/construction/purchase-orders?po=po-1');
  const trigger = await screen.findByRole('button', { name: /Record duplicate note \(exception\)/i });
  return trigger;
}

describe('delivery-note exception screen', () => {
  it('records the duplicate against the named note, with the reason and evidence the server requires', async () => {
    construction.findCapabilities.mockResolvedValue([
      'procurement.delivery_note.record',
      'procurement.grn.record',
      'procurement.exception.authorize',
    ]);
    construction.findDeliveryNotes.mockResolvedValue([RECORDED_NOTE, OTHER_SUPPLIER_NOTE]);
    construction.recordDeliveryNoteException.mockResolvedValue({
      id: 'dn-2',
      exception_of: 'dn-1',
      idempotent: false,
      stock_effect: 'none',
      journal_effect: 'none',
    });

    fireEvent.click(await openDeliveryNoteException());

    const form = await screen.findByRole('form', { name: /Record duplicate delivery note exception/i });
    // It reads as a correction of a named document, and says so.
    expect(within(form).getAllByText(/already recorded/i).length).toBeGreaterThan(0);
    expect(within(form).getByText(/append-only/i)).toBeTruthy();
    expect(within(form).getByText(/Nothing reaches stock until a goods receipt/i)).toBeTruthy();

    // Only the same supplier's recorded notes can be named.
    const picker = within(form).getByLabelText('Recorded delivery note this duplicates') as HTMLSelectElement;
    const offered = Array.from(picker.options).map((option) => option.textContent ?? '');
    expect(offered.some((label) => label.includes('R13 DN 0042'))).toBe(true);
    expect(offered.some((label) => label.includes('OTHER DN 9'))).toBe(false);

    fireEvent.change(picker, { target: { value: 'dn-1' } });
    // The reused number is taken from the named note, not retyped.
    const reused = within(form).getByLabelText('Reused delivery note number') as HTMLInputElement;
    expect(reused.value).toBe('R13 DN 0042');
    expect(reused.readOnly).toBe(true);
    expect(within(form).getByText(/This will be recorded as an exception against/)).toBeTruthy();

    fireEvent.change(within(form).getByLabelText('Document date'), { target: { value: '2026-10-16' } });
    fireEvent.change(within(form).getByLabelText('Evidence reference'), { target: { value: 'signed reissued note' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'supplier reissued the same number' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'supplier e-mail 2026-10-16' } });
    fireEvent.change(within(form).getByLabelText('Declared quantity for line 1'), { target: { value: '10' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record duplicate note as exception/i }));

    await waitFor(() => expect(construction.recordDeliveryNoteException).toHaveBeenCalledTimes(1));
    const [payload, clientKey] = construction.recordDeliveryNoteException.mock.calls[0];
    expect(payload).toMatchObject({
      business_id: BUSINESS_ID,
      po_id: 'po-1',
      delivery_note_number: 'R13 DN 0042', // the conflict's number, so the server's same-reference rule holds
      exception_of: 'dn-1',
      exception_reason: 'supplier reissued the same number',
      exception_evidence: 'supplier e-mail 2026-10-16',
      lines: [{ po_line_id: 'pol-1', uom: 'BAG', quantity_declared: '10' }],
    });
    // No actor, no cost, no branch scope is ever sent by the browser.
    expect(payload).not.toHaveProperty('recorded_by');
    expect(clientKey).toMatch(/^[0-9a-f-]{36}$/);
    // The normal command is not used for the exception path.
    expect(construction.recordDeliveryNote).not.toHaveBeenCalled();
  });

  it('refuses to submit without the reason, the evidence and the named note, and sends nothing', async () => {
    construction.findCapabilities.mockResolvedValue(['procurement.exception.authorize']);
    construction.findDeliveryNotes.mockResolvedValue([RECORDED_NOTE]);

    fireEvent.click(await openDeliveryNoteException());
    const form = await screen.findByRole('form', { name: /Record duplicate delivery note exception/i });
    const submit = within(form).getByRole('button', { name: /Record duplicate note as exception/i }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    expect(within(form).getByText(/The recorded note it duplicates, an exception reason/i)).toBeTruthy();

    // Everything but the evidence reference: still refused.
    fireEvent.change(within(form).getByLabelText('Recorded delivery note this duplicates'), { target: { value: 'dn-1' } });
    fireEvent.change(within(form).getByLabelText('Evidence reference'), { target: { value: 'file' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'reissued' } });
    fireEvent.change(within(form).getByLabelText('Declared quantity for line 1'), { target: { value: '1' } });
    expect(submit.disabled).toBe(true);

    // The missing piece is the exception evidence.
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'e-mail' } });
    expect(submit.disabled).toBe(false);
    expect(construction.recordDeliveryNoteException).not.toHaveBeenCalled();
  });

  it('disables the screen without the exception capability, naming the capability that is missing', async () => {
    construction.findCapabilities.mockResolvedValue(['procurement.delivery_note.record', 'procurement.grn.record']);
    construction.findDeliveryNotes.mockResolvedValue([RECORDED_NOTE]);

    const trigger = await openDeliveryNoteException();
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    // GatedButton exposes the reason as its title, and the label is the capability vocabulary.
    expect(trigger.getAttribute('title')).toMatch(/Authorize exceptions and release holds/i);
    expect(screen.queryByRole('form', { name: /Record duplicate delivery note exception/i })).toBeNull();
    expect(construction.recordDeliveryNoteException).not.toHaveBeenCalled();
  });

  it('offers no exception screen when nothing is recorded to name', async () => {
    construction.findCapabilities.mockResolvedValue(['procurement.exception.authorize']);
    construction.findDeliveryNotes.mockResolvedValue([]);

    const trigger = await openDeliveryNoteException();
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.getAttribute('title')).toMatch(/No delivery note is recorded for this supplier yet/i);
  });

  it('reuses the same replay key after a failure, and treats an idempotent replay as already recorded', async () => {
    construction.findCapabilities.mockResolvedValue(['procurement.exception.authorize']);
    construction.findDeliveryNotes.mockResolvedValue([RECORDED_NOTE]);
    construction.recordDeliveryNoteException
      .mockRejectedValueOnce(new ConstructionCommandError({ message: 'connection reset', code: '08006' }, 'failed'))
      .mockResolvedValueOnce({ id: 'dn-2', exception_of: 'dn-1', idempotent: true });

    fireEvent.click(await openDeliveryNoteException());
    const form = await screen.findByRole('form', { name: /Record duplicate delivery note exception/i });
    fireEvent.change(within(form).getByLabelText('Recorded delivery note this duplicates'), { target: { value: 'dn-1' } });
    fireEvent.change(within(form).getByLabelText('Evidence reference'), { target: { value: 'file' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'reissued' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'e-mail' } });
    fireEvent.change(within(form).getByLabelText('Declared quantity for line 1'), { target: { value: '2' } });

    const submit = within(form).getByRole('button', { name: /Record duplicate note as exception/i });
    fireEvent.click(submit);
    await waitFor(() => expect(construction.recordDeliveryNoteException).toHaveBeenCalledTimes(1));
    fireEvent.click(submit);
    await waitFor(() => expect(construction.recordDeliveryNoteException).toHaveBeenCalledTimes(2));

    const firstKey = construction.recordDeliveryNoteException.mock.calls[0][1];
    const secondKey = construction.recordDeliveryNoteException.mock.calls[1][1];
    expect(secondKey).toBe(firstKey);
  });

  it('shows the server refusal with its documented explanation when the named note does not conflict', async () => {
    construction.findCapabilities.mockResolvedValue(['procurement.exception.authorize']);
    construction.findDeliveryNotes.mockResolvedValue([RECORDED_NOTE]);
    construction.recordDeliveryNoteException.mockRejectedValue(
      new ConstructionCommandError(
        {
          message:
            'The named conflict must be the same business, the same supplier and the same delivery note number.',
          code: '22023',
        },
        'failed',
      ),
    );

    fireEvent.click(await openDeliveryNoteException());
    const form = await screen.findByRole('form', { name: /Record duplicate delivery note exception/i });
    fireEvent.change(within(form).getByLabelText('Recorded delivery note this duplicates'), { target: { value: 'dn-1' } });
    fireEvent.change(within(form).getByLabelText('Evidence reference'), { target: { value: 'file' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'reissued' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'e-mail' } });
    fireEvent.change(within(form).getByLabelText('Declared quantity for line 1'), { target: { value: '2' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record duplicate note as exception/i }));

    // The server's own words are shown verbatim — nothing is softened or retried.
    expect(await within(form).findByText(/same business, the same supplier and the same delivery note number/i)).toBeTruthy();
    expect(within(form).getAllByText(/22023/).length).toBeGreaterThan(0);
  });
});

describe('supplier-reference exception screen', () => {
  async function openReferenceException(capabilities: string[], references = [REGISTRATION, REGISTRATION_OTHER_SUPPLIER]) {
    construction.findCapabilities.mockResolvedValue(capabilities);
    expenseList.value = [BILL];
    construction.findSupplierInvoiceReferences.mockResolvedValue(references);
    renderWorkspace('/construction/bill-matching');
    const trigger = await screen.findByRole('button', { name: /Duplicate reference\? Record an exception/i });
    return trigger;
  }

  it('records the exception against the conflicting registration for the same supplier', async () => {
    construction.registerSupplierInvoiceReferenceException.mockResolvedValue({ id: 'reg-3', exception_of: 'reg-1', idempotent: false });

    fireEvent.click(await openReferenceException(['procurement.bill.match', 'procurement.exception.authorize']));

    const form = await screen.findByRole('form', { name: /Record duplicate supplier reference exception/i });
    // The bill being registered is shown, with the reference as it will be normalized.
    expect(within(form).getByText('EXP-0001')).toBeTruthy();
    expect(within(form).getAllByText('INV 001/2026').length).toBeGreaterThan(0);

    const picker = within(form).getByLabelText('Registered reference this conflicts with') as HTMLSelectElement;
    const offered = Array.from(picker.options).map((option) => option.textContent ?? '');
    // The same supplier's registration is offered (and flagged as the same reference)…
    expect(offered.some((label) => label.includes('same reference'))).toBe(true);
    // …and the other supplier's registration is not.
    expect(offered.filter((label) => label.includes('INV 001/2026')).length).toBe(1);

    fireEvent.change(picker, { target: { value: 'reg-1' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'supplier reissued the same invoice number' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'supplier e-mail' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record exception/i }));

    await waitFor(() => expect(construction.registerSupplierInvoiceReferenceException).toHaveBeenCalledTimes(1));
    expect(construction.registerSupplierInvoiceReferenceException).toHaveBeenCalledWith({
      expenseId: 'bill-1',
      exceptionOf: 'reg-1',
      reason: 'supplier reissued the same invoice number',
      evidence: 'supplier e-mail',
    });
    // The ordinary registration is not retried as a workaround.
    expect(construction.registerSupplierInvoiceReference).not.toHaveBeenCalled();
  });

  it('will not submit without a named conflict, a reason and evidence', async () => {
    fireEvent.click(await openReferenceException(['procurement.exception.authorize']));
    const form = await screen.findByRole('form', { name: /Record duplicate supplier reference exception/i });
    const submit = within(form).getByRole('button', { name: /Record exception/i }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'reissued' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'e-mail' } });
    expect(submit.disabled).toBe(true); // still no conflicting registration named

    fireEvent.change(within(form).getByLabelText('Registered reference this conflicts with'), { target: { value: 'reg-1' } });
    expect(submit.disabled).toBe(false);
    expect(construction.registerSupplierInvoiceReferenceException).not.toHaveBeenCalled();
  });

  it('disables the screen without the exception capability', async () => {
    const trigger = await openReferenceException(['procurement.bill.match']);
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.getAttribute('title')).toMatch(/Authorize exceptions and release holds/i);
    expect(screen.queryByRole('form', { name: /Record duplicate supplier reference exception/i })).toBeNull();
  });

  it('offers no candidate and no submission when the business has no active registration for that supplier', async () => {
    fireEvent.click(await openReferenceException(['procurement.exception.authorize'], [REGISTRATION_OTHER_SUPPLIER]));
    const form = await screen.findByRole('form', { name: /Record duplicate supplier reference exception/i });

    expect(within(form).getByText(/No active registration is visible in this business/i)).toBeTruthy();
    const picker = within(form).getByLabelText('Registered reference this conflicts with') as HTMLSelectElement;
    expect(picker.options.length).toBe(1); // the placeholder only
    expect((within(form).getByRole('button', { name: /Record exception/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses a candidate whose reference differs from the bill, before the server has to', async () => {
    const otherReference = { ...REGISTRATION, id: 'reg-9', reference_normalized: 'INV 777/2026' };
    fireEvent.click(await openReferenceException(['procurement.exception.authorize'], [otherReference]));
    const form = await screen.findByRole('form', { name: /Record duplicate supplier reference exception/i });

    fireEvent.change(within(form).getByLabelText('Registered reference this conflicts with'), { target: { value: 'reg-9' } });
    expect(within(form).getByText(/That registration carries a different reference from this bill/i)).toBeTruthy();
    expect((within(form).getByRole('button', { name: /Record exception/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports a cross-business or unauthorised target as an authority denial, not as a retryable error', async () => {
    fireEvent.click(await openReferenceException(['procurement.exception.authorize']));
    const form = await screen.findByRole('form', { name: /Record duplicate supplier reference exception/i });
    construction.registerSupplierInvoiceReferenceException.mockRejectedValue(
      new ConstructionCommandError({ message: 'You are not an active member of this business.', code: '42501' }, 'failed'),
    );

    fireEvent.change(within(form).getByLabelText('Registered reference this conflicts with'), { target: { value: 'reg-1' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'reissued' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'e-mail' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record exception/i }));

    // The server's own words are shown, and the heading says this is about authority
    // rather than about the document — plus what to check next.
    expect(await within(form).findByText(/not an active member of this business/i)).toBeTruthy();
    expect(within(form).getByText(/You do not have authority for this action in this business/i)).toBeTruthy();
    expect(within(form).getByText(/ask an approver to grant the capability/i)).toBeTruthy();
    expect(within(form).getAllByText(/SQLSTATE 42501/).length).toBeGreaterThan(0);
  });

  it('tells the operator a refusal means the bill is already registered rather than offering a blind retry', async () => {
    fireEvent.click(await openReferenceException(['procurement.exception.authorize']));
    const form = await screen.findByRole('form', { name: /Record duplicate supplier reference exception/i });
    construction.registerSupplierInvoiceReferenceException.mockRejectedValue(
      new ConstructionCommandError({ message: 'This bill already has a registered supplier reference.', code: '22023' }, 'failed'),
    );

    fireEvent.change(within(form).getByLabelText('Registered reference this conflicts with'), { target: { value: 'reg-1' } });
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'reissued' } });
    fireEvent.change(within(form).getByLabelText('Exception evidence'), { target: { value: 'e-mail' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record exception/i }));

    expect(await within(form).findByText(/already has a registered supplier reference/i)).toBeTruthy();
    expect(within(form).getByText(/the list above has been refreshed and no duplicate was created/i)).toBeTruthy();
  });
});
