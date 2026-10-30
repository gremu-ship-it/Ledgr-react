import { supabase } from '@/lib/supabase';
import type { Database } from '../types/database';

/**
 * Construction procurement — typed adapter over the EXISTING database command
 * layer (migration `20261021000000_construction_procurement_traceability.sql`).
 *
 * Design rules this module obeys, deliberately:
 *
 *  - It contains **no procurement or stock logic**. Every write goes through the
 *    `public.*_construction_*` command, which is the only authority for stock
 *    mutations, capability checks, branch/location scope, evidence requirements
 *    and append-only history.
 *  - It never computes a cost, a conversion factor, a stock balance, a branch
 *    scope or an actor id. The browser supplies documents and intent; the server
 *    decides what is true. `matched_by`/`created_by`/`inspected_by` are written
 *    by the commands from `auth.uid()`, never passed in.
 *  - Every mutating command takes a client-generated `p_client_key`, used only by
 *    the server as a replay key (RETRY-DETECTION, not integrity). Re-sending the
 *    same key returns the committed document instead of creating a second one.
 *  - Reads are plain `SELECT`s against the member-read policies the migration
 *    installed. `anon` has no access, and `authenticated` has SELECT only, so a
 *    direct write from this module is impossible even if someone tried.
 *
 * The generated `Database` types now include the construction tables
 * (regenerated from the live schema in P3-4), and every read model below is
 * derived from them (`Pick` of a generated Row, or an RPC `Returns` element).
 * Where the live schema stores a CHECK-constrained `text` column, the
 * app-facing union is re-asserted with `Omit<...> & { ... }`; the CHECK
 * constraint is the authority for the narrower union. The narrow
 * `ConstructionClient` adapter is retained: every write goes through an RPC
 * command whose jsonb payload shapes are not part of the generated surface,
 * following the established pattern in `src/services/invoiceApprovalRpc.ts`
 * and `PosRepository`.
 */

/** PostgREST error shape as far as this module needs it. */
export interface ConstructionServerError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface PostgrestResult<T> {
  data: T | null;
  error: ConstructionServerError | null;
}

interface SelectBuilder extends PromiseLike<PostgrestResult<unknown[]>> {
  eq(column: string, value: unknown): SelectBuilder;
  is(column: string, value: null): SelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder;
  limit(count: number): SelectBuilder;
  maybeSingle(): Promise<PostgrestResult<unknown>>;
}

interface ConstructionClient {
  from(table: string): { select(columns: string): SelectBuilder };
  rpc(fn: string, args: Record<string, unknown>): Promise<PostgrestResult<unknown>>;
}

const client = supabase as unknown as ConstructionClient;

// ─────────────────────────────────────────────────────────────────────────────
// Capability vocabulary — mirrors `construction_procurement_capabilities.code`
// exactly. These are the codes the server checks; the UI uses them only to
// enable/disable controls, never to authorise anything on its own.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSTRUCTION_CAPABILITIES = {
  masterManage: 'procurement.master.manage',
  poManage: 'procurement.po.manage',
  poAuthorize: 'procurement.po.authorize',
  deliveryNoteRecord: 'procurement.delivery_note.record',
  grnRecord: 'procurement.grn.record',
  receiptInspect: 'procurement.receipt.inspect',
  exceptionAuthorize: 'procurement.exception.authorize',
  billMatch: 'procurement.bill.match',
  receiptPost: 'procurement.receipt.post',
  policyApprove: 'procurement.policy.approve',
  materialIssue: 'procurement.material.issue',
  materialReturn: 'procurement.material.return',
} as const;

export type ConstructionCapability =
  (typeof CONSTRUCTION_CAPABILITIES)[keyof typeof CONSTRUCTION_CAPABILITIES];

/** Human labels for the capability vocabulary (display only). */
export const CONSTRUCTION_CAPABILITY_LABELS: Record<string, string> = {
  [CONSTRUCTION_CAPABILITIES.masterManage]: 'Register sites and unit conversions',
  [CONSTRUCTION_CAPABILITIES.poManage]: 'Create and cancel purchase orders',
  [CONSTRUCTION_CAPABILITIES.poAuthorize]: 'Authorize purchase orders',
  [CONSTRUCTION_CAPABILITIES.deliveryNoteRecord]: 'Record delivery notes',
  [CONSTRUCTION_CAPABILITIES.grnRecord]: 'Record goods receipts',
  [CONSTRUCTION_CAPABILITIES.receiptInspect]: 'Inspect and classify receipts',
  [CONSTRUCTION_CAPABILITIES.exceptionAuthorize]: 'Authorize exceptions and release holds',
  [CONSTRUCTION_CAPABILITIES.billMatch]: 'Match supplier bills to receipts',
  [CONSTRUCTION_CAPABILITIES.receiptPost]: 'Prepare and post receipt cost',
  [CONSTRUCTION_CAPABILITIES.policyApprove]: 'Approve the receipt posting policy',
  [CONSTRUCTION_CAPABILITIES.materialIssue]: 'Issue material to a site',
  [CONSTRUCTION_CAPABILITIES.materialReturn]: 'Return usable material to the store',
};

// ─────────────────────────────────────────────────────────────────────────────
// Read models
// ─────────────────────────────────────────────────────────────────────────────

type Tables = Database['public']['Tables'];
type PublicFunctions = Database['public']['Functions'];

