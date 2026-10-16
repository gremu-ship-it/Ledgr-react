import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConstructionCommandError,
  ConstructionProcurementRepository,
} from '../ConstructionProcurementRepository';

/**
 * Client-contract cover for the construction procurement adapter.
 *
 * These tests pin one thing: that every UI action calls the RIGHT database
 * command with the RIGHT argument names, and that nothing on this path writes a
 * table directly. Authorisation, scope, evidence rules and stock effects are the
 * database's job and are proven against a real PostgreSQL in
 * `tests/release/construction-procurement.test.ts` — they are deliberately not
 * re-implemented or re-asserted here.
 *
 * A silent rename of an RPC argument would otherwise surface as a runtime error
 * in production, which is exactly the failure this file prevents.
 */

const mocks = vi.hoisted(() => {
  // The argument tuple is declared on the mock itself so `mock.calls` is typed
  // as [fn, args] and the assertions below cannot drift from the adapter.
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(
    async () => ({ data: {}, error: null }),
  );
  const from = vi.fn<(table: string) => never>((table: string) => {
    throw new Error(`direct table access is not allowed on this path (${table})`);
  });
  return { rpc, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));

/** A chainable, awaitable PostgREST-style builder that records the table it read. */
function builder(data: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve(resolve({ data, error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: (data[0] as unknown) ?? null, error: null }));
  return chain;
}

beforeEach(() => {
  mocks.rpc.mockClear();
  mocks.from.mockClear();
});

describe('ConstructionProcurementRepository — command contract', () => {
  it('maps every command to the documented RPC name and argument names', async () => {
    const repository = new ConstructionProcurementRepository();

    await repository.registerSite({
      businessId: 'biz',
      branchId: 'branch',
      locationId: 'loc',
      siteCode: 'S1',
      siteName: 'Site one',
      projectRef: 'P-1',
    });
    await repository.registerUomConversion({
      businessId: 'biz',
      productId: 'prod',
      fromUom: 'CTN',
      toUom: 'BAG',
      factor: 12,
      evidenceReference: 'packaging spec',
    });
    await repository.createPurchaseOrder(
      { business_id: 'biz', site_id: 'site', supplier_contact_id: 'sup', currency: 'MWK', lines: [] },
      'key-1',
    );
    await repository.authorizePurchaseOrder('po-1');
    await repository.cancelPurchaseOrder('po-1', 'duplicate requirement');
    await repository.recordDeliveryNote(
      {
        business_id: 'biz',
        po_id: 'po-1',
        delivery_note_number: 'DN-1',
        document_date: '2026-10-16',
        evidence_reference: 'filed note',
        lines: [],
      },
      'key-2',
    );
    await repository.recordDeliveryNoteException(
      {
        business_id: 'biz',
        po_id: 'po-1',
        delivery_note_number: 'DN-1',
        document_date: '2026-10-16',
        evidence_reference: 'filed note',
        lines: [],
      },
      'key-2b',
    );
    await repository.recordGoodsReceipt({ business_id: 'biz', po_id: 'po-1', receipt_date: '2026-10-16', lines: [] }, 'key-3');
    await repository.recordInspection(
      {
        business_id: 'biz',
        grn_line_id: 'line-1',
        inspection_date: '2026-10-16',
        outcome: 'passed',
        quantity_inspected: 1,
        method: 'visual',
        evidence_reference: 'lab report',
      },
      'key-4',
    );
    await repository.reclassifyReceiptLine(
      {
        business_id: 'biz',
        grn_line_id: 'line-1',
        from_bucket: 'quarantined',
        quantity: 1,
        inspection_id: 'insp-1',
        reason: 'test passed',
        evidence_reference: 'lab report',
      },
      'key-5',
    );
    await repository.releaseHold('hold-1', 'settled with supplier');
    await repository.registerSupplierInvoiceReference('exp-1');
    await repository.registerSupplierInvoiceReferenceException({
      expenseId: 'exp-2',
      exceptionOf: 'ref-1',
      reason: 're-issued invoice',
      evidence: 'supplier email',
    });
    await repository.matchBillLineToReceipt(
      {
        business_id: 'biz',
        grn_line_id: 'line-1',
        expense_line_id: 'bl-1',
        bill_uom: 'BAG',
        bill_quantity: 1,
        receipt_quantity: 1,
      },
      'key-6',
    );
    await repository.approvePostingPolicy({ businessId: 'biz', enable: true, reason: 'board minute', evidence: 'minute 12' });
    await repository.recordReceiptCostBasis({
      grnLineId: 'line-1',
      expenseLineId: 'bl-1',
      quantity: 1,
      evidenceReference: 'invoice page 1',
      clientKey: 'key-7',
    });
    await repository.postReceiptMovement('grn-1');
    await repository.issueMaterialsToProject(
      {
        business_id: 'biz',
        site_id: 'site',
        product_id: 'prod',
        uom: 'BAG',
        quantity: 2,
        issue_date: '2026-10-16',
        evidence_reference: 'signed requisition',
      },
      'key-8',
    );

    expect(mocks.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'register_construction_procurement_site',
      'register_construction_product_uom_conversion',
      'create_construction_purchase_order',
      'authorize_construction_purchase_order',
      'cancel_construction_purchase_order',
      'record_construction_delivery_note',
      'record_construction_delivery_note_exception',
      'record_construction_goods_receipt',
      'record_construction_receipt_inspection',
      'reclassify_construction_receipt_line',
      'release_construction_receipt_hold',
      'register_construction_supplier_invoice_reference',
      'register_construction_supplier_invoice_reference_exception',
      'match_construction_bill_line_to_receipt',
      'approve_construction_receipt_posting_policy',
      'record_construction_receipt_cost_basis',
      'post_construction_receipt_movement',
      'issue_construction_materials_to_project',
    ]);

    const argsAt = (index: number) => mocks.rpc.mock.calls[index][1];
    expect(argsAt(0)).toEqual({
      p_business_id: 'biz',
      p_branch_id: 'branch',
      p_location_id: 'loc',
      p_site_code: 'S1',
      p_site_name: 'Site one',
      p_project_ref: 'P-1',
    });
    expect(argsAt(1)).toEqual({
      p_business_id: 'biz',
      p_product_id: 'prod',
      p_from_uom: 'CTN',
      p_to_uom: 'BAG',
      p_factor: 12,
      p_evidence_reference: 'packaging spec',
    });
    // One payload + one client-generated replay key; no separate idempotency column.
    expect(argsAt(2)).toEqual({ p_payload: expect.any(Object), p_client_key: 'key-1' });
    expect(argsAt(3)).toEqual({ p_po_id: 'po-1' });
    expect(argsAt(4)).toEqual({ p_po_id: 'po-1', p_reason: 'duplicate requirement' });
    expect(argsAt(10)).toEqual({ p_hold_id: 'hold-1', p_reason: 'settled with supplier' });
    expect(argsAt(11)).toEqual({ p_expense_id: 'exp-1' });
    expect(argsAt(12)).toEqual({
      p_expense_id: 'exp-2',
      p_exception_of: 'ref-1',
      p_reason: 're-issued invoice',
      p_evidence: 'supplier email',
    });
    expect(argsAt(14)).toEqual({
      p_business_id: 'biz',
      p_enable: true,
      p_reason: 'board minute',
      p_evidence: 'minute 12',
    });
    expect(argsAt(15)).toEqual({
      p_grn_line_id: 'line-1',
      p_expense_line_id: 'bl-1',
      p_quantity: 1,
      p_evidence: 'invoice page 1',
      p_client_key: 'key-7',
    });
    expect(argsAt(16)).toEqual({ p_grn_id: 'grn-1' });
    expect(argsAt(17)).toEqual({ p_payload: expect.any(Object), p_client_key: 'key-8' });
  });

  it('never sends an actor id, a cost, a stock balance or a branch scope supplied by the caller', async () => {
    const repository = new ConstructionProcurementRepository();
    await repository.issueMaterialsToProject(
      {
        business_id: 'biz',
        site_id: 'site',
        product_id: 'prod',
        uom: 'BAG',
        quantity: 2,
        issue_date: '2026-10-16',
        evidence_reference: 'signed requisition',
      },
      'key-9',
    );

    const payload = mocks.rpc.mock.calls[0][1].p_payload as Record<string, unknown>;
    // The command derives every one of these from the site registry, the pool
    // balance and auth.uid(); the client must not be able to offer them.
    for (const forbidden of [
      'unit_cost',
      'unit_cost_base',
      'total_cost_base',
      'currency',
      'issued_by',
      'location_id',
      'branch_id',
      'project_ref',
      'client_key',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('surfaces a refusal as a typed error carrying the SQLSTATE and the refusal token', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'receipt-cost-basis-incomplete: receipt line 1 has an accepted quantity of 5 but only 0 has an evidenced cost basis.',
        code: '22023',
      },
    });
    const repository = new ConstructionProcurementRepository();

    await expect(repository.postReceiptMovement('grn-1')).rejects.toMatchObject({
      name: 'ConstructionCommandError',
      sqlState: '22023',
      token: 'receipt-cost-basis-incomplete',
    });
  });

  it('propagates the server message verbatim', () => {
    const error = new ConstructionCommandError(
      {
        message: 'insufficient-stock: 0 in base units are available at the site store but 5 are being issued.',
        code: '22023',
      },
      'fallback',
    );
    expect(error.message).toBe(
      'insufficient-stock: 0 in base units are available at the site store but 5 are being issued.',
    );
    expect(error.rawMessage).toContain('insufficient-stock');
  });

  it('falls back to a readable message when the server sends none', () => {
    const error = new ConstructionCommandError({}, 'Could not post the receipt movement.');
    expect(error.message).toBe('Could not post the receipt movement.');
    expect(error.token).toBeNull();
  });
});

describe('ConstructionProcurementRepository — reads', () => {
  it('reads only member-scoped tables and never writes', async () => {
    const tables: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      tables.push(table);
      return builder() as never;
    });
    const repository = new ConstructionProcurementRepository();

    await repository.findPurchaseOrders('biz');
    await repository.findReceiptLines('grn-1');
    await repository.findSupplierBillLines('biz');
    await repository.findPostingPolicy('biz');

    expect(tables).toEqual([
      'construction_purchase_orders',
      'construction_goods_receipt_lines',
      'expense_lines',
      'construction_receipt_posting_policies',
    ]);
    // Reads never go through rpc, and no insert/update/delete exists on this path.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('parses the capability array the server command returns', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: ['procurement.po.manage', 'procurement.grn.record'],
      error: null,
    });
    const repository = new ConstructionProcurementRepository();
    await expect(repository.findCapabilities('biz')).resolves.toEqual([
      'procurement.po.manage',
      'procurement.grn.record',
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('construction_procurement_capabilities_for', { p_business_id: 'biz' });
  });

  it('returns an empty capability set rather than throwing on an unexpected shape', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const repository = new ConstructionProcurementRepository();
    await expect(repository.findCapabilities('biz')).resolves.toEqual([]);
  });
});
