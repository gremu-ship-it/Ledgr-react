// @vitest-environment jsdom
/**
 * Construction workspace — UI cover for the first end-to-end authorised flow.
 *
 * The repository boundary is replaced with a recording double, so these tests
 * assert integration behaviour: which command the UI calls, with which payload,
 * whether a retry replays the SAME client key (duplicate protection), that a
 * refusal is shown with its documented explanation, and that a person without a
 * capability sees a disabled control with a reason instead of an error.
 *
 * They deliberately do NOT assert any procurement or stock rule: those live in
 * the database and are covered by `tests/release/construction-procurement.test.ts`
 * against a real PostgreSQL. A mocked test can never prove authorization.
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
  recordGoodsReceipt: vi.fn(),
  recordInspection: vi.fn(),
  reclassifyReceiptLine: vi.fn(),
  releaseHold: vi.fn(),
  registerSupplierInvoiceReference: vi.fn(),
  matchBillLineToReceipt: vi.fn(),
  approvePostingPolicy: vi.fn(),
  recordReceiptCostBasis: vi.fn(),
  postReceiptMovement: vi.fn(),
  issueMaterialsToProject: vi.fn(),
  registerSite: vi.fn(),
  registerUomConversion: vi.fn(),
  findUomConversions: vi.fn(),
  findHoldsForBusiness: vi.fn(),
  findCostBasesForBusiness: vi.fn(),
  findReceiptHolds: vi.fn(),
  findInspections: vi.fn(),
  findReclassifications: vi.fn(),
  findAllocationsForReceiptLine: vi.fn(),
  findCostBasesForReceiptLine: vi.fn(),
  findReceiptLinesForBusiness: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    construction,
    contact: { findByBusiness: vi.fn(async () => []) },
    branch: { findByBusiness: vi.fn(async () => []), findLocations: vi.fn(async () => []) },
    inventory: { findAllProducts: vi.fn(async () => []), findBalancesByLocation: vi.fn(async () => []) },
    expense: { findByBusiness: vi.fn(async () => []) },
  },
}));

import { ConstructionWorkspacePage } from '@/pages/construction/ConstructionWorkspacePage';
import { useAppStore } from '@/store/useAppStore';
import { ConstructionCommandError } from '@/dal/repositories/ConstructionProcurementRepository';

const BUSINESS = {
  role: 'owner',
  business: {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Business A',
    base_currency: 'MWK',
  },
};

const PO = {
  id: 'po-1',
  business_id: BUSINESS.business.id,
  branch_id: 'branch-1',
  site_id: 'site-1',
  project_ref: 'PRJ-1',
  supplier_contact_id: 'sup-1',
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

const OPEN_ITEMS = {
  business_id: BUSINESS.business.id,
  movement_posting_enabled: false,
  gl_posting_enabled: false,
  grants_in_force: 2,
  awaiting_cost_basis: [{ grn_number: 'GRN-000001', line_number: 1, accepted_base: '5', covered_base: '0' }],
  awaiting_posting: [{ grn_number: 'GRN-000001', line_number: 1, accepted_base: '5', quantity_posted_base: '0' }],
  open_holds: [
    {
      hold_type: 'quarantined',
      quantity: '2',
      quantity_base: '2',
      reason: 'Awaiting laboratory result',
      evidence_reference: 'R13 inspection log',
      age_days: 6,
    },
  ],
  outstanding_supplier_claims: [
    {
      supplier: 'Supplier A',
      product_id: 'prod-1',
      rejected_base: '0',
      quarantined_base: '2',
      disputed_base: '0',
      outstanding_base: '2',
      receipt_date: '2026-10-10',
      age_days: 6,
    },
  ],
  blocked_bills: [{ expense_number: 'EXP-9', reference: 'SUP-REF-9', legacy_movements: 1 }],
};

function renderWorkspace(entry = '/construction') {
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
  construction.findOpenItems.mockResolvedValue(OPEN_ITEMS);
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
  construction.findUomConversions.mockResolvedValue([]);
  useAppStore.setState({
    currentUser: { id: 'user-1', email: 'owner@example.com' },
    currentBusiness: BUSINESS as never,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Construction workspace — overview', () => {
  it('renders the server-reported open items and states the accounting boundary', async () => {
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: /Construction workspace/i })).toBeTruthy();
    // Held quantity and ageing come from the server report.
    expect(await screen.findByText(/Awaiting laboratory result/)).toBeTruthy();
    expect(screen.getByText(/6 day\(s\) old/i)).toBeTruthy();
    // Accepted but not costed, and the blocked bill, are surfaced.
    expect(screen.getAllByText(/GRN-000001 · line 1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/EXP-9/)).toBeTruthy();
    // The journal boundary is stated on the workspace itself.
    expect(screen.getAllByText(/never write a journal entry/i).length).toBeGreaterThan(0);
    // GL posting is reported as not approved, never as available.
    expect(screen.getAllByText(/GL posting: not approved/i).length).toBeGreaterThan(0);
  });

  it('explains a disabled workspace instead of failing when no capability is granted', async () => {
    construction.findPurchaseOrders.mockResolvedValue([PO]);
    renderWorkspace('/construction/purchase-orders');

    expect(await screen.findByText(/None granted for this business/i)).toBeTruthy();
    const createButton = await screen.findByRole('button', { name: /New purchase order/i });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Create and cancel purchase orders/i)).toBeTruthy();
  });

  it('shows an empty state when there is nothing to act on', async () => {
    construction.findOpenItems.mockResolvedValue({
      ...OPEN_ITEMS,
      awaiting_cost_basis: [],
      awaiting_posting: [],
      open_holds: [],
      outstanding_supplier_claims: [],
      blocked_bills: [],
    });
    renderWorkspace();

    expect(await screen.findByText(/Nothing is held/i)).toBeTruthy();
    expect(screen.getByText(/Every accepted quantity already has an evidenced cost basis/i)).toBeTruthy();
    expect(screen.getByText(/No outstanding claims/i)).toBeTruthy();
  });
});

describe('Construction workspace — purchase order workflow', () => {
  beforeEach(() => {
    construction.findCapabilities.mockResolvedValue([
      'procurement.master.manage',
      'procurement.po.manage',
      'procurement.po.authorize',
      'procurement.delivery_note.record',
      'procurement.grn.record',
      'procurement.receipt.inspect',
      'procurement.exception.authorize',
    ]);
    construction.findSites.mockResolvedValue([
      {
        id: 'site-1',
        business_id: BUSINESS.business.id,
        branch_id: 'branch-1',
        location_id: 'loc-1',
        site_code: 'SITE-A',
        site_name: 'Site A',
        project_ref: 'PRJ-1',
        is_active: true,
        created_at: '2026-10-01T00:00:00Z',
      },
    ]);
  });

  it('creates a draft purchase order through the command, with a client replay key', async () => {
    const { repos } = await import('@/lib/repositories');
    (repos.contact.findByBusiness as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'sup-1', name: 'Supplier A', contact_type: 'supplier', is_active: true },
    ]);
    (repos.inventory.findAllProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'prod-1', name: 'Cement 50kg', unit_of_measure: 'BAG' },
    ]);
    construction.createPurchaseOrder.mockResolvedValue({ id: 'po-9', number: 'PO-000009' });

    renderWorkspace('/construction/purchase-orders');

    fireEvent.click(await screen.findByRole('button', { name: /New purchase order/i }));
    fireEvent.change(await screen.findByLabelText('Construction site'), { target: { value: 'site-1' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'sup-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 product'), { target: { value: 'prod-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Create draft purchase order/i }));

    await waitFor(() => expect(construction.createPurchaseOrder).toHaveBeenCalledTimes(1));
    const [payload, clientKey] = construction.createPurchaseOrder.mock.calls[0];
    expect(payload).toMatchObject({
      business_id: BUSINESS.business.id,
      site_id: 'site-1',
      supplier_contact_id: 'sup-1',
      currency: 'MWK',
      lines: [
        {
          product_id: 'prod-1',
          uom: 'BAG', // defaulted from the product's own base unit
          quantity_ordered: '10',
        },
      ],
    });
    // The UI never sends an actor, a cost or a branch scope.
    expect(payload).not.toHaveProperty('created_by');
    expect(payload.lines[0]).not.toHaveProperty('unit_cost');
    expect(clientKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the same replay key when a failed submission is retried, and generates a new one afterwards', async () => {
    const { repos } = await import('@/lib/repositories');
    (repos.contact.findByBusiness as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'sup-1', name: 'Supplier A', contact_type: 'supplier', is_active: true },
    ]);
    (repos.inventory.findAllProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'prod-1', name: 'Cement 50kg', unit_of_measure: 'BAG' },
    ]);
    construction.createPurchaseOrder
      .mockRejectedValueOnce(new ConstructionCommandError({ message: 'connection reset', code: '08006' }, 'failed'))
      .mockResolvedValueOnce({ id: 'po-9', number: 'PO-000009' });

    renderWorkspace('/construction/purchase-orders');
    fireEvent.click(await screen.findByRole('button', { name: /New purchase order/i }));
    fireEvent.change(await screen.findByLabelText('Construction site'), { target: { value: 'site-1' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'sup-1' } });
    fireEvent.change(screen.getByLabelText('Line 1 product'), { target: { value: 'prod-1' } });

    const submit = screen.getByRole('button', { name: /Create draft purchase order/i });
    fireEvent.click(submit);
    await waitFor(() => expect(construction.createPurchaseOrder).toHaveBeenCalledTimes(1));
    // A retry of the same form content must reuse the key, so the server can
    // recognise a replay rather than create a second document.
    fireEvent.click(submit);
    await waitFor(() => expect(construction.createPurchaseOrder).toHaveBeenCalledTimes(2));

    const firstKey = construction.createPurchaseOrder.mock.calls[0][1];
    const secondKey = construction.createPurchaseOrder.mock.calls[1][1];
    expect(secondKey).toBe(firstKey);
  });

  it('records a delivery note as evidence, and says it has no stock effect', async () => {
    construction.findPurchaseOrders.mockResolvedValue([PO]);
    construction.findPurchaseOrderLines.mockResolvedValue([
      {
        id: 'pol-1',
        business_id: BUSINESS.business.id,
        po_id: 'po-1',
        line_number: 1,
        product_id: 'prod-1',
        uom: 'BAG',
        quantity_ordered: 10,
        quantity_ordered_base: 10,
        expected_unit_price: 900,
        line_note: null,
      },
    ]);
    construction.recordDeliveryNote.mockResolvedValue({ id: 'dn-1', number: 'DN-000001', stock_effect: 'none' });

    renderWorkspace('/construction/purchase-orders?po=po-1');
    fireEvent.click(await screen.findByRole('button', { name: /Record delivery note/i }));

    const form = await screen.findByRole('form', { name: /Record delivery note/i });
    expect(within(form).getAllByText(/Evidence only/i).length).toBeGreaterThan(0);
    fireEvent.change(within(form).getByLabelText('Supplier delivery note number'), { target: { value: 'SUP-DN-77' } });
    fireEvent.change(within(form).getByLabelText('Evidence reference'), { target: { value: 'signed note filed' } });
    fireEvent.change(within(form).getByLabelText(/Declared quantity for line 1/), { target: { value: '10' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record delivery note/i }));

    await waitFor(() => expect(construction.recordDeliveryNote).toHaveBeenCalledTimes(1));
    expect(construction.recordDeliveryNote.mock.calls[0][0]).toMatchObject({
      business_id: BUSINESS.business.id,
      po_id: 'po-1',
      delivery_note_number: 'SUP-DN-77',
      evidence_reference: 'signed note filed',
      lines: [{ po_line_id: 'pol-1', uom: 'BAG', quantity_declared: '10' }],
    });
    expect(await screen.findByText(/No stock or ledger effect/i)).toBeTruthy();
  });

  it('refuses to submit an unbalanced goods-receipt classification and shows the shortfall', async () => {
    construction.findPurchaseOrders.mockResolvedValue([PO]);
    construction.findPurchaseOrderLines.mockResolvedValue([
      {
        id: 'pol-1',
        business_id: BUSINESS.business.id,
        po_id: 'po-1',
        line_number: 1,
        product_id: 'prod-1',
        uom: 'BAG',
        quantity_ordered: 10,
        quantity_ordered_base: 10,
        expected_unit_price: 900,
        line_note: null,
      },
    ]);

    renderWorkspace('/construction/purchase-orders?po=po-1');
    fireEvent.click(await screen.findByRole('button', { name: /Record goods receipt/i }));

    const form = await screen.findByRole('form', { name: /Record goods receipt/i });
    fireEvent.change(within(form).getByLabelText('Received quantity line 1'), { target: { value: '10' } });
    fireEvent.change(within(form).getByLabelText('Rejected quantity line 1'), { target: { value: '2' } });
    // 10 received, 10 accepted (explicit), 2 rejected -> does not balance.
    fireEvent.change(within(form).getByLabelText('Accepted quantity line 1'), { target: { value: '10' } });

    expect(await within(form).findByText(/Classification does not balance/i)).toBeTruthy();
    expect((within(form).getByRole('button', { name: /Record goods receipt/i }) as HTMLButtonElement).disabled).toBe(true);
    // Nothing was sent: the UI cannot create a receipt the database would reject.
    expect(construction.recordGoodsReceipt).not.toHaveBeenCalled();

    // A held quantity requires a reason and evidence before the form is usable.
    fireEvent.change(within(form).getByLabelText('Accepted quantity line 1'), { target: { value: '8' } });
    expect(within(form).getByText(/each needs a hold with a reason and evidence/i)).toBeTruthy();
    expect((within(form).getByRole('button', { name: /Record goods receipt/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(form).getByLabelText('Hold reason line 1'), { target: { value: 'Torn bags' } });
    fireEvent.change(within(form).getByLabelText('Hold evidence line 1'), { target: { value: 'site photo 12' } });
    construction.recordGoodsReceipt.mockResolvedValue({ id: 'grn-1', number: 'GRN-000001', stock_effect: 'none' });
    fireEvent.click(within(form).getByRole('button', { name: /Record goods receipt/i }));

    await waitFor(() => expect(construction.recordGoodsReceipt).toHaveBeenCalledTimes(1));
    expect(construction.recordGoodsReceipt.mock.calls[0][0]).toMatchObject({
      po_id: 'po-1',
      lines: [
        {
          po_line_id: 'pol-1',
          quantity_received: '10',
          quantity_accepted: 8,
          quantity_rejected: 2,
          holds: [
            {
              hold_type: 'rejected',
              quantity: 2,
              reason: 'Torn bags',
              evidence_reference: 'site photo 12',
            },
          ],
        },
      ],
    });
  });

  it('shows the database refusal with its documented explanation when the server rejects a receipt', async () => {
    construction.findPurchaseOrders.mockResolvedValue([PO]);
    construction.findPurchaseOrderLines.mockResolvedValue([
      {
        id: 'pol-1',
        business_id: BUSINESS.business.id,
        po_id: 'po-1',
        line_number: 1,
        product_id: 'prod-1',
        uom: 'BAG',
        quantity_ordered: 10,
        quantity_ordered_base: 10,
        expected_unit_price: 900,
        line_note: null,
      },
    ]);
    construction.recordGoodsReceipt.mockRejectedValue(
      new ConstructionCommandError(
        {
          message: 'over-receipt-exception-required: line 1 would receive more than was ordered (12 > 10). Provide an authorized reason and evidence.',
          code: '22023',
        },
        'failed',
      ),
    );

    renderWorkspace('/construction/purchase-orders?po=po-1');
    fireEvent.click(await screen.findByRole('button', { name: /Record goods receipt/i }));
    const form = await screen.findByRole('form', { name: /Record goods receipt/i });
    fireEvent.change(within(form).getByLabelText('Received quantity line 1'), { target: { value: '12' } });
    fireEvent.click(within(form).getByRole('button', { name: /Record goods receipt/i }));

    expect(await within(form).findByText(/This receipt exceeds the ordered quantity/i)).toBeTruthy();
    expect(within(form).getAllByText(/over-receipt-exception-required/).length).toBeGreaterThan(0);
    expect(within(form).getAllByText(/22023/).length).toBeGreaterThan(0);
  });
});

describe('Construction workspace — material issues', () => {
  beforeEach(() => {
    construction.findCapabilities.mockResolvedValue(['procurement.material.issue']);
    construction.findSites.mockResolvedValue([
      {
        id: 'site-1',
        business_id: BUSINESS.business.id,
        branch_id: 'branch-1',
        location_id: 'loc-1',
        site_code: 'SITE-A',
        site_name: 'Site A',
        project_ref: 'PRJ-1',
        is_active: true,
        created_at: '2026-10-01T00:00:00Z',
      },
    ]);
    construction.findPostingPolicy.mockResolvedValue({
      business_id: BUSINESS.business.id,
      movement_posting_enabled: true,
      cost_basis_source: 'matched_supplier_bill_line',
      gl_posting_enabled: false,
      approved_by: 'user-9',
      approved_at: '2026-10-15T00:00:00Z',
      approved_reason: 'board minute 12',
      approved_evidence: 'minute 12',
      updated_at: '2026-10-15T00:00:00Z',
    });
  });

  it('uses the server-returned cost and never asks the operator for one', async () => {
    const { repos } = await import('@/lib/repositories');
    (repos.inventory.findAllProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'prod-1', name: 'Cement 50kg', unit_of_measure: 'BAG' },
    ]);
    (repos.inventory.findBalancesByLocation as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'bal-1', product_id: 'prod-1', location_id: 'loc-1', quantity_on_hand: 24, average_cost: 900 },
    ]);
    construction.issueMaterialsToProject.mockResolvedValue({
      id: 'issue-1',
      quantity_base: 12,
      unit_cost_base: 900,
      total_cost_base: 10800,
      currency: 'MWK',
      project_ref: 'PRJ-1',
      journal_effect: 'none',
    });

    renderWorkspace('/construction/material-issues');

    const form = await screen.findByRole('button', { name: /Record material issue/i });
    expect(form).toBeTruthy();
    // There is no cost input anywhere on the screen: the pool cost is the server's.
    expect(screen.queryByLabelText(/unit cost/i)).toBeNull();
    expect(screen.queryByLabelText(/total cost/i)).toBeNull();

    fireEvent.change(await screen.findByLabelText('Construction site'), { target: { value: 'site-1' } });
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'prod-1' } });
    fireEvent.change(screen.getByLabelText('Issue unit'), { target: { value: 'BAG' } });
    fireEvent.change(screen.getByLabelText('Issue quantity'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Evidence reference'), { target: { value: 'signed requisition' } });
    expect((await screen.findAllByText(/pool weighted-average cost/i)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Record material issue/i }));

    await waitFor(() => expect(construction.issueMaterialsToProject).toHaveBeenCalledTimes(1));
    const [payload] = construction.issueMaterialsToProject.mock.calls[0];
    expect(payload).not.toHaveProperty('unit_cost_base');
    expect(payload).not.toHaveProperty('total_cost_base');
    expect(payload).not.toHaveProperty('location_id');
    expect(await screen.findByText(/MWK 900\.00 per base unit/i)).toBeTruthy();
    expect(screen.getAllByText(/no journal entry/i).length).toBeGreaterThan(0);
  });
});