export type ConstructionProcurementSite = Pick<
  Tables['construction_procurement_sites']['Row'],
  | 'id'
  | 'business_id'
  | 'branch_id'
  | 'location_id'
  | 'site_code'
  | 'site_name'
  /** Authoritative FK to construction_projects (nullable); project_ref stays the display label. */
  | 'project_id'
  | 'project_ref'
  | 'is_active'
  | 'created_at'
>;

export type ConstructionUomConversion = Pick<
  Tables['construction_product_uom_conversions']['Row'],
  | 'id'
  | 'business_id'
  | 'product_id'
  | 'from_uom'
  | 'to_uom'
  | 'factor'
  | 'evidence_reference'
  | 'is_active'
  | 'approved_at'
>;

/** CHECK `construction_purchase_orders_status_check` in the live schema. */
export type ConstructionPurchaseOrderStatus = 'draft' | 'authorized' | 'cancelled';

export type ConstructionPurchaseOrder = Omit<
  Pick<
    Tables['construction_purchase_orders']['Row'],
    | 'id'
    | 'business_id'
    | 'branch_id'
    | 'site_id'
    | 'project_id'
    | 'project_ref'
    | 'supplier_contact_id'
    | 'po_number'
    | 'currency'
    | 'status'
    | 'notes'
    | 'created_by'
    | 'created_at'
    | 'authorized_by'
    | 'authorized_at'
    | 'cancelled_by'
    | 'cancelled_at'
    | 'cancel_reason'
  >,
  'status'
> & { status: ConstructionPurchaseOrderStatus };

export type ConstructionPurchaseOrderLine = Pick<
  Tables['construction_purchase_order_lines']['Row'],
  | 'id'
  | 'business_id'
  | 'po_id'
  | 'line_number'
  | 'product_id'
  | 'uom'
  | 'quantity_ordered'
  | 'quantity_ordered_base'
  | 'expected_unit_price'
  | 'line_note'
>;

export type ProjectPurchaseOrderBoqLink = Tables['project_purchase_order_boq_links']['Row'];

export type ConstructionPurchaseOrderEvent = Pick<
  Tables['construction_purchase_order_events']['Row'],
  'id' | 'po_id' | 'action' | 'actor' | 'detail' | 'created_at'
>;

export type ConstructionDeliveryNote = Pick<
  Tables['construction_delivery_notes']['Row'],
  | 'id'
  | 'business_id'
  | 'po_id'
  | 'supplier_contact_id'
  | 'delivery_note_number'
  | 'normalized_reference'
  | 'document_date'
  | 'document_received_by'
  | 'evidence_reference'
  | 'notes'
  | 'recorded_by'
  | 'recorded_at'
  | 'is_exception'
  | 'exception_of'
>;

export type ConstructionDeliveryNoteLine = Pick<
  Tables['construction_delivery_note_lines']['Row'],
  | 'id'
  | 'delivery_note_id'
  | 'po_line_id'
  | 'line_number'
  | 'product_id'
  | 'uom'
  | 'quantity_declared'
  | 'quantity_declared_base'
  | 'line_note'
>;

/**
 * GRN header. The live table is `construction_goods_receipt_notes` (the
 * `_notes` suffix is the schema's own naming — see migration
 * 20261021000000_construction_procurement_traceability.sql); the app-facing
 * name predates it and is kept for compatibility.
 */
export type ConstructionGoodsReceipt = Pick<
  Tables['construction_goods_receipt_notes']['Row'],
  | 'id'
  | 'business_id'
  | 'branch_id'
  | 'site_id'
  | 'location_id'
  | 'project_ref'
  | 'po_id'
  | 'delivery_note_id'
  | 'grn_number'
  | 'receipt_date'
  | 'notes'
  | 'created_by'
  | 'created_at'
>;

export type ConstructionGoodsReceiptLine = Pick<
  Tables['construction_goods_receipt_lines']['Row'],
  | 'id'
  | 'business_id'
  | 'grn_id'
  | 'line_number'
  | 'po_line_id'
  | 'product_id'
  | 'uom'
  | 'quantity_received'
  | 'quantity_accepted'
  | 'quantity_rejected'
  | 'quantity_quarantined'
  | 'quantity_disputed'
  | 'received_base'
  | 'accepted_base'
  | 'rejected_base'
  | 'quarantined_base'
  | 'disputed_base'
  | 'quantity_posted_base'
  | 'over_receipt_exception'
  | 'over_receipt_reason'
  | 'over_receipt_evidence'
  | 'line_note'
>;

export type ConstructionGoodsReceiptHold = Omit<
  Pick<
    Tables['construction_goods_receipt_holds']['Row'],
    | 'id'
    | 'business_id'
    | 'grn_line_id'
    | 'hold_type'
    | 'quantity'
    | 'quantity_base'
    | 'reason'
    | 'evidence_reference'
    | 'status'
    | 'released_at'
    | 'release_reason'
    | 'created_at'
  >,
  'hold_type' | 'status'
> & {
  /** CHECK-constrained in the live schema. */
  hold_type: 'rejected' | 'quarantined' | 'disputed';
  status: 'open' | 'released';
};

export type ConstructionReceiptInspection = Omit<
  Pick<
    Tables['construction_receipt_inspections']['Row'],
    | 'id'
    | 'business_id'
    | 'grn_line_id'
    | 'inspection_date'
    | 'outcome'
    | 'quantity_inspected'
    | 'quantity_inspected_base'
    | 'method'
    | 'certificate_reference'
    | 'evidence_reference'
    | 'inspected_by'
    | 'inspected_at'
  >,
  'outcome'
> & {
  /** CHECK-constrained in the live schema. */
  outcome: 'passed' | 'failed' | 'partial';
};

export type ConstructionReceiptLineReclassification = Omit<
  Pick<
    Tables['construction_receipt_line_reclassifications']['Row'],
    | 'id'
    | 'business_id'
    | 'grn_line_id'
    | 'inspection_id'
    | 'from_bucket'
    | 'to_bucket'
    | 'quantity'
    | 'quantity_base'
    | 'accepted_before_base'
    | 'accepted_after_base'
    | 'reason'
    | 'evidence_reference'
    | 'reclassified_by'
    | 'reclassified_at'
  >,
  'from_bucket' | 'to_bucket'
> & {
  /** CHECK-constrained in the live schema. */
  from_bucket: 'quarantined' | 'disputed';
  to_bucket: 'accepted';
};

export type ConstructionReceiptBillAllocation = Pick<
  Tables['construction_receipt_bill_allocations']['Row'],
  | 'id'
  | 'business_id'
  | 'grn_line_id'
  | 'expense_id'
  | 'expense_line_id'
  | 'bill_uom'
  | 'bill_quantity'
  | 'bill_quantity_base'
  | 'receipt_uom'
  | 'receipt_quantity'
  | 'receipt_quantity_base'
  | 'is_exception'
  | 'exception_reason'
  | 'matched_by'
  | 'matched_at'
>;

export type ConstructionReceiptCostBasis = Pick<
  Tables['construction_receipt_cost_bases']['Row'],
  | 'id'
  | 'business_id'
  | 'grn_line_id'
  | 'expense_line_id'
  | 'allocation_id'
  | 'quantity_base'
  | 'unit_cost_base'
  | 'cost_currency'
  | 'exchange_rate_used'
  | 'bill_unit_cost'
  | 'discount_deducted'
  | 'nonrecoverable_tax'
  | 'vat_recoverable'
  | 'evidence_reference'
  | 'claimed_by'
  | 'claimed_at'
>;

export type ConstructionReceiptPostingPolicy = Pick<
  Tables['construction_receipt_posting_policies']['Row'],
  | 'business_id'
  | 'movement_posting_enabled'
  | 'cost_basis_source'
  | 'gl_posting_enabled'
  | 'approved_by'
  | 'approved_at'
  | 'approved_reason'
  | 'approved_evidence'
  | 'updated_at'
>;

export type ConstructionSupplierInvoiceReference = Omit<
  Pick<
    Tables['construction_supplier_invoice_references']['Row'],
    | 'id'
    | 'business_id'
    | 'supplier_contact_id'
    | 'expense_id'
    | 'reference_raw'
    | 'reference_normalized'
    | 'source'
    | 'status'
    | 'exception_of'
    | 'exception_reason'
    | 'recorded_by'
    | 'recorded_at'
  >,
  'status'
> & {
  /** CHECK-constrained in the live schema. */
  status: 'active' | 'exception';
};

/**
 * A line of an EXISTING supplier bill (`expense_lines`). The decision matrix is
 * explicit that supplier bills stay where they are: `expenses`/`expense_lines`
 * are the invoice source, `expenses.expense_number` is Ledgr's internal number
 * and `expenses.reference` is the supplier's own invoice reference. This read
 * exists so the matching screen can show those lines; it creates no second
 * invoice document and writes nothing.
 */
export type ConstructionSupplierBillLine = Pick<
  Tables['expense_lines']['Row'],
  | 'id'
  | 'business_id'
  | 'expense_id'
  | 'line_number'
  | 'description'
  | 'product_id'
  | 'quantity'
  | 'unit_price'
  | 'discount_percent'
  | 'discount_amount'
  | 'tax_code'
  | 'tax_rate'
  | 'tax_amount'
  | 'line_total'
>;

export type ConstructionMaterialIssue = Pick<
  Tables['construction_material_issues']['Row'],
  | 'id'
  | 'business_id'
  | 'site_id'
  | 'branch_id'
  | 'location_id'
  | 'project_id'
  | 'project_ref'
  | 'product_id'
  | 'uom'
  | 'quantity'
  | 'quantity_base'
  | 'unit_cost_base'
  | 'total_cost_base'
  | 'currency'
  | 'issue_date'
  | 'issued_to'
  | 'evidence_reference'
  | 'stock_movement_id'
  | 'issued_by'
  | 'issued_at'
  | 'notes'
  | 'client_key'
>;

/**
 * The `construction_procurement_open_items` read model (server-computed).
 * The RPC is `RETURNS jsonb` in the live schema, so the generated surface
 * types it as `Json`; this hand-written shape documents the payload the
 * server actually returns and stays.
 */
export interface ConstructionOpenItems {
  business_id: string;
  movement_posting_enabled: boolean;
  gl_posting_enabled: boolean;
  grants_in_force: number;
  awaiting_cost_basis: Array<{
    grn_number: string;
    line_number: number;
    accepted_base: string | number;
    covered_base: string | number;
  }>;
  awaiting_posting: Array<{
    grn_number: string;
    line_number: number;
    accepted_base: string | number;
    quantity_posted_base: string | number;
  }>;
  open_holds: Array<{
    hold_type: string;
    quantity: string | number;
    quantity_base: string | number;
    reason: string;
    evidence_reference: string;
    age_days: number;
  }>;
  outstanding_supplier_claims: Array<{
    supplier: string;
    product_id: string;
    rejected_base: string | number;
    quarantined_base: string | number;
    disputed_base: string | number;
    outstanding_base: string | number;
    receipt_date: string;
    age_days: number;
  }>;
  blocked_bills: Array<{
    expense_number: string;
    reference: string | null;
    legacy_movements: number;
  }>;
}

/** An append-only record of usable material returned from a site to its store. */
export type ConstructionMaterialReturn = Omit<
  Pick<
    Tables['construction_material_returns']['Row'],
    | 'id'
    | 'business_id'
    | 'source_issue_id'
    | 'site_id'
    | 'branch_id'
    | 'location_id'
    | 'project_id'
    | 'project_ref'
    | 'product_id'
    | 'uom'
    | 'quantity'
    | 'quantity_base'
    | 'unit_cost_base'
    | 'total_cost_base'
    | 'currency'
    | 'return_date'
    | 'condition'
    | 'reason'
    | 'evidence_reference'
    | 'received_by'
    | 'stock_movement_id'
    | 'created_by'
    | 'created_at'
    | 'notes'
    | 'client_key'
  >,
  'condition'
> & {
  /** CHECK-constrained in the live schema. */
  condition: 'usable' | 'usable_with_restriction';
};

export type ConstructionProjectMaterialCostRow =
  PublicFunctions['construction_project_material_cost']['Returns'][number];

/** Result envelope of the mutating construction commands. */
export interface ConstructionCommandResult {
  id?: string;
  number?: string;
  idempotent?: boolean;
  stock_effect?: string;
  journal_effect?: string;
  posting?: string;
  movements?: number;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command payloads — field names match the server contract exactly
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseOrderLineInput {
  product_id: string;
  uom: string;
  quantity_ordered: number | string;
  expected_unit_price?: number | string | null;
  line_note?: string | null;
}

export interface PurchaseOrderInput {
  business_id: string;
  site_id: string;
  supplier_contact_id: string;
  currency: string;
  lines: PurchaseOrderLineInput[];
  notes?: string | null;
}

export interface DeliveryNoteLineInput {
  po_line_id: string;
  uom: string;
  quantity_declared: number | string;
  line_note?: string | null;
}

export interface DeliveryNoteInput {
  business_id: string;
  po_id: string;
  delivery_note_number: string;
  document_date: string;
  document_received_by?: string | null;
  evidence_reference: string;
  notes?: string | null;
  lines: DeliveryNoteLineInput[];
}

export interface ReceiptHoldInput {
  hold_type: 'rejected' | 'quarantined' | 'disputed';
  quantity: number | string;
  reason: string;
  evidence_reference: string;
}

export interface ReceiptLineInput {
  po_line_id: string;
  quantity_received: number | string;
  quantity_accepted?: number | string;
  quantity_rejected?: number | string;
  quantity_quarantined?: number | string;
  quantity_disputed?: number | string;
  over_receipt_reason?: string | null;
  over_receipt_evidence?: string | null;
  line_note?: string | null;
  holds?: ReceiptHoldInput[];
}

export interface GoodsReceiptInput {
  business_id: string;
  po_id: string;
  receipt_date: string;
  delivery_note_id?: string | null;
  notes?: string | null;
  lines: ReceiptLineInput[];
}

export interface InspectionInput {
  business_id: string;
  grn_line_id: string;
  inspection_date: string;
  outcome: 'passed' | 'failed' | 'partial';
  quantity_inspected: number | string;
  method: string;
  certificate_reference?: string | null;
  evidence_reference: string;
  notes?: string | null;
}

export interface ReclassificationInput {
  business_id: string;
  grn_line_id: string;
  from_bucket: 'quarantined' | 'disputed' | 'rejected' | 'accepted';
  quantity: number | string;
  inspection_id: string;
  reason: string;
  evidence_reference: string;
}

export interface BillMatchInput {
  business_id: string;
  grn_line_id: string;
  expense_line_id: string;
  bill_uom: string;
  bill_quantity: number | string;
  receipt_quantity: number | string;
  exception_reason?: string | null;
  exception_evidence?: string | null;
}

/**
 * Return payload. Deliberately small: site, branch, location, project, product,
 * unit of measure, unit cost and base quantity are all derived from the source
 * issue by the server, and the command REFUSES a payload that supplies them.
 */
export interface MaterialReturnInput {
  business_id: string;
  source_issue_id: string;
  quantity: number | string;
  return_date: string;
  condition: 'usable' | 'usable_with_restriction';
  reason: string;
  evidence_reference: string;
  received_by?: string | null;
  notes?: string | null;
}

export interface MaterialIssueInput {
  business_id: string;
  site_id: string;
  product_id: string;
  uom: string;
  quantity: number | string;
  issue_date: string;
  issued_to?: string | null;
  evidence_reference: string;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A refusal (or failure) returned by the database command layer. The server
 * message carries a machine-readable token prefix (for example
 * `receipt-cost-basis-incomplete: …`); `token` exposes it so the UI can explain
 * a documented refusal instead of paraphrasing it.
 */
export class ConstructionCommandError extends Error {
  readonly sqlState: string | null;
  readonly token: string | null;
  readonly rawMessage: string;

  constructor(error: ConstructionServerError, fallback: string) {
    const rawMessage = error.message?.trim() || fallback;
    super(rawMessage);
    this.name = 'ConstructionCommandError';
    this.rawMessage = rawMessage;
    this.sqlState = error.code ?? null;
    const match = /^([a-z][a-z0-9-]{3,})(?::|\s|$)/.exec(rawMessage);
    this.token = match ? match[1] : null;
  }
}

function fail(error: ConstructionServerError | null, fallback: string): never {
  throw new ConstructionCommandError(error ?? {}, fallback);
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

export class ConstructionProcurementRepository {
  private async rows<T>(table: string, build: (builder: SelectBuilder) => SelectBuilder, fallback: string): Promise<T[]> {
    const { data, error } = await build(client.from(table).select('*'));
    if (error) fail(error, fallback);
    return (data ?? []) as T[];
  }

  private async single<T>(table: string, build: (builder: SelectBuilder) => SelectBuilder, fallback: string): Promise<T | null> {
    const { data, error } = await build(client.from(table).select('*')).maybeSingle();
    if (error) fail(error, fallback);
    return (data ?? null) as T | null;
  }

  private async call(fn: string, args: Record<string, unknown>, fallback: string): Promise<ConstructionCommandResult> {
    const { data, error } = await client.rpc(fn, args);
    if (error) fail(error, fallback);
    return (data ?? {}) as ConstructionCommandResult;
  }

  // ── Reads (member-scoped SELECT; the server decides visibility) ────────────

  /** Capability codes held by the caller for this business, straight from the server. */
  async findCapabilities(businessId: string): Promise<string[]> {
    const { data, error } = await client.rpc('construction_procurement_capabilities_for', {
      p_business_id: businessId,
    });
    if (error) fail(error, 'Could not read your construction procurement capabilities.');
    // The command returns `text[]`, which PostgREST serialises as a JSON array.
    if (Array.isArray(data)) return data.filter((entry): entry is string => typeof entry === 'string');
    return [];
  }

  async findSites(businessId: string): Promise<ConstructionProcurementSite[]> {
    return this.rows<ConstructionProcurementSite>(
      'construction_procurement_sites',
      (b) => b.eq('business_id', businessId).order('site_code'),
      'Could not load construction sites.',
    );
  }

  /** Active-or-not sites authoritatively linked to one project (project_id FK). */
  async findSitesForProject(businessId: string, projectId: string): Promise<ConstructionProcurementSite[]> {
    return this.rows<ConstructionProcurementSite>(
      'construction_procurement_sites',
      (b) => b.eq('business_id', businessId).eq('project_id', projectId).order('site_code'),
      'Could not load construction sites.',
    );
  }

  /** Registered sites with no project link yet — the picker source for ProjectDetail. */
  async findUnlinkedSites(businessId: string): Promise<ConstructionProcurementSite[]> {
    return this.rows<ConstructionProcurementSite>(
      'construction_procurement_sites',
      (b) => b.eq('business_id', businessId).is('project_id', null).order('site_code'),
      'Could not load construction sites.',
    );
  }

  async findUomConversions(businessId: string): Promise<ConstructionUomConversion[]> {
    return this.rows<ConstructionUomConversion>(
      'construction_product_uom_conversions',
      (b) => b.eq('business_id', businessId).order('from_uom'),
      'Could not load unit conversions.',
    );
  }

  async findPurchaseOrders(businessId: string, projectId?: string): Promise<ConstructionPurchaseOrder[]> {
    return this.rows<ConstructionPurchaseOrder>(
      'construction_purchase_orders',
      (b) => (projectId ? b.eq('business_id', businessId).eq('project_id', projectId) : b.eq('business_id', businessId)).order('created_at', { ascending: false }),
      'Could not load purchase orders.',
    );
  }

  async findPurchaseOrderLines(poId: string): Promise<ConstructionPurchaseOrderLine[]> {
    return this.rows<ConstructionPurchaseOrderLine>(
      'construction_purchase_order_lines',
      (b) => b.eq('po_id', poId).order('line_number'),
      'Could not load the purchase-order lines.',
    );
  }

  async findProjectPurchaseOrderBoqLinks(businessId: string, projectId: string): Promise<ProjectPurchaseOrderBoqLink[]> {
    return this.rows<ProjectPurchaseOrderBoqLink>(
      'project_purchase_order_boq_links',
      (b) => b.eq('business_id', businessId).eq('project_id', projectId).order('created_at'),
      'Could not load purchase-order BOQ links.',
    );
  }

  async setProjectPurchaseOrderBoqLink(input: {
    businessId: string;
    projectId: string;
    purchaseOrderLineId: string;
    boqItemId: string | null;
  }): Promise<ProjectPurchaseOrderBoqLink | null> {
    const { data, error } = await client.rpc('set_project_purchase_order_boq_link', {
      p_business_id: input.businessId,
      p_project_id: input.projectId,
      p_purchase_order_line_id: input.purchaseOrderLineId,
      p_boq_item_id: input.boqItemId,
    });
    if (error) fail(error, 'Could not update the purchase-order BOQ link.');
    return data && typeof data === 'object' && 'id' in data && data.id
      ? data as ProjectPurchaseOrderBoqLink
      : null;
  }

  async findPurchaseOrderEvents(poId: string): Promise<ConstructionPurchaseOrderEvent[]> {
    return this.rows<ConstructionPurchaseOrderEvent>(
      'construction_purchase_order_events',
      (b) => b.eq('po_id', poId).order('created_at'),
      'Could not load the purchase-order history.',
    );
  }

  async findDeliveryNotes(businessId: string): Promise<ConstructionDeliveryNote[]> {
    return this.rows<ConstructionDeliveryNote>(
      'construction_delivery_notes',
      (b) => b.eq('business_id', businessId).order('recorded_at', { ascending: false }),
      'Could not load delivery notes.',
    );
  }

  async findDeliveryNoteLines(deliveryNoteId: string): Promise<ConstructionDeliveryNoteLine[]> {
    return this.rows<ConstructionDeliveryNoteLine>(
      'construction_delivery_note_lines',
      (b) => b.eq('delivery_note_id', deliveryNoteId).order('line_number'),
      'Could not load the delivery-note lines.',
    );
  }

  async findReceipts(businessId: string, projectId?: string): Promise<ConstructionGoodsReceipt[]> {
    const receipts = await this.rows<ConstructionGoodsReceipt>(
      'construction_goods_receipt_notes',
      (b) => b.eq('business_id', businessId).order('created_at', { ascending: false }),
      'Could not load goods receipts.',
    );
    if (!projectId) return receipts;
    const projectOrderIds = new Set((await this.findPurchaseOrders(businessId, projectId)).map((po) => po.id));
    return receipts.filter((receipt) => projectOrderIds.has(receipt.po_id));
  }

  async findReceiptLines(grnId: string): Promise<ConstructionGoodsReceiptLine[]> {
    return this.rows<ConstructionGoodsReceiptLine>(
      'construction_goods_receipt_lines',
      (b) => b.eq('grn_id', grnId).order('line_number'),
      'Could not load the receipt lines.',
    );
  }

  /** Receipt lines across a business, optionally scoped through its project POs. */
  async findReceiptLinesForBusiness(businessId: string, projectId?: string): Promise<ConstructionGoodsReceiptLine[]> {
    const lines = await this.rows<ConstructionGoodsReceiptLine>(
      'construction_goods_receipt_lines',
      (b) => b.eq('business_id', businessId).order('line_number'),
      'Could not load receipt lines for this business.',
    );
    if (!projectId) return lines;
    const receiptIds = new Set((await this.findReceipts(businessId, projectId)).map((receipt) => receipt.id));
    return lines.filter((line) => receiptIds.has(line.grn_id));
  }

  async findReceiptHolds(grnLineId: string): Promise<ConstructionGoodsReceiptHold[]> {
    return this.rows<ConstructionGoodsReceiptHold>(
      'construction_goods_receipt_holds',
      (b) => b.eq('grn_line_id', grnLineId).order('created_at'),
      'Could not load the receipt holds.',
    );
  }

  async findHoldsForBusiness(businessId: string): Promise<ConstructionGoodsReceiptHold[]> {
    return this.rows<ConstructionGoodsReceiptHold>(
      'construction_goods_receipt_holds',
      (b) => b.eq('business_id', businessId).order('created_at', { ascending: false }),
      'Could not load receipt holds.',
    );
  }

  async findInspections(grnLineId: string): Promise<ConstructionReceiptInspection[]> {
    return this.rows<ConstructionReceiptInspection>(
      'construction_receipt_inspections',
      (b) => b.eq('grn_line_id', grnLineId).order('inspected_at', { ascending: false }),
      'Could not load inspections.',
    );
  }

  async findReclassifications(grnLineId: string): Promise<ConstructionReceiptLineReclassification[]> {
    return this.rows<ConstructionReceiptLineReclassification>(
      'construction_receipt_line_reclassifications',
      (b) => b.eq('grn_line_id', grnLineId).order('reclassified_at', { ascending: false }),
      'Could not load quality releases.',
    );
  }

  async findAllocationsForReceiptLine(grnLineId: string): Promise<ConstructionReceiptBillAllocation[]> {
    return this.rows<ConstructionReceiptBillAllocation>(
      'construction_receipt_bill_allocations',
      (b) => b.eq('grn_line_id', grnLineId).order('matched_at'),
      'Could not load bill matches.',
    );
  }

  async findAllocationsForBusiness(businessId: string, projectId?: string): Promise<ConstructionReceiptBillAllocation[]> {
    const allocations = await this.rows<ConstructionReceiptBillAllocation>(
      'construction_receipt_bill_allocations',
      (b) => b.eq('business_id', businessId).order('matched_at', { ascending: false }),
      'Could not load bill matches.',
    );
    if (!projectId) return allocations;
    const projectLineIds = new Set((await this.findReceiptLinesForBusiness(businessId, projectId)).map((line) => line.id));
    return allocations.filter((allocation) => projectLineIds.has(allocation.grn_line_id));
  }

  async findCostBasesForReceiptLine(grnLineId: string): Promise<ConstructionReceiptCostBasis[]> {
    return this.rows<ConstructionReceiptCostBasis>(
      'construction_receipt_cost_bases',
      (b) => b.eq('grn_line_id', grnLineId).order('claimed_at'),
      'Could not load receipt cost bases.',
    );
  }

  async findCostBasesForBusiness(businessId: string): Promise<ConstructionReceiptCostBasis[]> {
    return this.rows<ConstructionReceiptCostBasis>(
      'construction_receipt_cost_bases',
      (b) => b.eq('business_id', businessId).order('claimed_at', { ascending: false }),
      'Could not load receipt cost bases.',
    );
  }

  async findPostingPolicy(businessId: string): Promise<ConstructionReceiptPostingPolicy | null> {
    return this.single<ConstructionReceiptPostingPolicy>(
      'construction_receipt_posting_policies',
      (b) => b.eq('business_id', businessId),
      'Could not read the receipt posting policy.',
    );
  }

  async findSupplierInvoiceReferences(businessId: string): Promise<ConstructionSupplierInvoiceReference[]> {
    return this.rows<ConstructionSupplierInvoiceReference>(
      'construction_supplier_invoice_references',
      (b) => b.eq('business_id', businessId).order('recorded_at', { ascending: false }),
      'Could not load registered supplier references.',
    );
  }

  async findMaterialIssues(businessId: string, projectId?: string): Promise<ConstructionMaterialIssue[]> {
    return this.rows<ConstructionMaterialIssue>(
      'construction_material_issues',
      (b) => (projectId ? b.eq('business_id', businessId).eq('project_id', projectId) : b.eq('business_id', businessId)).order('issued_at', { ascending: false }),
      'Could not load material issues.',
    );
  }

  /** The append-only return register for this business (branch-scoped by RLS). */
  async findMaterialReturns(businessId: string, projectId?: string): Promise<ConstructionMaterialReturn[]> {
    return this.rows<ConstructionMaterialReturn>(
      'construction_material_returns',
      (b) => (projectId ? b.eq('business_id', businessId).eq('project_id', projectId) : b.eq('business_id', businessId)).order('created_at', { ascending: false }),
      'Could not load material returns.',
    );
  }

  /** Lines of the existing supplier bills for this business (read-only). */
  async findSupplierBillLines(businessId: string): Promise<ConstructionSupplierBillLine[]> {
    return this.rows<ConstructionSupplierBillLine>(
      'expense_lines',
      (b) => b.eq('business_id', businessId).order('line_number'),
      'Could not load supplier bill lines.',
    );
  }

  async findOpenItems(businessId: string): Promise<ConstructionOpenItems> {
    const { data, error } = await client.rpc('construction_procurement_open_items', { p_business_id: businessId });
    if (error) fail(error, 'Could not load the construction open-item report.');
    return data as ConstructionOpenItems;
  }

  async findProjectMaterialCost(businessId: string): Promise<ConstructionProjectMaterialCostRow[]> {
    const { data, error } = await client.rpc('construction_project_material_cost', { p_business_id: businessId });
    if (error) fail(error, 'Could not load project material cost.');
    return (data ?? []) as ConstructionProjectMaterialCostRow[];
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  async registerSite(input: {
    businessId: string;
    branchId: string;
    locationId: string;
    siteCode: string;
    siteName: string;
    projectRef: string;
  }): Promise<ConstructionCommandResult> {
    return this.call(
      'register_construction_procurement_site',
      {
        p_business_id: input.businessId,
        p_branch_id: input.branchId,
        p_location_id: input.locationId,
        p_site_code: input.siteCode,
        p_site_name: input.siteName,
        p_project_ref: input.projectRef,
      },
      'Could not register the construction site.',
    );
  }

  /**
   * Deactivates or reactivates a registered site (20261108 lifecycle RPC).
   * The server refuses deactivation while open purchase orders reference the
   * site or its inventory location holds stock; refusals surface as
   * ConstructionCommandError with the server's specific message.
   */
  async setSiteStatus(siteId: string, active: boolean, reason?: string): Promise<ConstructionCommandResult> {
    return this.call(
      'set_construction_procurement_site_status',
      {
        p_site_id: siteId,
        p_active: active,
        p_reason: reason ?? null,
      },
      active ? 'Could not reactivate the construction site.' : 'Could not deactivate the construction site.',
    );
  }

  /**
   * Edits a registered site's name and/or project link (20261108 lifecycle
   * RPC). `projectId` is explicit-intent: omitted = keep the current link,
   * null = unlink, uuid = link. `p_set_project` carries that intent to the
   * server because SQL COALESCE cannot distinguish null from "not supplied".
   */
  async updateSite(
    siteId: string,
    data: { siteName?: string; projectId?: string | null; projectRef?: string },
  ): Promise<ConstructionCommandResult> {
    return this.call(
      'update_construction_procurement_site',
      {
        p_site_id: siteId,
        p_site_name: data.siteName ?? null,
        p_project_id: data.projectId ?? null,
        p_project_ref: data.projectRef ?? null,
        p_set_project: data.projectId !== undefined,
      },
      'Could not update the construction site.',
    );
  }

  async registerUomConversion(input: {
    businessId: string;
    productId: string;
    fromUom: string;
    toUom: string;
    factor: number;
    evidenceReference: string;
  }): Promise<ConstructionCommandResult> {
    return this.call(
      'register_construction_product_uom_conversion',
      {
        p_business_id: input.businessId,
        p_product_id: input.productId,
        p_from_uom: input.fromUom,
        p_to_uom: input.toUom,
        p_factor: input.factor,
        p_evidence_reference: input.evidenceReference,
      },
      'Could not register the unit conversion.',
    );
  }

  async createPurchaseOrder(input: PurchaseOrderInput, clientKey: string, projectId?: string): Promise<ConstructionCommandResult> {
    return this.call(
      projectId ? 'create_project_purchase_order' : 'create_construction_purchase_order',
      { p_payload: input, p_client_key: clientKey, ...(projectId ? { p_project_id: projectId } : {}) },
      'Could not create the purchase order.',
    );
  }

  async authorizePurchaseOrder(poId: string): Promise<ConstructionCommandResult> {
    return this.call('authorize_construction_purchase_order', { p_po_id: poId }, 'Could not authorize the purchase order.');
  }

  async cancelPurchaseOrder(poId: string, reason: string): Promise<ConstructionCommandResult> {
    return this.call('cancel_construction_purchase_order', { p_po_id: poId, p_reason: reason }, 'Could not cancel the purchase order.');
  }

  async recordDeliveryNote(input: DeliveryNoteInput, clientKey: string): Promise<ConstructionCommandResult> {
    return this.call(
      'record_construction_delivery_note',
      { p_payload: input, p_client_key: clientKey },
      'Could not record the delivery note.',
    );
  }

  async recordDeliveryNoteException(input: DeliveryNoteInput, clientKey: string): Promise<ConstructionCommandResult> {
    return this.call(
      'record_construction_delivery_note_exception',
      { p_payload: input, p_client_key: clientKey },
      'Could not record the delivery-note exception.',
    );
  }

  async recordGoodsReceipt(input: GoodsReceiptInput, clientKey: string): Promise<ConstructionCommandResult> {
    return this.call(
      'record_construction_goods_receipt',
      { p_payload: input, p_client_key: clientKey },
      'Could not record the goods receipt.',
    );
  }

  async recordInspection(input: InspectionInput, clientKey: string): Promise<ConstructionCommandResult> {
    return this.call(
      'record_construction_receipt_inspection',
      { p_payload: input, p_client_key: clientKey },
      'Could not record the inspection.',
    );
  }

  async reclassifyReceiptLine(input: ReclassificationInput, clientKey: string): Promise<ConstructionCommandResult> {
    return this.call(
      'reclassify_construction_receipt_line',
      { p_payload: input, p_client_key: clientKey },
      'Could not release the receipt quantity.',
    );
  }

  async releaseHold(holdId: string, reason: string): Promise<ConstructionCommandResult> {
    return this.call(
      'release_construction_receipt_hold',
      { p_hold_id: holdId, p_reason: reason },
      'Could not release the hold.',
    );
  }

  async registerSupplierInvoiceReference(expenseId: string): Promise<ConstructionCommandResult> {
    return this.call(
      'register_construction_supplier_invoice_reference',
      { p_expense_id: expenseId },
      'Could not register the supplier invoice reference.',
    );
  }

  async registerSupplierInvoiceReferenceException(input: {
    expenseId: string;
    exceptionOf: string;
    reason: string;
    evidence: string;
  }): Promise<ConstructionCommandResult> {
    return this.call(
      'register_construction_supplier_invoice_reference_exception',
      {
        p_expense_id: input.expenseId,
        p_exception_of: input.exceptionOf,
        p_reason: input.reason,
        p_evidence: input.evidence,
      },
      'Could not register the supplier invoice reference exception.',
    );
  }

  async matchBillLineToReceipt(input: BillMatchInput, clientKey: string): Promise<ConstructionCommandResult> {
    return this.call(
      'match_construction_bill_line_to_receipt',
      { p_payload: input, p_client_key: clientKey },
      'Could not match the bill line to the receipt line.',
    );
  }

  async approvePostingPolicy(input: {
    businessId: string;
    enable: boolean;
    reason: string;
    evidence: string;
  }): Promise<ConstructionCommandResult> {
    return this.call(
      'approve_construction_receipt_posting_policy',
      {
        p_business_id: input.businessId,
        p_enable: input.enable,
        p_reason: input.reason,
        p_evidence: input.evidence,
      },
      'Could not record the receipt posting policy.',
    );
  }

  async recordReceiptCostBasis(input: {
    grnLineId: string;
    expenseLineId: string;
    quantity: number | string;
    evidenceReference: string;
    clientKey: string;
  }): Promise<ConstructionCommandResult> {
    return this.call(
      'record_construction_receipt_cost_basis',
      {
        p_grn_line_id: input.grnLineId,
        p_expense_line_id: input.expenseLineId,
        p_quantity: input.quantity,
        p_evidence: input.evidenceReference,
        p_client_key: input.clientKey,
      },
      'Could not record the receipt cost basis.',
    );
  }

  async postReceiptMovement(grnId: string): Promise<ConstructionCommandResult> {
    return this.call('post_construction_receipt_movement', { p_grn_id: grnId }, 'Could not post the receipt movement.');
  }

  /**
   * Return usable material to the store it was issued from. One inbound movement
   * at the source issue's recorded cost, one append-only register row, no journal.
   * Replays with the same `clientKey` return the committed row instead of writing
   * a second one.
   */
  async returnMaterialsToStore(input: MaterialReturnInput, clientKey: string, projectId?: string): Promise<ConstructionCommandResult> {
    return this.call(
      projectId ? 'return_project_materials' : 'return_construction_materials_to_store',
      { p_payload: input, p_client_key: clientKey, ...(projectId ? { p_project_id: projectId } : {}) },
      'Could not record the material return.',
    );
  }

  async issueMaterialsToProject(input: MaterialIssueInput, clientKey: string, projectId?: string): Promise<ConstructionCommandResult> {
    return this.call(
      projectId ? 'issue_project_materials' : 'issue_construction_materials_to_project',
      { p_payload: input, p_client_key: clientKey, ...(projectId ? { p_project_id: projectId } : {}) },
      'Could not record the material issue.',
    );
  }
}

export const constructionProcurementRepository = new ConstructionProcurementRepository();
